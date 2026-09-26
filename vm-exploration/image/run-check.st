| helloResult zigResult exitCode |
Transcript logToStdout: true.

[
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'vm-exploration/image/VM-Exploration.pck.st').
] on: ParserNotification do: [ :ex |
	Transcript show: 'PARSER NOTIFICATION: ', ex class name, ' - ', ex messageText printString; newLine.
	ex resume: nil
].

helloResult := [ (Smalltalk at: #DummyPrimitiveDemo) hello: 'Cuis' ]
	on: Error
	do: [ :ex |
		Transcript show: 'ERROR DURING CHECK (hello:): ', ex class name, ' - ', ex messageText printString; newLine.
		nil ].

zigResult := [ (Smalltalk at: #DummyPrimitiveDemo) helloZig: 'Cuis' ]
	on: Error
	do: [ :ex |
		Transcript show: 'ERROR DURING CHECK (helloZig:): ', ex class name, ' - ', ex messageText printString; newLine.
		nil ].

Transcript show: 'DummyPrimitiveDemo hello: ''Cuis'' => ', helloResult printString; newLine.
Transcript show: 'DummyPrimitiveDemo helloZig: ''Cuis'' => ', zigResult printString; newLine.

exitCode := ((helloResult = 'Hello world! Cuis') and: [ zigResult = 'Hello world from Zig! Cuis' ])
	ifTrue: [ 0 ] ifFalse: [ 1 ].
Transcript show: 'DONE exitCode=', exitCode printString; newLine.
Smalltalk quitPrimitive: exitCode
