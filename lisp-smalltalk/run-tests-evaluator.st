| result exitCode |
Utilities setAuthorName: 'Jorge Luis Perez' initials: 'jlp'.
Transcript logToStdout: true.
[
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'lisp-smalltalk/LispEvaluator.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'lisp-smalltalk/Tests-LispEvaluator.pck.st').
] on: ParserNotification do: [ :ex |
	Transcript show: 'PARSER NOTIFICATION: ', ex class name, ' - ', ex messageText printString; newLine.
	ex resume: nil
].
result := [ (Smalltalk at: #LispEvaluatorTests) buildSuiteFromSelectors run ]
	on: Error
	do: [ :ex | Transcript show: 'ERROR DURING TEST RUN: ', ex class name, ' - ', ex messageText printString; newLine. nil ].
result
	ifNil: [ Transcript show: 'result is nil, treating as failure'; newLine. exitCode := 1 ]
	ifNotNil: [
		Transcript show: result printString; newLine.
		exitCode := (result hasFailures or: [ result hasErrors ]) ifTrue: [ 1 ] ifFalse: [ 0 ] ].
Transcript show: 'DONE exitCode=', exitCode printString; newLine.
Smalltalk quitPrimitive: exitCode
