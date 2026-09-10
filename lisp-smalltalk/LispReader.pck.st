'From Cuis7.8 [latest update: #7959] on 4 September 2026 at 8:30:00 pm'!
'Description '!
!provides: 'LispReader' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #'Lisp-Reader'!

!classDefinition: #LispCons category: #'Lisp-Reader'!
Object subclass: #LispCons
	instanceVariableNames: 'car cdr'
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Reader'!

!classDefinition: #LispReaderError category: #'Lisp-Reader'!
Error subclass: #LispReaderError
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Reader'!

!classDefinition: #LispReader category: #'Lisp-Reader'!
Object subclass: #LispReader
	instanceVariableNames: 'stream'
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Lisp-Reader'!

!LispCons commentStamp: 'jlp 4/Sep/2026 20:30:00' prior: 0!
I am a Lisp cons cell: a pair of `car` and `cdr`. A proper list is a chain of LispCons terminated by `nil` (Smalltalk's own nil doubles as Lisp's NIL/empty-list — no separate singleton class for it). An improper (dotted) list is a chain terminated by some other non-LispCons object.!

!LispCons class methodsFor: 'instance creation' stamp: 'jlp 4/Sep/2026 20:30:00'!
car: aCar cdr: aCdr
	^self new setCar: aCar cdr: aCdr! !

!LispCons methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
setCar: aCar cdr: aCdr
	car := aCar.
	cdr := aCdr! !

!LispCons methodsFor: 'accessing' stamp: 'jlp 4/Sep/2026 20:30:00'!
car
	^car! !

!LispCons methodsFor: 'accessing' stamp: 'jlp 4/Sep/2026 20:30:00'!
cdr
	^cdr! !

!LispCons methodsFor: 'accessing' stamp: 'jlp 4/Sep/2026 20:30:00'!
car: aCar
	car := aCar! !

!LispCons methodsFor: 'accessing' stamp: 'jlp 4/Sep/2026 20:30:00'!
cdr: aCdr
	cdr := aCdr! !

!LispCons methodsFor: 'comparing' stamp: 'jlp 4/Sep/2026 20:30:00'!
= other
	(other isKindOf: LispCons) ifFalse: [^false].
	^car = other car and: [cdr = other cdr]! !

!LispCons methodsFor: 'comparing' stamp: 'jlp 4/Sep/2026 20:30:00'!
hash
	^car hash bitXor: cdr hash! !

!LispCons methodsFor: 'printing' stamp: 'jlp 5/Sep/2026 01:00:00'!
printOn: aStream
	| current |
	aStream nextPut: $(.
	current := self.
	[current isKindOf: LispCons] whileTrue: [
		self printAtom: current car on: aStream.
		current := current cdr.
		current ifNotNil: [
			(current isKindOf: LispCons) ifTrue: [aStream space]]].
	current ifNotNil: [
		aStream nextPutAll: ' . '.
		self printAtom: current on: aStream].
	aStream nextPut: $)! !

!LispCons methodsFor: 'printing' stamp: 'jlp 5/Sep/2026 01:00:00'!
printAtom: anObject on: aStream
	"Symbols print bare (Lisp style: foo), not Smalltalk style (#foo). Everything
	else — numbers, nested LispCons — prints via its own normal printOn:."
	anObject isSymbol
		ifTrue: [aStream nextPutAll: anObject asString]
		ifFalse: [aStream print: anObject]! !

!LispReaderError commentStamp: 'jlp 4/Sep/2026 20:30:00' prior: 0!
Signaled by LispReader for malformed input: an unmatched closing paren, an unterminated
list (end of input reached while still inside parens), or a request for the next
expression when there isn't one.!

!LispReader class methodsFor: 'instance creation' stamp: 'jlp 4/Sep/2026 20:30:00'!
on: aString
	^self new setStream: (ReadStream on: aString)! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
setStream: aStream
	stream := aStream! !

!LispReader methodsFor: 'testing' stamp: 'jlp 4/Sep/2026 20:30:00'!
atEnd
	self skipWhitespaceAndComments.
	^stream atEnd! !

!LispReader methodsFor: 'reading' stamp: 'jlp 4/Sep/2026 20:30:00'!
nextExpression
	self skipWhitespaceAndComments.
	stream atEnd ifTrue: [
		^LispReaderError new signal: 'unexpected end of input'].
	stream peek == $( ifTrue: [^self parseListAfterOpenParen].
	stream peek == $) ifTrue: [
		^LispReaderError new signal: 'unexpected )'].
	stream peek == $' ifTrue: [^self parseQuote].
	^self parseAtom! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
skipWhitespaceAndComments
	[
		stream atEnd not and: [
			stream peek isSeparator or: [stream peek == $;]]
	] whileTrue: [
		stream peek == $;
			ifTrue: [stream upTo: Character lf]
			ifFalse: [stream next]]! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
parseQuote
	stream next.
	^LispCons car: #quote cdr: (LispCons car: self nextExpression cdr: nil)! !

!LispReader methodsFor: 'private' stamp: 'jlp 5/Sep/2026 01:10:00'!
parseListAfterOpenParen
	"The ( has not been consumed yet — only nextExpression's caller has peeked at it."
	stream next.
	^self parseListElements! !

!LispReader methodsFor: 'private' stamp: 'jlp 5/Sep/2026 01:10:00'!
parseListElements
	"Parses the elements of a list body (everything after the (, or after a
	previously-parsed element, up to the closing )). Unlike
	parseListAfterOpenParen, there is no ( to consume here — this is what
	that method's recursive case must call instead of itself, since only the
	very first call is preceded by an actual open paren."
	self skipWhitespaceAndComments.
	stream atEnd ifTrue: [
		^LispReaderError new signal: 'unterminated list: reached end of input before )'].
	stream peek == $) ifTrue: [stream next. ^nil].
	stream peek == $. ifTrue: [^self parseDottedTailAfterDot].
	^LispCons car: self nextExpression cdr: self parseListElements! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
parseDottedTailAfterDot
	| tail |
	stream next.
	tail := self nextExpression.
	self skipWhitespaceAndComments.
	(stream atEnd or: [stream peek ~= $)]) ifTrue: [
		^LispReaderError new signal: 'malformed dotted list: expected ) after the tail'].
	stream next.
	^tail! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
parseAtom
	| token |
	token := self readToken.
	^(self looksNumeric: token)
		ifTrue: [Number readFrom: (ReadStream on: token)]
		ifFalse: [token asSymbol]! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
readToken
	| tokenStream |
	tokenStream := WriteStream on: String new.
	[stream atEnd not and: [self isSymbolConstituent: stream peek]]
		whileTrue: [tokenStream nextPut: stream next].
	tokenStream isEmpty ifTrue: [
		^LispReaderError new signal: 'expected an atom, found: ', stream peek asString].
	^tokenStream contents! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
isSymbolConstituent: aCharacter
	^aCharacter isSeparator not
		and: [aCharacter ~= $( and: [aCharacter ~= $) and: [aCharacter ~= $' and: [aCharacter ~= $;]]]]! !

!LispReader methodsFor: 'private' stamp: 'jlp 4/Sep/2026 20:30:00'!
looksNumeric: aToken
	| firstChar |
	firstChar := aToken first.
	firstChar isDigit ifTrue: [^true].
	^(firstChar = $- or: [firstChar = $+])
		and: [aToken size > 1 and: [(aToken at: 2) isDigit]]! !
