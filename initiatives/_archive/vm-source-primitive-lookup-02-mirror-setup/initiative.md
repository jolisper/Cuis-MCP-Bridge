# VM Source: Primitive Lookup — Part 2: Mirror Setup

`setup_vm_mirror()` creates the shared bare mirror at `~/.cuis-mcp-bridge/vm-mirror` if it
doesn't exist yet. It starts the clone in the background and returns immediately, so no
tool call ever waits on the roughly 750 MB download (see "Mirror creation" under Decisions).

See [../vm-source-primitive-lookup/initiative.md](../vm-source-primitive-lookup/initiative.md).
