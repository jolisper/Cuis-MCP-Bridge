'From Cuis7.8 [latest update: #7959] on 4 September 2026 at 8:30:00 pm'!
'Description '!
!provides: 'Tests-LispReader' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
!requires: 'LispReader' 1 1 nil!
SystemOrganization addCategory: #'Tests-LispReader'!

!classDefinition: #LispReaderTests category: #'Tests-LispReader'!
TestCase subclass: #LispReaderTests
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Tests-LispReader'!

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsSymbolAtom
	self assert: (LispReader on: 'foo') nextExpression equals: #foo! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsPositiveIntegerAtom
	self assert: (LispReader on: '42') nextExpression equals: 42! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsNegativeIntegerAtom
	self assert: (LispReader on: '-7') nextExpression equals: -7! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testSymbolAtomMayStartWithSignLikeCharacterButNotBeNumeric
	"A leading - or + followed by a non-digit is a symbol, not the start of a number:
	common Lisp idioms like -foo or +something must still read as symbols"
	self assert: (LispReader on: '-foo') nextExpression equals: #'-foo'! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsFloatAtom
	self assert: (LispReader on: '3.5') nextExpression equals: 3.5! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testSymbolAtomMayContainCharactersInvalidInSmalltalkIdentifiers
	"Common Lisp/Scheme symbol conventions (trailing ? or bang, embedded -) must be
	readable, even though Character>>isValidInIdentifiers (Smalltalk identifier rules)
	rejects them"
	self assert: (LispReader on: 'list?') nextExpression equals: #'list?'.
	self assert: (LispReader on: 'set!!') nextExpression equals: #'set!!'.
	self assert: (LispReader on: 'call-with-current-continuation') nextExpression equals: #'call-with-current-continuation'! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsEmptyListAsNil
	"The empty list is Lisp's NIL, represented directly as Smalltalk's own nil"
	self assert: (LispReader on: '()') nextExpression equals: nil! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsSimpleProperList
	| result |
	result := (LispReader on: '(a b c)') nextExpression.
	self assert: result equals: (LispCons car: #a cdr: (LispCons car: #b cdr: (LispCons car: #c cdr: nil)))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsNestedList
	| result |
	result := (LispReader on: '(a (b c) d)') nextExpression.
	self assert: result equals:
		(LispCons car: #a cdr:
			(LispCons car: (LispCons car: #b cdr: (LispCons car: #c cdr: nil)) cdr:
				(LispCons car: #d cdr: nil)))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsDottedPair
	| result |
	result := (LispReader on: '(a . b)') nextExpression.
	self assert: result equals: (LispCons car: #a cdr: #b)! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testQuoteShorthandDesugarsToQuoteForm
	| result |
	result := (LispReader on: '''a') nextExpression.
	self assert: result equals: (LispCons car: #quote cdr: (LispCons car: #a cdr: nil))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testQuoteShorthandWorksOnLists
	| result |
	result := (LispReader on: '''(a b)') nextExpression.
	self assert: result equals:
		(LispCons car: #quote cdr:
			(LispCons car: (LispCons car: #a cdr: (LispCons car: #b cdr: nil)) cdr: nil))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testSkipsWhitespaceBetweenAndAroundAtoms
	| result |
	result := (LispReader on: '  (  a   b  )  ') nextExpression.
	self assert: result equals: (LispCons car: #a cdr: (LispCons car: #b cdr: nil))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testSkipsLineComments
	| result |
	result := (LispReader on: '(a ; this is a comment
		b)') nextExpression.
	self assert: result equals: (LispCons car: #a cdr: (LispCons car: #b cdr: nil))! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testReadsMultipleExpressionsInSequenceUntilAtEnd
	| reader results |
	reader := LispReader on: 'a b c'.
	results := OrderedCollection new.
	[reader atEnd] whileFalse: [results add: reader nextExpression].
	self assert: results asArray equals: #(#a #b #c)! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testAtEndIsTrueForBlankInput
	self assert: (LispReader on: '   ') atEnd! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testUnmatchedClosingParenSignalsLispReaderError
	self should: [(LispReader on: ')') nextExpression] raise: LispReaderError! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testUnterminatedListSignalsLispReaderError
	self should: [(LispReader on: '(a b') nextExpression] raise: LispReaderError! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testNextExpressionOnExhaustedInputSignalsLispReaderError
	self should: [(LispReader on: '') nextExpression] raise: LispReaderError! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testMalformedDottedListMissingClosingParenSignalsLispReaderError
	self should: [(LispReader on: '(a . b c)') nextExpression] raise: LispReaderError! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testConsPrintStringLooksLikeALispList
	self assert: (LispCons car: #a cdr: (LispCons car: #b cdr: nil)) printString equals: '(a b)'! !

!LispReaderTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 20:30:00'!
testConsPrintStringForDottedPair
	self assert: (LispCons car: #a cdr: #b) printString equals: '(a . b)'! !
