/* DummyPlugin — hand-written, minimal external plugin for exploring the
   VM/image primitive boundary. One primitive, primitiveDummyHello, takes a
   String argument and answers a freshly-allocated String: 'Hello world! ',
   aString — computed entirely in C, inside the VM, with no Smalltalk bytecode
   execution involved.

   Modeled on src/plugins/MD5Plugin/MD5Plugin.c and DESPlugin/DESPlugin.c,
   trimmed to the smallest shape a named/external primitive needs, plus the
   object-allocation calls (classString / instantiateClassindexableSize /
   methodReturnValue) needed to hand back a new object instead of a literal.
*/

#include "config.h"
#include <math.h>
#include "sqMathShim.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "sqConfig.h"
#include "sqVirtualMachine.h"
#include "sqPlatformSpecific.h"

#include "sqMemoryAccess.h"

#define true 1
#define false 0
#define null 0
#ifdef SQUEAK_BUILTIN_PLUGIN
# undef EXPORT
# define EXPORT(returnType) static returnType
# define INT_EXT "(i)"
#else
# define INT_EXT "(e)"
#endif

/*** Function Prototypes ***/
EXPORT(const char*) getModuleName(void);
EXPORT(sqInt) primitiveDummyHello(void);
EXPORT(sqInt) setInterpreter(struct VirtualMachine *anInterpreter);

/*** Variables ***/
#if !defined(SQUEAK_BUILTIN_PLUGIN)
static sqInt (*classString)(void);
static void * (*firstIndexableField)(sqInt oop);
static sqInt (*instantiateClassindexableSize)(sqInt classPointer, sqInt size);
static sqInt (*isBytes)(sqInt oop);
static sqInt (*methodArgumentCount)(void);
static sqInt (*methodReturnValue)(sqInt oop);
static sqInt (*primitiveFailFor)(sqInt reasonCode);
static sqInt (*stSizeOf)(sqInt oop);
static sqInt (*stackValue)(sqInt offset);
#else
extern sqInt classString(void);
extern void * firstIndexableField(sqInt oop);
extern sqInt instantiateClassindexableSize(sqInt classPointer, sqInt size);
extern sqInt isBytes(sqInt oop);
extern sqInt methodArgumentCount(void);
extern sqInt methodReturnValue(sqInt oop);
extern sqInt primitiveFailFor(sqInt reasonCode);
extern sqInt stSizeOf(sqInt oop);
extern sqInt stackValue(sqInt offset);
extern
#endif
struct VirtualMachine* interpreterProxy;
static const char *moduleName = "DummyPlugin 1.0 " INT_EXT;

/*** Methods ***/

EXPORT(const char*)
getModuleName(void)
{
	return moduleName;
}

	/* DummyPlugin>>#primitiveDummyHello
	   Answers a new String: 'Hello world! ', (the argument). */
EXPORT(sqInt)
primitiveDummyHello(void)
{
	static const char prefix[] = "Hello world! ";
	sqInt prefixSize = sizeof(prefix) - 1;
	sqInt argOop;
	sqInt argSize;
	char *argBytes;
	sqInt resultOop;
	char *resultBytes;

	if (!((methodArgumentCount()) == 1)) {
		return primitiveFailFor(PrimErrBadNumArgs);
	}
	argOop = stackValue(0);
	if (!(isBytes(argOop))) {
		return primitiveFailFor(PrimErrBadArgument);
	}
	argSize = stSizeOf(argOop);

	resultOop = instantiateClassindexableSize(classString(), prefixSize + argSize);
	if (resultOop == 0) {
		return primitiveFailFor(PrimErrNoMemory);
	}

	/* Allocation above may have triggered a GC that moved argOop, so
	   re-fetch its bytes pointer only now that we're done allocating. */
	argBytes = firstIndexableField(argOop);
	resultBytes = firstIndexableField(resultOop);
	memcpy(resultBytes, prefix, prefixSize);
	memcpy(resultBytes + prefixSize, argBytes, argSize);

	methodReturnValue(resultOop);
	return 0;
}

	/* InterpreterPlugin>>#setInterpreter: */
EXPORT(sqInt)
setInterpreter(struct VirtualMachine *anInterpreter)
{
	sqInt ok;

	interpreterProxy = anInterpreter;

	ok = ((interpreterProxy->majorVersion()) == (VM_PROXY_MAJOR))
		 && ((interpreterProxy->minorVersion()) >= (VM_PROXY_MINOR));
	if (ok) {
#if !defined(SQUEAK_BUILTIN_PLUGIN)
		classString = interpreterProxy->classString;
		firstIndexableField = interpreterProxy->firstIndexableField;
		instantiateClassindexableSize = interpreterProxy->instantiateClassindexableSize;
		isBytes = interpreterProxy->isBytes;
		methodArgumentCount = interpreterProxy->methodArgumentCount;
		methodReturnValue = interpreterProxy->methodReturnValue;
		primitiveFailFor = interpreterProxy->primitiveFailFor;
		stSizeOf = interpreterProxy->stSizeOf;
		stackValue = interpreterProxy->stackValue;
#endif
	}
	return ok;
}

/*** Exports ***/

#ifdef SQUEAK_BUILTIN_PLUGIN

static char _m[] = "DummyPlugin";
void* DummyPlugin_exports[][3] = {
	{(void*)_m, "getModuleName", (void*)getModuleName},
	{(void*)_m, "primitiveDummyHello\000\001\001", (void*)primitiveDummyHello},
	{(void*)_m, "setInterpreter", (void*)setInterpreter},
	{NULL, NULL, NULL}
};

#else // ifdef SQ_BUILTIN_PLUGIN

#if SPURVM
EXPORT(signed short) primitiveDummyHelloMetadata = 0x101;
#endif // SPURVM

#endif // ifdef SQ_BUILTIN_PLUGIN
