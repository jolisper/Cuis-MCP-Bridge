'From Cuis7.8 [latest update: #7959] on 3 September 2026 at 8:55:58 pm'!
'Description '!
!provides: 'Tests-MCP-Bridge' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
!requires: 'MCP-Bridge' 1 1 nil!
SystemOrganization addCategory: #'Tests-MCP-Bridge'!


!classDefinition: #McpBridgeTests category: #'Tests-MCP-Bridge'!
TestCase subclass: #McpBridgeTests
	instanceVariableNames: 'clientSocket'
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Tests-MCP-Bridge'!
!classDefinition: 'McpBridgeTests class' category: #'Tests-MCP-Bridge'!
McpBridgeTests class
	instanceVariableNames: ''!

!classDefinition: #McpBridgeFailingSocketStub category: #'Tests-MCP-Bridge'!
Object subclass: #McpBridgeFailingSocketStub
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'Tests-MCP-Bridge'!
!classDefinition: 'McpBridgeFailingSocketStub class' category: #'Tests-MCP-Bridge'!
McpBridgeFailingSocketStub class
	instanceVariableNames: ''!

!McpBridgeFailingSocketStub commentStamp: 'jlp 4/Sep/2026 16:15:00' prior: 0!
I stand in for a real Socket in tests, simulating a VM-level primitive failure (like the real `SocketPrimitiveFailed` seen from `receiveDataTimeout:`) instead of ever returning data.!

!McpBridgeFailingSocketStub methodsFor: 'simulating' stamp: 'jlp 4/Sep/2026 16:15:00'!
receiveDataTimeout: seconds
	^ Error signal: 'primSocketReceiveDataAvailable: failed (simulated)'! !

!McpBridgeFailingSocketStub methodsFor: 'simulating' stamp: 'jlp 4/Sep/2026 16:15:00'!
isConnected
	^ false! !

!McpBridgeTests methodsFor: 'running' stamp: 'jlp 3/Sep/2026 20:55:58'!
setUp
	super setUp.! !

