Utilities setAuthorName: 'run-skill' initials: 'rs'.
Transcript logToStdout: true.
[
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // '.headless-base/JSON.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // '.headless-base/Network-Kernel.pck.st').
	CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'mcp-bridge/image/MCP-Bridge.pck.st').
] on: ParserNotification do: [ :ex |
	Transcript show: 'PARSER NOTIFICATION: ', ex class name, ' - ', ex messageText printString; newLine.
	ex resume: nil
].

(Smalltalk at: #McpBridgeServer) startOn: 6790.
Transcript show: 'SERVER READY on 6790'; newLine.
