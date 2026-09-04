'From Cuis7.8 [latest update: #7959] on 3 September 2026 at 8:55:58 pm'!
'Description '!
!provides: 'MCP-Bridge' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
!requires: 'JSON' 1 29 nil!
!requires: 'Network-Kernel' 1 12 nil!
SystemOrganization addCategory: #'MCP-Bridge'!

!classDefinition: #McpBridgeServer category: #'MCP-Bridge'!
Object subclass: #McpBridgeServer
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'MCP-Bridge'!
!classDefinition: 'McpBridgeServer class' category: #'MCP-Bridge'!
McpBridgeServer class
	instanceVariableNames: 'connectionQueue activeSocket pollProcess inactivityTimeoutSeconds activeSocketSetAt'!

!classDefinition: #McpBridgeConnection category: #'MCP-Bridge'!
Object subclass: #McpBridgeConnection
	instanceVariableNames: 'socket process'
	classVariableNames: ''
	poolDictionaries: ''
	category: 'MCP-Bridge'!
!classDefinition: 'McpBridgeConnection class' category: #'MCP-Bridge'!
McpBridgeConnection class
	instanceVariableNames: ''!

!classDefinition: #McpBridgeConnectionQueue category: #'MCP-Bridge'!
ConnectionQueue subclass: #McpBridgeConnectionQueue
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'MCP-Bridge'!

!McpBridgeServer commentStamp: 'jlp 3/Sep/2026 20:55:58' prior: 0!
I am a single-session, loopback-only, polling-based TCP server. I accept at most one active connection at a time, on 127.0.0.1 only; a second connection attempt while one is already active is rejected with a "session_busy" error and closed. An inactive active connection is freed after `inactivityTimeoutSeconds` of silence, so a subsequent connection attempt can take its place.

My class-side `pollLoop` process periodically checks the active connection's inactivity timeout and accepts (or rejects) incoming connections queued by my `McpBridgeConnectionQueue`. Send `startOn:` to start listening on a port, and `stop` to shut down.!

!McpBridgeConnection commentStamp: 'jlp 3/Sep/2026 23:55:00' prior: 0!
I own the request loop for one accepted socket. I read each request line, decode it with `Json`, and dispatch it by its `op` name to a handler method: `handshake`, plus reflection operations (`list_categories`, `list_classes`, `list_protocols`, `list_methods`, `get_method_source`, `get_class_definition`, `get_class_comment`) that query the running image's class/method organization. Each handler replies with a success or error envelope. I run my request loop in my own forked `Process`.!

!McpBridgeConnection class methodsFor: 'instance creation' stamp: 'jlp 3/Sep/2026 20:55:58'!
on: aSocket
	^ self new setSocket: aSocket! !

!McpBridgeConnection class methodsFor: 'accessing' stamp: 'jlp 3/Sep/2026 20:55:58'!
protocolVersion
	^ 1! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
setSocket: aSocket
	socket := aSocket! !

!McpBridgeConnection methodsFor: 'starting' stamp: 'jlp 3/Sep/2026 20:55:58'!
start
	process := [self requestLoop] newProcess.
	process priority: Processor highIOPriority.
	process name: 'McpBridgeConnection request loop'.
	process resume.! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 16:00:00'!
requestLoop
	[
		| line request op selector |
		line := [socket receiveDataTimeout: 5] on: Error do: [:ex | ^self].
		line isEmpty
			ifFalse: [
				request := self parseRequest: line.
				request
					ifNil: [ self sendError: 'invalid_request' message: 'malformed JSON request' ]
					ifNotNil: [
						[
							op := request at: 'op' ifAbsent: [nil].
							selector := self operationHandlers at: op ifAbsent: [nil].
							selector
								ifNotNil: [ self perform: selector with: request ]
								ifNil: [ self sendError: 'invalid_request' message: 'unrecognized operation: ', op ]
						] on: Error do: [:ex |
							self sendError: 'internal_error' message: 'unexpected error handling request: ', ex messageText ] ] ].
		"An empty read means either a real timeout with no data (socket still open — keep
		waiting) or the peer closed (socket no longer connected) — only the latter should
		end the loop. Conflating the two used to silently kill this process on a mere
		timeout, orphaning the TCP connection with nothing left to service it."
		socket isConnected ifFalse: [ ^self ]
	] repeat! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
operationHandlers
	^ Dictionary new
		at: 'handshake' put: #handleHandshake:;
		at: 'list_categories' put: #handleListCategories:;
		at: 'list_classes' put: #handleListClasses:;
		at: 'list_protocols' put: #handleListProtocols:;
		at: 'list_methods' put: #handleListMethods:;
		at: 'get_method_source' put: #handleGetMethodSource:;
		at: 'get_class_definition' put: #handleGetClassDefinition:;
		at: 'get_class_comment' put: #handleGetClassComment:;
		yourself! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
parseRequest: line
	^ [Json readFrom: (ReadStream on: line)]
		on: JsonSyntaxError
		do: [:ex | ex return: nil]! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
