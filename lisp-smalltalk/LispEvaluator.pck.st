'From Cuis7.8 [latest update: #7959] on 5 September 2026 at 2:30:00 pm'!
'Description '!
!provides: 'LispEvaluator' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #'LispEvaluator'!

!classDefinition: #LispEvaluator category: #'LispEvaluator'!
Object subclass: #LispEvaluator
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'LispEvaluator'!

!LispEvaluator methodsFor: 'tests' stamp: 'jlp 8/Sep/2026 10:00:00'!
eval: anExpression env: anEnvironment
	^ (anExpression isNumber) ifTrue: [ anExpression ] ifFalse: [ ^ nil ]! !
