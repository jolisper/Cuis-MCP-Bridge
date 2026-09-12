'From Cuis7.8 [latest update: #7959] on 4 September 2026 at 8:00:00 pm'!
'Description '!
!provides: 'LispWorkspace' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
!requires: 'LispReader' 1 1 nil!
!requires: 'LispEvaluator' 1 1 nil!
SystemOrganization addCategory: #'Lisp-Workspace'!

!classDefinition: #LispWorkspace category: #'Lisp-Workspace'!
Workspace subclass: #LispWorkspace
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Workspace'!

!classDefinition: #LispEditor category: #'Lisp-Workspace'!
TextEditor subclass: #LispEditor
	instanceVariableNames: 'environment'
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Workspace'!

!LispWorkspace commentStamp: 'jlp 4/Sep/2026 20:00:00' prior: 0!
I am a Workspace whose editor is a LispEditor instead of the usual SmalltalkEditor, so "print it" evaluates the current text selection as Lisp instead of Smalltalk.

Open me with:
	LispWorkspace new contents: ''; openLabel: 'Lisp Workspace'.!

!LispWorkspace methodsFor: 'user interface support' stamp: 'jlp 4/Sep/2026 20:00:00'!
editorClass
	^LispEditor! !

!LispEditor commentStamp: 'jlp 10/Sep/2026 09:00:00' prior: 0!
Editor for LispWorkspace. My `printIt` reads the selected text as Lisp (via LispReader), evaluates it (via LispEvaluator), and inserts the printed result after the selection — the Lisp equivalent of SmalltalkEditor's printIt.

SmalltalkEditor's printIt ends its inserted text with ' .' so the workspace buffer stays valid, re-evaluable Smalltalk source (statements there are period-terminated). I do the equivalent for Lisp: I insert the result as a `;` line comment (' ; result'), since that's what keeps *this* buffer valid, re-readable Lisp source — a later top-to-bottom read of the buffer skips prior results as comments instead of choking on them as extra, malformed tokens.

I keep my own `environment` as an instance variable, persistent across evaluations in this window: as the evaluator grows to support symbols and bindings (later steps), definitions made in one evaluation will stay visible to the next one, the same way a real REPL's top-level environment does. Right now the evaluator only understands self-evaluating atoms, so `environment` sits unused — nil — until that lands.!

!LispEditor methodsFor: 'accessing' stamp: 'jlp 10/Sep/2026 09:00:00'!
environment
	^environment! !

!LispEditor methodsFor: 'private' stamp: 'jlp 11/Sep/2026 09:00:00'!
nextLispExpressionOrNil
	"Read the selection (falling back to the current line, like SmalltalkEditor's
	lineSelectAndEmptyCheck:) as one Lisp expression. Answers nil — after flashing
	or reporting a reader error in place — if there's nothing to read."
	self selection isEmpty ifTrue: [ self selectLine ].
	self selection isEmpty ifTrue: [ self morph flash. ^nil ].
	^[(LispReader on: self selection) nextExpression]
		on: LispReaderError
		do: [ :ex | self afterSelectionInsertAndSelect: ' ; READER ERROR: ', ex messageText. ^nil ]! !

!LispEditor methodsFor: 'do-its' stamp: 'jlp 11/Sep/2026 09:00:00'!
printIt
	"Evaluate the selection against this window's persistent environment and
	insert the printed result after it."
	| expression result |
	expression := self nextLispExpressionOrNil.
	expression ifNil: [ ^self ].
	result := LispEvaluator new eval: expression env: self environment.
	self afterSelectionInsertAndSelect: ' ; ', result printString! !

!LispEditor methodsFor: 'do-its' stamp: 'jlp 11/Sep/2026 09:00:00'!
doIt
	"Evaluate the selection against this window's persistent environment, same as
	printIt, but discard the result instead of inserting it — for side effects
	only. Not very useful yet (the evaluator has none), but will matter once later
	steps add environment mutation (e.g. label/define).

	Like SmalltalkEditor>>doIt: if there was no selection to begin with (we only
	auto-selected the current line to have something to evaluate), collapse back
	to a plain cursor afterward instead of leaving that line highlighted."
	| expression hadSelection stop |
	hadSelection := self hasSelection.
	expression := self nextLispExpressionOrNil.
	expression ifNil: [ ^self ].
	LispEvaluator new eval: expression env: self environment.
	hadSelection ifFalse: [
		stop := self stopIndex.
		self selectFrom: stop to: stop - 1 ]! !

!LispEditor methodsFor: 'menu & kbd shortcuts' stamp: 'jlp 11/Sep/2026 09:00:00'!
defaultMenuSpec
	^super defaultMenuSpec ,
		#(#(65 'Print it (p) [Lisp]' $p editor printIt printIcon 'Print it: evaluate the selection as Lisp')
		  #(66 'Do it (d) [Lisp]' $d editor doIt doItIcon 'Do it: evaluate the selection as Lisp, discarding the result'))! !