handleHandshake: request
	| receivedVersion |
	receivedVersion := self paramNamed: 'protocol_version' from: request.
	receivedVersion = self class protocolVersion
		ifTrue: [
			self sendSuccess: (OrderedDictionary new
				at: 'protocol_version' put: self class protocolVersion;
				yourself)]
		ifFalse: [
			self sendError: 'protocol_mismatch' message: 'protocol version mismatch: expected ', self class protocolVersion printString, ', got ', receivedVersion printString.
			socket destroy]! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
handleListCategories: request
	self sendSuccess: (self sortedStringArrayFrom: SystemOrganization categories)! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 21:00:00'!
handleListClasses: request
	| category |
	category := self paramNamed: 'category' from: request.
	(SystemOrganization categories includes: category asSymbol)
		ifFalse: [ ^self sendError: 'not_found' message: 'category not found: ''', category, '''' ].
	self sendSuccess: (self sortedStringArrayFrom: (SystemOrganization listAtCategoryNamed: category))! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 12:00:00'!
handleListProtocols: request
	| aClass |
	aClass := self resolveClassFromRequest: request.
	aClass ifNil: [^self].
	self sendSuccess: (OrderedDictionary new
		at: 'instance' put: (self sortedStringArrayFrom: aClass organization categories);
		at: 'class' put: (self sortedStringArrayFrom: aClass class organization categories);
		yourself)! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 12:00:00'!
handleListMethods: request
	| protocol side aClass target |
	protocol := self paramNamed: 'protocol' from: request.
	aClass := self resolveClassFromRequest: request.
	aClass ifNil: [^self].
	side := self resolveSide: (self paramNamed: 'side' from: request).
	side ifNil: [^self].
	target := self target: aClass forSide: side.
	self sendSuccess: (self sortedStringArrayFrom: (target organization listAtCategoryNamed: protocol asSymbol))! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 22:00:00'!
handleGetMethodSource: request
	| selector side aClass target method |
	selector := self paramNamed: 'selector' from: request.
	aClass := self resolveClassFromRequest: request.
	aClass ifNil: [^self].
	side := self resolveSide: (self paramNamed: 'side' from: request).
	side ifNil: [^self].
	target := self target: aClass forSide: side.
	method := target compiledMethodAt: selector asSymbol ifAbsent: [nil].
	method ifNil: [^self sendError: 'not_found' message: 'method not found: ', target name, '>>', selector].
	self sendSuccess: method sourceCode! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 23:00:00'!
handleGetClassDefinition: request
	| aClass superclassName |
	aClass := self resolveClassFromRequest: request.
	aClass ifNil: [^self].
	superclassName := aClass superclass ifNotNil: [:aSuperclass | aSuperclass name asString].
	self sendSuccess: (OrderedDictionary new
		at: 'superclass' put: superclassName;
		at: 'instance_variable_names' put: (aClass instVarNames collect: [:each | each asString]) asArray;
		at: 'class_variable_names' put: (aClass classVarNames collect: [:each | each asString]) asArray;
		at: 'category' put: aClass category asString;
		yourself)! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 23:50:00'!
handleGetClassComment: request
	| aClass |
	aClass := self resolveClassFromRequest: request.
	aClass ifNil: [^self].
	self sendSuccess: (aClass hasComment ifTrue: [aClass comment] ifFalse: [nil])! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 22:30:00'!
resolveClassNamed: aString
	^ Smalltalk at: aString asSymbol ifAbsent: [
		self sendError: 'not_found' message: 'class not found: ''', aString, ''''.
		nil]! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 22:30:00'!
resolveClassFromRequest: request
	^ self resolveClassNamed: (self paramNamed: 'class' from: request)! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 12:00:00'!
target: aClass forSide: side
	^ side = 'class' ifTrue: [aClass class] ifFalse: [aClass]! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 4/Sep/2026 12:00:00'!
resolveSide: aSide
	(aSide = 'instance' or: [aSide = 'class'])
		ifTrue: [^aSide].
	self sendError: 'not_found' message: 'side not found: ''', aSide, ''''.
	^nil! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
paramNamed: aKey from: request
	| params |
	params := request at: 'params' ifAbsent: [nil].
	^ params ifNil: [nil] ifNotNil: [params at: aKey ifAbsent: [nil]]! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
sortedStringArrayFrom: aCollection
	^ (aCollection asSortedCollection collect: [:each | each asString]) asArray! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
sendSuccess: aResult
	| envelope |
	envelope := Json render: (OrderedDictionary new
		at: 'ok' put: true;
		at: 'result' put: aResult;
		yourself).
	socket sendData: envelope , String lfString! !

!McpBridgeConnection methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
sendError: aCode message: aMessage
	| envelope |
	envelope := Json render: (OrderedDictionary new
		at: 'ok' put: false;
		at: 'error' put: (OrderedDictionary new
			at: 'code' put: aCode;
			at: 'message' put: aMessage;
			yourself);
		yourself).
	socket sendData: envelope , String lfString! !

!McpBridgeConnectionQueue methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
createListeningSocketWithBacklog: aNumber
	| addressInfo sock |
	self portNumbers do: [:trialportNumber |
		addressInfo := SocketAddressInformation
			forHost: '127.0.0.1'
			service: trialportNumber asString
			flags: SocketAddressInformation passiveFlag
			addressFamily: SocketAddressInformation addressFamilyINET4
			socketType: SocketAddressInformation socketTypeStream
			protocol: SocketAddressInformation protocolTCP.
		sock := [addressInfo first listenWithBacklog: aNumber] ifError: [nil].
		sock ifNotNil: [
			portNumber := trialportNumber.
			^ sock]].
	^ nil! !

!McpBridgeConnectionQueue methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
listenLoop
	"Modified copy of ConnectionQueue>>listenLoop (Network-Kernel), needed only because the useOldNetwork branch below has no override hook: it binds the raw socket via #listenOn:backlogSize: with no interface argument, so here it is changed to #listenOn:backlogSize:interface: to force loopback-only binding. Keep this in sync with the original if that one changes."

	| newConnection |
	"We'll accept four simultanous connections at the same time"
	NetNameResolver useOldNetwork
		ifFalse: [ socket := self createListeningSocketWithBacklog: 4 ]
		ifTrue: [
			socket := Socket newTCP.
			socket listenOn: portNumber backlogSize: 4 interface: (NetNameResolver addressFromString: '127.0.0.1') ].
	"If the listener is not valid then the we cannot use the
	BSD style accept() mechanism."
	socket isValid ifFalse: [^self oldStyleListenLoop].
	[
		socket isValid ifFalse: [
			"socket has stopped listening for some reason"
			socket destroy.
			(Delay forMilliseconds: 10) wait.
			^self listenLoop ].
		newConnection := socket
			waitForAcceptFor: 10
			ifTimedOut: [ nil ].
		(newConnection notNil and: [newConnection isConnected]) ifTrue: [
			accessSema critical: [connections addLast: newConnection.].
			newConnection := nil.
			self changed].
		self pruneStaleConnections] repeat! !

!McpBridgeServer class methodsFor: 'accessing' stamp: 'jlp 3/Sep/2026 20:55:58'!
inactivityTimeoutSeconds
	^ inactivityTimeoutSeconds ifNil: [ 60 ]! !

!McpBridgeServer class methodsFor: 'accessing' stamp: 'jlp 3/Sep/2026 20:55:58'!
inactivityTimeoutSeconds: aNumberOfSeconds
	inactivityTimeoutSeconds := aNumberOfSeconds! !

!McpBridgeServer class methodsFor: 'starting' stamp: 'jlp 3/Sep/2026 20:55:58'!
startOn: aPort
	connectionQueue := McpBridgeConnectionQueue portNumber: aPort queueLength: 5.
	activeSocket := nil.
	activeSocketSetAt := nil.
	pollProcess := [self pollLoop] newProcess.
	pollProcess priority: Processor highIOPriority.
	pollProcess name: 'McpBridgeServer poll'.
	pollProcess resume.! !

!McpBridgeServer class methodsFor: 'starting' stamp: 'jlp 3/Sep/2026 20:55:58'!
stop
	pollProcess ifNotNil: [ pollProcess terminate ].
	pollProcess := nil.
	connectionQueue ifNotNil: [ connectionQueue destroy ].
	connectionQueue := nil.
	activeSocket := nil.
	activeSocketSetAt := nil.! !

!McpBridgeServer class methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
pollLoop
	[
		(Delay forMilliseconds: 50) wait.
		self checkInactivityTimeout.
		self acceptOrRejectIncomingConnection] repeat! !

!McpBridgeServer class methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
checkInactivityTimeout
	(activeSocket notNil and: [
		(Time millisecondClockValue - activeSocketSetAt) / 1000.0 > self inactivityTimeoutSeconds])
		ifTrue: [
			activeSocket destroy.
			activeSocket := nil.
			activeSocketSetAt := nil ]! !

!McpBridgeServer class methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
acceptOrRejectIncomingConnection
	connectionQueue ifNotNil: [
		| newSocket |
		newSocket := connectionQueue getConnectionOrNil.
		newSocket ifNotNil: [
			(activeSocket notNil and: [activeSocket isConnected])
				ifTrue: [ self rejectAsSessionBusy: newSocket ]
				ifFalse: [
					activeSocket := newSocket.
					activeSocketSetAt := Time millisecondClockValue.
					(McpBridgeConnection on: newSocket) start ] ] ]! !

!McpBridgeServer class methodsFor: 'private' stamp: 'jlp 3/Sep/2026 20:55:58'!
rejectAsSessionBusy: aSocket
	[
		| envelope |
		envelope := Json render: (OrderedDictionary new
			at: 'ok' put: false;
			at: 'error' put: (OrderedDictionary new
				at: 'code' put: 'session_busy';
				at: 'message' put: 'a session is already active; only one connection is allowed at a time';
				yourself);
			yourself).
		aSocket sendData: envelope , String lfString.
		aSocket destroy.
	] on: Error do: [:ex | ex return: nil]! !