!McpBridgeTests methodsFor: 'running' stamp: 'jlp 3/Sep/2026 20:55:58'!
tearDown
	clientSocket ifNotNil: [clientSocket destroy].
	McpBridgeServer inactivityTimeoutSeconds: 60.
	McpBridgeServer verbose: false.
	McpBridgeServer stop.
	super tearDown.! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testStartOnMakesServerReachableViaTcp
	"Given a McpBridgeServer started on a test port"
	McpBridgeServer startOn: 17890.

	"When a client socket connects to that port on localhost"
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17890.
	clientSocket waitForConnectionFor: 2.

	"Then the connection succeeds"
	self assert: clientSocket isConnected! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testStartOnBindsOnlyToLoopback
	"Given a McpBridgeServer started on a test port"
	| connectionQueue listeningSocket |
	McpBridgeServer startOn: 17891.

	"When inspecting the local address the underlying listening socket is bound to"
	connectionQueue := McpBridgeServer instVarNamed: 'connectionQueue'.
	listeningSocket := connectionQueue instVarNamed: 'socket'.

	"Then it is bound to the loopback address only, never a wildcard/any-interface address"
	self assert: listeningSocket localAddressString = '127.0.0.1'! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testSecondConnectionWhileOneActiveGetsSessionBusy
	"Given a McpBridgeServer started on a test port with one connection already active"
	| firstSocket response expectedJson |
	McpBridgeServer startOn: 17892.
	firstSocket := Socket newTCP.
	[
		firstSocket
			connectTo: (NetNameResolver addressFromString: '127.0.0.1')
			port: 17892.
		firstSocket waitForConnectionFor: 2.
		self assert: firstSocket isConnected.

		"When a second client connects while the first connection is already active"
		clientSocket := Socket newTCP.
		clientSocket
			connectTo: (NetNameResolver addressFromString: '127.0.0.1')
			port: 17892.
		clientSocket waitForConnectionFor: 2.

		"Then the second connection receives a session_busy error line and is closed, while the first connection is left alone"
		response := clientSocket receiveDataTimeout: 2.
		expectedJson := '{"ok": false, "error": {"code": "session_busy", "message": "a session is already active; only one connection is allowed at a time"}}', String lfString.
		self assert: response equals: expectedJson.
		self assert: firstSocket isConnected.
	] ensure: [ firstSocket destroy ]! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testStaleActiveConnectionIsFreedAfterInactivityTimeout
	"Given a McpBridgeServer with a short inactivity timeout, and a first connection that goes silent"
	| firstSocket response |
	McpBridgeServer inactivityTimeoutSeconds: 0.2.
	McpBridgeServer startOn: 17893.
	firstSocket := Socket newTCP.
	[
		firstSocket
			connectTo: (NetNameResolver addressFromString: '127.0.0.1')
			port: 17893.
		firstSocket waitForConnectionFor: 2.
		self assert: firstSocket isConnected.

		"When the first connection stays silent past the inactivity timeout, and a second client then connects"
		(Delay forSeconds: 1) wait.
		clientSocket := Socket newTCP.
		clientSocket
			connectTo: (NetNameResolver addressFromString: '127.0.0.1')
			port: 17893.
		clientSocket waitForConnectionFor: 2.

		"Then the second connection is accepted as the new active session, not rejected with session_busy"
		response := clientSocket receiveDataTimeout: 1.
		self assert: response isEmpty.
	] ensure: [ firstSocket destroy ]! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testHandshakeRequestGetsSuccessResponse
	"Given a McpBridgeServer started on a test port with a client connected to it"
	| response expectedJson |
	McpBridgeServer startOn: 17894.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17894.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.

	"When the client sends the handshake request line"
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.

	"Then the client receives the handshake success response line"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": true, "result": {"protocol_version": 1}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testHandshakeRequestWithMismatchedVersionGetsProtocolMismatchError
	"Given a McpBridgeServer started on a test port with a client connected to it"
	| response expectedJson |
	McpBridgeServer startOn: 17895.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17895.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.

	"When the client sends a handshake request line with a protocol_version that does not match the server's own"
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 2}}', String lfString.

	"Then the client receives a protocol_mismatch error response line naming both versions"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "protocol_mismatch", "message": "protocol version mismatch: expected 1, got 2"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testMalformedJsonAfterHandshakeGetsInvalidRequestError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17896.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17896.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": true, "result": {"protocol_version": 1}}', String lfString.
	self assert: response equals: expectedJson.

	"When the client then sends a line of malformed JSON"
	clientSocket sendData: 'not valid json{', String lfString.

	"Then the client receives an invalid_request error response, and the connection is not dropped"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "invalid_request", "message": "malformed JSON request"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testHandshakeWithNonObjectParamsGetsInternalError
	"Given a McpBridgeServer started on a test port with a client connected to it"
	| response expectedJson |
	McpBridgeServer startOn: 17898.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17898.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.

	"When the client sends a handshake request whose params value is not an object/dictionary"
	clientSocket sendData: '{"op": "handshake", "params": "oops"}', String lfString.

	"Then the client receives an internal_error response, and the connection is not dropped"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "internal_error", "message": "unexpected error handling request: String>>between:and:"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testUnrecognizedOpAfterHandshakeGetsInvalidRequestError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17897.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17897.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": true, "result": {"protocol_version": 1}}', String lfString.
	self assert: response equals: expectedJson.

	"When the client then sends a well-formed request naming an unrecognized operation"
	clientSocket sendData: '{"op": "not_a_real_operation", "params": {}}', String lfString.

	"Then the client receives an invalid_request error response, and the connection is not dropped"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "invalid_request", "message": "unrecognized operation: not_a_real_operation"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testListCategoriesRequestGetsSortedCategoryList
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17899.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17899.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_categories request"
	clientSocket sendData: '{"op": "list_categories", "params": {}}', String lfString.

	"Then the client receives a success response whose result is an alphabetically sorted array of category names that includes categories known to exist in this image"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: (result includes: 'MCP-Bridge').
	self assert: (result includes: 'Tests-MCP-Bridge').
	self assert: result asSortedCollection asArray equals: result asArray! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testListClassesRequestGetsSortedClassListForCategory
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17900.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17900.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_classes request for an existing category"
	clientSocket sendData: '{"op": "list_classes", "params": {"category": "MCP-Bridge"}}', String lfString.

	"Then the client receives a success response whose result is the sorted array of class names in that category"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: result asArray equals: #('McpBridgeConnection' 'McpBridgeConnectionQueue' 'McpBridgeServer')! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 20:55:58'!
testListClassesRequestForNonexistentCategoryGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17901.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17901.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_classes request naming a category that does not exist in the image"
	clientSocket sendData: '{"op": "list_classes", "params": {"category": "NotARealCategory12345"}}', String lfString.

	"Then the client receives a not_found error response naming the missing category"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "category not found: ''NotARealCategory12345''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 3/Sep/2026 21:05:00'!
testListProtocolsRequestGetsInstanceAndClassSideProtocolLists
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17902.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17902.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_protocols request for an existing class"
	clientSocket sendData: '{"op": "list_protocols", "params": {"class": "McpBridgeConnection"}}', String lfString.

	"Then the client receives a success response whose result carries the instance-side and class-side protocol names, each sorted alphabetically"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: ((result at: 'instance') includes: 'private').
	self assert: ((result at: 'instance') includes: 'starting').
	self assert: (result at: 'instance') asArray asSortedCollection asArray equals: (result at: 'instance') asArray.
	self assert: ((result at: 'class') includes: 'accessing').
	self assert: ((result at: 'class') includes: 'instance creation').
	self assert: (result at: 'class') asArray asSortedCollection asArray equals: (result at: 'class') asArray! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 00:00:00'!
testListProtocolsRequestForNonexistentClassGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17903.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17903.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_protocols request naming a class that does not exist in the image"
	clientSocket sendData: '{"op": "list_protocols", "params": {"class": "NotARealClass12345"}}', String lfString.

	"Then the client receives a not_found error response naming the missing class"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "class not found: ''NotARealClass12345''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 00:00:00'!
testListMethodsRequestGetsSortedMethodListForClassProtocolAndSide
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17904.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17904.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a list_methods request for an existing class, protocol and side"
	clientSocket sendData: '{"op": "list_methods", "params": {"class": "McpBridgeConnection", "protocol": "private", "side": "instance"}}', String lfString.

	"Then the client receives a success response whose result is the sorted array of method selectors in that class, protocol and side"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: (result includes: 'handleHandshake:').
	self assert: result asArray asSortedCollection asArray equals: result asArray! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 21:00:00'!
testListMethodsRequestForNonexistentClassOrInvalidSideGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17905.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17905.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client sends a list_methods request naming a class that does not exist in the image"
	clientSocket sendData: '{"op": "list_methods", "params": {"class": "NotARealClass12345", "protocol": "private", "side": "instance"}}', String lfString.

	"Then the client receives a not_found error response naming the missing class"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "class not found: ''NotARealClass12345''"}}', String lfString.
	self assert: response equals: expectedJson.

	"When the client then sends a list_methods request for an existing class with an unrecognized side value"
	clientSocket sendData: '{"op": "list_methods", "params": {"class": "McpBridgeConnection", "protocol": "private", "side": "sideways"}}', String lfString.

	"Then the client receives a not_found error response, not invalid_request, since the side value is well-formed but not a valid enum member"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "side not found: ''', 'sideways', '''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 18:30:00'!
testListMethodsRequestForNonexistentProtocolGetsNotFoundErrorNotEmptyList
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17914.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17914.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client sends a list_methods request for an existing class and side, but a protocol name that does not exist on it"
	clientSocket sendData: '{"op": "list_methods", "params": {"class": "McpBridgeConnection", "protocol": "NotARealProtocol12345", "side": "instance"}}', String lfString.

	"Then the client receives a not_found error response naming the missing protocol, rather than a
	misleading empty success result (the underlying Categorizer>>listAtCategoryNamed: silently
	answers #() for an unknown category name, which would otherwise be indistinguishable from a
	real, empty protocol)"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "protocol not found: ''NotARealProtocol12345''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 21:30:00'!
testGetMethodSourceRequestGetsMethodSourceText
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17906.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17906.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_method_source request for an existing class, selector and side"
	clientSocket sendData: '{"op": "get_method_source", "params": {"class": "McpBridgeConnection", "selector": "setSocket:", "side": "instance"}}', String lfString.

	"Then the client receives a success response whose result is a string containing the method's source text"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: (result includesSubstring: 'setSocket:' caseSensitive: true).
	self assert: (result includesSubstring: 'socket := aSocket' caseSensitive: true)! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 23:00:00'!
testGetClassDefinitionRequestGetsClassDefinitionFields
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17908.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17908.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_class_definition request for an existing class"
	clientSocket sendData: '{"op": "get_class_definition", "params": {"class": "McpBridgeConnection"}}', String lfString.

	"Then the client receives a success response whose result carries the class's superclass name, instance variable names, class variable names and category"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: (result at: 'superclass') equals: 'Object'.
	self assert: (result at: 'instance_variable_names') asArray equals: #('socket' 'process').
	self assert: (result at: 'class_variable_names') asArray equals: #().
	self assert: (result at: 'category') equals: 'MCP-Bridge'! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 22:00:00'!
testGetMethodSourceRequestForInstanceOnlySelectorOnClassSideGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17907.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17907.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client sends a get_method_source request for a selector that only exists on the instance side, but names side: class"
	clientSocket sendData: '{"op": "get_method_source", "params": {"class": "McpBridgeConnection", "selector": "setSocket:", "side": "class"}}', String lfString.

	"Then the client receives a not_found error response, since the sides are independent namespaces and setSocket: is not implemented on the class side"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "method not found: McpBridgeConnection class>>setSocket:"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 23:30:00'!
testGetClassDefinitionRequestForNonexistentClassGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17909.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17909.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_class_definition request naming a class that does not exist in the image"
	clientSocket sendData: '{"op": "get_class_definition", "params": {"class": "NotARealClass12345"}}', String lfString.

	"Then the client receives a not_found error response naming the missing class"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "class not found: ''NotARealClass12345''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 23:45:00'!
