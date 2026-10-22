# VM Source: Primitive Lookup — Part 3: Source Lookup

Some methods, though, are backed by primitives implemented in the VM itself — C code in
`OpenSmalltalk/opensmalltalk-vm` — and there is currently no way for an assistant to go from
"this method has `<primitive: ... module: 'SocketPlugin'>`" to "here is the actual C
implementation behind it."

See [../vm-source-primitive-lookup/initiative.md](../vm-source-primitive-lookup/initiative.md).
