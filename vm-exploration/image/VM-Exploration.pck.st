'From Cuis7.8 [latest update: #7959] on 24 September 2026 at 10:00:00 am'!
'Description '!
!provides: 'VM-Exploration' 1 1!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #'VM-Exploration'!

!classDefinition: #DummyPrimitiveDemo category: #'VM-Exploration'!
Object subclass: #DummyPrimitiveDemo
	instanceVariableNames: ''
	classVariableNames: ''
	poolDictionaries: ''
	category: 'VM-Exploration'!

!DummyPrimitiveDemo commentStamp: 'jlp 24/Sep/2026 10:00:00' prior: 0!
A scratch class for exploring the boundary between the VM and the image. `hello:` calls a hand-written external plugin primitive (DummyPlugin>>primitiveDummyHello, in opensmalltalk-vm/src/plugins/DummyPlugin/, tracked at vm-exploration/plugins/DummyPlugin/) that allocates a new String directly in C and answers a greeting for its argument. If the primitive fails (plugin not loaded, wrong VM), the Smalltalk fallback computes the identical result in pure Smalltalk instead -- same answer, two completely different execution paths, distinguishable only by which one actually ran.

Note for editors of this file: it is Cuis bang/chunk format, where every exclamation mark is a chunk delimiter -- including ones inside comments and string literals. A literal exclamation mark in the greeting text is therefore built at runtime via Character value: 33, never typed directly into this source file.!

!DummyPrimitiveDemo class methodsFor: 'primitives' stamp: 'jlp 24/Sep/2026 10:00:00'!
hello: aString
	"Calls the DummyPlugin external primitive, which builds a greeting for
	aString as a new object in C, inside the VM. If the primitive fails,
	this identical Smalltalk expression runs instead."
	<primitive: 'primitiveDummyHello' module: 'DummyPlugin'>
	^ 'Hello world', (Character value: 33) asString, ' ', aString! !

!DummyPrimitiveDemo class methodsFor: 'primitives' stamp: 'jlp 24/Sep/2026 16:20:00'!
helloZig: aString
	"Same primitive, same VM primitive ABI, but the C side is written in
	Zig instead (DummyPluginZig, tracked at vm-exploration/plugins/DummyPluginZig/).
	If the primitive fails, this Smalltalk fallback runs instead -- note its
	text differs from hello:'s fallback, so the two are distinguishable even
	without a marker in the primitive itself."
	<primitive: 'primitiveDummyHello' module: 'DummyPluginZig'>
	^ 'SMALLTALK FALLBACK (Zig primitive unavailable): ', aString! !