testGetClassCommentRequestGetsClassCommentText
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response decoded result |
	McpBridgeServer startOn: 17910.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17910.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_class_comment request for a class with a comment set"
	clientSocket sendData: '{"op": "get_class_comment", "params": {"class": "McpBridgeServer"}}', String lfString.

	"Then the client receives a success response whose result contains the class's actual comment text"
	response := clientSocket receiveDataTimeout: 2.
	decoded := Json readFrom: (ReadStream on: response).
	self assert: (decoded at: 'ok') equals: true.
	result := decoded at: 'result'.
	self assert: (result includesSubstring: 'single-session, loopback-only, polling-based TCP server' caseSensitive: true)! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 23:50:00'!
testGetClassCommentRequestForNonexistentClassGetsNotFoundError
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17911.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17911.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_class_comment request naming a class that does not exist in the image"
	clientSocket sendData: '{"op": "get_class_comment", "params": {"class": "NotARealClass12345"}}', String lfString.

	"Then the client receives a not_found error response naming the missing class"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": false, "error": {"code": "not_found", "message": "class not found: ''NotARealClass12345''"}}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 23:55:00'!
testGetClassCommentRequestForUncommentedClassGetsNullResult
	"Given a McpBridgeServer started on a test port with a client connected to it that has already completed a successful handshake"
	| response expectedJson |
	McpBridgeServer startOn: 17912.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17912.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client then sends a get_class_comment request for a class that exists but has no comment set"
	clientSocket sendData: '{"op": "get_class_comment", "params": {"class": "McpBridgeConnectionQueue"}}', String lfString.

	"Then the client receives a success response whose result is JSON null, not an error and not the default comment template text"
	response := clientSocket receiveDataTimeout: 2.
	expectedJson := '{"ok": true, "result": null}', String lfString.
	self assert: response equals: expectedJson! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 16:15:00'!
testRequestLoopTerminatesCleanlyWhenSocketReceiveRaisesAnError
	"Given a McpBridgeConnection whose underlying socket raises an Error from receiveDataTimeout: (simulating a real VM primitive failure like SocketPrimitiveFailed)"
	| connection |
	connection := McpBridgeConnection on: McpBridgeFailingSocketStub new.

	"When the connection's request loop is started"
	connection start.
	(Delay forMilliseconds: 200) wait.

	"Then the request-loop process ends itself instead of leaving the error unhandled, which would otherwise open an interactive debugger and leave the process suspended forever"
	self assert: (connection instVarNamed: 'process') isTerminated! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 17:00:00'!
testVerboseDefaultsToFalse
	"The verbose flag is off by default, since logging is opt-in"
	self deny: McpBridgeServer verbose! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 17:30:00'!
testActiveConnectionSurvivesPastInactivityTimeoutWhenRequestsKeepArriving
	"Given a McpBridgeServer with a short inactivity timeout, and a connection that keeps sending requests spaced closer together than that timeout"
	| response |
	McpBridgeServer inactivityTimeoutSeconds: 0.3.
	McpBridgeServer startOn: 17913.
	clientSocket := Socket newTCP.
	clientSocket
		connectTo: (NetNameResolver addressFromString: '127.0.0.1')
		port: 17913.
	clientSocket waitForConnectionFor: 2.
	self assert: clientSocket isConnected.
	clientSocket sendData: '{"op": "handshake", "params": {"protocol_version": 1}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: response equals: ('{"ok": true, "result": {"protocol_version": 1}}', String lfString).

	"When the client sends two more requests, each within the timeout window of the previous one, but whose combined elapsed time exceeds the timeout"
	(Delay forMilliseconds: 200) wait.
	clientSocket sendData: '{"op": "list_categories", "params": {}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.
	self assert: (response includesSubstring: '"ok": true' caseSensitive: true).

	(Delay forMilliseconds: 200) wait.
	clientSocket sendData: '{"op": "list_categories", "params": {}}', String lfString.
	response := clientSocket receiveDataTimeout: 2.

	"Then the connection is still alive and answered the third request normally, since each gap between requests stayed under the timeout — activity, not mere age since accept, is what keeps a connection alive"
	self assert: (response includesSubstring: '"ok": true' caseSensitive: true).
	self assert: clientSocket isConnected! !

!McpBridgeTests methodsFor: 'tests' stamp: 'jlp 4/Sep/2026 17:00:00'!
testVerboseCanBeSetAndRead
	"Given verbose is set to true"
	McpBridgeServer verbose: true.

	"Then it reads back as true"
	self assert: McpBridgeServer verbose.

	"And setting it back to false reads back as false"
	McpBridgeServer verbose: false.
	self deny: McpBridgeServer verbose! !
