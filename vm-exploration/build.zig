const std = @import("std");

// Builds DummyPlugin (C) and DummyPluginZig (Zig) into loadable macOS
// plugin .bundle files using Zig's own build system, instead of the VM's
// own Make-based build (for DummyPlugin) or the old two-step shell script
// (for DummyPluginZig, see tools/build-dummy-plugin-zig.sh's history).
//
// Both are external, dlopen'd plugins with no link-time dependency on the
// VM binary -- see docs/PluginManual.md -- so they only need to be compiled
// against the VM's real headers for a binary-compatible ABI. That's a
// property of the plugin ABI itself, not of the VM's own build tooling, so
// nothing here requires ../opensmalltalk-vm's Makefiles.
//
// Usage (from this directory, vm-exploration/):
//   zig build                     # builds both
//   zig build dummy-plugin        # just DummyPlugin.bundle (C)
//   zig build dummy-plugin-zig    # just DummyPluginZig.bundle (Zig)
//
// Output: build/<Name>/<Name>.bundle (gitignored).
// Requires: ../opensmalltalk-vm checked out (tools/fetch-vm.sh, from the
// repo root).

const vm_dir = "../opensmalltalk-vm";
const build_dir = "build";

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{ .cpu_arch = .aarch64, .os_tag = .macos });
    const optimize = b.standardOptimizeOption(.{});

    // The VM's real headers -- sqVirtualMachine.h (the proxy struct layout),
    // interp.h (sqInt/usqInt for this VM variant), config.h (macOS build
    // config) -- are what makes an externally-built plugin binary ABI
    // compatible with the running VM. Traced with `clang -H`; see
    // docs/PluginManual.md.
    const vm_include_dirs = [_][]const u8{
        vm_dir ++ "/platforms/Cross/vm",
        vm_dir ++ "/src/spur64.cog",
        vm_dir ++ "/platforms/iOS/vm/OSX",
    };

    const dummy_plugin = addCPlugin(b, target, optimize, &vm_include_dirs);
    const dummy_plugin_zig = addZigPlugin(b, target, optimize, &vm_include_dirs);

    b.step("dummy-plugin", "Build DummyPlugin.bundle (C)").dependOn(dummy_plugin);
    b.step("dummy-plugin-zig", "Build DummyPluginZig.bundle (Zig)").dependOn(dummy_plugin_zig);

    b.getInstallStep().dependOn(dummy_plugin);
    b.getInstallStep().dependOn(dummy_plugin_zig);
}

fn addCPlugin(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.Optimize,
    include_dirs: []const []const u8,
) *std.Build.Step {
    const name = "DummyPlugin";

    // Matches the VM's own Makefile.plugin build, which never enables UBSan
    // for this plugin; a plain `clang -bundle` link step doesn't pull in the
    // UBSan runtime, so leaving Zig's debug-mode instrumentation on leaves
    // __ubsan_handle_* symbols undefined at link time.
    const mod = b.createModule(.{
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .sanitize_c = .off,
    });
    for (include_dirs) |dir| mod.addIncludePath(b.path(dir));
    mod.addCMacro("HAVE_CONFIG_H", "1");
    mod.addCMacro("DEBUGVM", "0");
    mod.addCMacro("NDEBUG", "1");
    mod.addCMacro("BUILD_FOR_OSX", "1");
    mod.addCMacro("USE_METAL", "1");
    mod.addCMacro("USE_CORE_GRAPHICS", "1");
    mod.addCMacro("USE_INLINE_MEMORY_ACCESSORS", "1");
    mod.addCSourceFile(.{ .file = b.path("plugins/DummyPlugin/DummyPlugin.c") });

    const obj = b.addObject(.{ .name = name, .root_module = mod });
    return linkBundle(b, name, obj.getEmittedBin());
}

fn addZigPlugin(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.Optimize,
    include_dirs: []const []const u8,
) *std.Build.Step {
    const name = "DummyPluginZig";

    // Replaces the old inline @cImport(@cInclude("sqVirtualMachine.h")) --
    // that builtin was removed upstream in favor of this explicit
    // translate-c build step, imported as "cimport" from DummyPlugin.zig.
    const translate_c = b.addTranslateC(.{
        .root_source_file = b.path(vm_dir ++ "/platforms/Cross/vm/sqVirtualMachine.h"),
        .target = target,
        .optimize = optimize,
    });
    for (include_dirs) |dir| translate_c.addIncludePath(b.path(dir));

    const mod = b.createModule(.{
        .root_source_file = b.path("plugins/DummyPluginZig/DummyPlugin.zig"),
        .target = target,
        .optimize = optimize,
    });
    mod.addImport("cimport", translate_c.createModule());

    const obj = b.addObject(.{ .name = name, .root_module = mod });
    return linkBundle(b, name, obj.getEmittedBin());
}

// Links a compiled object into a macOS plugin .bundle, the same way the
// VM's own Makefile.plugin does (`clang -bundle`) -- see docs/PluginManual.md's
// "Any language works, not just C".
fn linkBundle(b: *std.Build, name: []const u8, obj: std.Build.LazyPath) *std.Build.Step {
    const out_dir = b.fmt("{s}/{s}/{s}.bundle/Contents/MacOS", .{ build_dir, name, name });

    const mkdir = b.addSystemCommand(&.{ "mkdir", "-p", out_dir });
    mkdir.setCwd(b.path("."));

    const link = b.addSystemCommand(&.{
        "clang",       "-arch",              "arm64",
        "-mmacosx-version-min=11.0", "-bundle",
        "-isysroot",   macosSdkPath(b),
    });
    link.setCwd(b.path("."));
    link.addFileArg(obj);
    link.addArg("-o");
    link.addArg(b.fmt("{s}/{s}", .{ out_dir, name }));
    link.step.dependOn(&mkdir.step);

    return &link.step;
}

fn macosSdkPath(b: *std.Build) []const u8 {
    // Mirrors `xcrun --sdk macosx --show-sdk-path`, run once at configure
    // time -- see tools/build-dummy-plugin-zig.sh, the script this replaces.
    const stdout = b.run(&.{ "xcrun", "--sdk", "macosx", "--show-sdk-path" });
    return std.mem.trimEnd(u8, stdout, "\n");
}
