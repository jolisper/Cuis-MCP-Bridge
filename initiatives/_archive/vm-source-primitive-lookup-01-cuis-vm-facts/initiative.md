# VM Source: Primitive Lookup — Part 1: Cuis VM Facts

**Cuis-side** (`mcp-bridge/image/`): expose four read-only calls, same shape as the
existing reflection tools, each its own call rather than one bundled "VM build info" call
(see Decisions) — this is the only part that needs the live image, since only the image
knows which VM binary is actually running it.

See [../vm-source-primitive-lookup/initiative.md](../vm-source-primitive-lookup/initiative.md).
