| result exitCode |
Utilities setAuthorName: 'Jorge Luis Perez' initials: 'jlp'.
Transcript logToStdout: true.
[
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'Cuis7-8-main/Packages/Features/JSON.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'Cuis7-8-main/Packages/System/Network-Kernel.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'mcp-bridge/image/MCP-Bridge.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'mcp-bridge/image/Tests-MCP-Bridge.pck.st').
] on: ParserNotification do: [ :ex |
	Transcript show: 'PARSER NOTIFICATION: ', ex class name, ' - ', ex messageText printString; newLine.
	ex resume: nil
].

result := [ (Smalltalk at: #McpBridgeTests) buildSuiteFromSelectors run ]
	on: Error
	do: [ :ex |
		Transcript show: 'ERROR DURING TEST RUN: ', ex class name, ' - ', ex messageText printString; newLine.
		nil ].

result
	ifNil: [ Transcript show: 'result is nil, treating as failure'; newLine. exitCode := 1 ]
	ifNotNil: [
		Transcript show: result printString; newLine.
		exitCode := (result hasFailures or: [ result hasErrors ]) ifTrue: [ 1 ] ifFalse: [ 0 ] ].
Transcript show: 'DONE exitCode=', exitCode printString; newLine.
Smalltalk quitPrimitive: exitCode
