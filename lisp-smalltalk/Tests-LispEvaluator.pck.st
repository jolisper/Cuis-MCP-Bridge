'From Cuis7.8 [latest update: #7959] on 5 September 2026 at 2:30:00 pm'!
'Description '!
!provides: 'Tests-LispEvaluator' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #'Tests-LispEvaluator'!

!classDefinition: #LispEvaluatorTests category: #'Tests-LispEvaluator'!
TestCase subclass: #LispEvaluatorTests
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Tests-LispEvaluator'!

!LispEvaluatorTests methodsFor: 'tests' stamp: 'jlp 5/Sep/2026 14:30:00'!
testEvalNumberSelfEvaluates
	self assert: (LispEvaluator new eval: 5 env: nil) equals: 5! !
