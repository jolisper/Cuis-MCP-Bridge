// DummyPluginZig — the same primitive as DummyPlugin.c, written in Zig instead
// of hand-written C, to show the VM's plugin ABI is language-agnostic: any
// language that can produce a C-ABI-compatible loadable bundle exporting
// getModuleName / setInterpreter / a primitive function works.
//
// "cimport" is a module build.zig produces by running sqVirtualMachine.h
// through TranslateC, so `struct_VirtualMachine` here has the exact same
// binary layout the VM itself uses -- no hand-mirrored struct, no offset
// bugs. (Older Zig versions did this inline via @cImport/@cInclude; that
// builtin was removed in favor of the explicit build-step form used here.)

const c = @import("cimport");

const sqInt = c.sqInt;

var interpreterProxy: [*c]c.struct_VirtualMachine = null;

export fn getModuleName() [*:0]const u8 {
    return "DummyPluginZig 1.0 (e)";
}

export fn setInterpreter(anInterpreter: [*c]c.struct_VirtualMachine) sqInt {
    interpreterProxy = anInterpreter;
    const proxy = interpreterProxy.*;
    const major = proxy.majorVersion.?();
    const minor = proxy.minorVersion.?();
    if (major != c.VM_PROXY_MAJOR or minor < c.VM_PROXY_MINOR) return 0;
    return 1;
}

// DummyPluginZig>>#primitiveDummyHello
// Answers a new String: 'Hello world from Zig! ', (the argument).
export fn primitiveDummyHello() sqInt {
    const proxy = interpreterProxy.*;

    if (proxy.methodArgumentCount.?() != 1) {
        return proxy.primitiveFailFor.?(c.PrimErrBadNumArgs);
    }
    const argOop = proxy.stackValue.?(0);
    if (proxy.isBytes.?(argOop) == 0) {
        return proxy.primitiveFailFor.?(c.PrimErrBadArgument);
    }
    const argSize = proxy.stSizeOf.?(argOop);

    const prefix = "Hello world from Zig! ";
    const prefixSize: sqInt = @intCast(prefix.len);

    const resultOop = proxy.instantiateClassindexableSize.?(proxy.classString.?(), prefixSize + argSize);
    if (resultOop == 0) {
        return proxy.primitiveFailFor.?(c.PrimErrNoMemory);
    }

    // Allocation above may have triggered a GC that moved argOop, so
    // re-fetch its bytes pointer only now that we're done allocating.
    const argBytes: [*]const u8 = @ptrCast(proxy.firstIndexableField.?(argOop).?);
    const resultBytes: [*]u8 = @ptrCast(proxy.firstIndexableField.?(resultOop).?);

    @memcpy(resultBytes[0..@intCast(prefixSize)], prefix);
    @memcpy(resultBytes[@intCast(prefixSize)..@intCast(prefixSize + argSize)], argBytes[0..@intCast(argSize)]);

    _ = proxy.methodReturnValue.?(resultOop);
    return 0;
}

// Arg-count hint for the Spur VM's primitive metadata table -- 0x101 means
// "one real argument", matching DummyPlugin.c's own primitiveDummyHelloMetadata.
export var primitiveDummyHelloMetadata: i16 = 0x101;
