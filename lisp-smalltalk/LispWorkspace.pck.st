'From Cuis7.8 [latest update: #7959] on 4 September 2026 at 8:00:00 pm'!
'Description '!
!provides: 'LispWorkspace' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #'Lisp-Workspace'!

!classDefinition: #LispWorkspace category: #'Lisp-Workspace'!
Workspace subclass: #LispWorkspace
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Workspace'!

!classDefinition: #LispEditor category: #'Lisp-Workspace'!
TextEditor subclass: #LispEditor
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Workspace'!

!LispWorkspace commentStamp: 'jlp 4/Sep/2026 20:00:00' prior: 0!
I am a Workspace whose editor is a LispEditor instead of the usual SmalltalkEditor, so "print it" evaluates the current text selection as Lisp instead of Smalltalk.

I am currently a dummy prototype: my editor's `printIt` just reverses the selected text instead of running a real Lisp reader+evaluator, to validate the window/selection/insert-result interaction first.

Open me with:
	LispWorkspace new contents: ''; openLabel: 'Lisp Workspace'.!

!LispWorkspace methodsFor: 'user interface support' stamp: 'jlp 4/Sep/2026 20:00:00'!
editorClass
	^LispEditor! !

!LispEditor commentStamp: 'jlp 4/Sep/2026 20:00:00' prior: 0!
Dummy editor prototype for LispWorkspace. My `printIt` reverses the selected text and inserts the result after the selection — a stand-in for real Lisp evaluation, used only to validate the do-it interaction (select text, Cmd/Alt-P, see a result appended) end-to-end before wiring an actual Lisp reader and evaluator.!

!LispEditor methodsFor: 'do-its' stamp: 'jlp 4/Sep/2026 20:00:00'!
printIt
	"Dummy stand-in for real Lisp evaluation: reverse the selected text and insert the
	result after the selection, the same way SmalltalkEditor's printIt inserts a real
	evaluation result. Requires an actual selection — no auto-select-current-line yet."
	| result |
	self selection isEmpty ifTrue: [ ^self morph flash ].
	result := self selection reversed.
	self afterSelectionInsertAndSelect: ' ==> ', result! !

!LispEditor methodsFor: 'menu & kbd shortcuts' stamp: 'jlp 4/Sep/2026 20:00:00'!
defaultMenuSpec
	^super defaultMenuSpec ,
		#(#(65 'Print it (p) [dummy Lisp]' $p editor printIt printIcon 'Print it: dummy stand-in for Lisp evaluation'))! !
