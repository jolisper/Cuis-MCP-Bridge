# Cuis MCP Bridge

## Problem

Cuis Smalltalk is a live-image system: its classes, categories, protocols, and methods exist
as reflectable state inside a running process, not as a static file tree that external tools
can grep or parse meaningfully. There is currently no way for an AI coding assistant (or any
external tool) to inspect the system the way a developer would through the Cuis System
Browser — by category, by class, by protocol, down to individual method source. Any
assistance with Cuis development today requires a human to manually copy-paste Browser
contents into the conversation, which is slow and error-prone, and gives the assistant no
way to explore beyond what was pasted.

Beyond inspection, there is also no way for an external tool to make changes to the image —
defining classes, adding methods, changing categorization — without a human performing every
edit by hand inside the Browser.

## Goals

- Let an AI assistant (via Claude Code) explore a running Cuis image's structure — categories,
  classes, protocols, methods, method source, class comments and definitions — with the same
  fidelity as browsing it manually in the Cuis System Browser.
- Make that exploration reflect the actual live state of the running image, not a stale or
  static snapshot.
- Establish a channel between external tooling and the image that can later support making
  changes to the image (defining classes, compiling methods) without requiring a different
  architecture than the one used for browsing.

## Non-goals

- Modifying the image is out of scope for the first delivery — the initial capability is
  read-only exploration only. Write operations are an explicit follow-on, not bundled in.
- No general-purpose Smalltalk REPL or arbitrary code evaluation exposed through this
  channel — access is scoped to structured reflection operations (and later, structured
  authoring operations), not open `doIt` execution.
- Not building a new UI or replacing the Cuis System Browser — this is a parallel access path
  for external tooling, not a Browser replacement.
- Not concerned with multi-user or concurrent-access scenarios — this is aimed at a single
  developer working against their own local image.

## Scope

Touches two things, developed and versioned separately:

- A small addition inside the Cuis image itself (a Smalltalk-side component) that exposes
  the image's structure and, later, accepts authoring commands, over some external-facing
  channel. This lives in its own repository, separate from the Cuis distribution repo
  (`Cuis7-8-main`) that was just placed under git.
- An external process that speaks the Model Context Protocol (MCP) on one side, so Claude
  Code can use it as a set of tools, and talks to the Cuis-side component on the other side.

Effort is small-to-moderate for the read-only slice: a handful of reflection operations
(categories, classes, protocols, methods, source, comments) and a thin external process to
expose them as MCP tools. The write-capable follow-on is a separate, later increment that
reuses the same channel rather than introducing a new one.

## Open questions

- What should the external-facing channel's transport and message format be, concretely
  (e.g. sockets vs. something else, and the exact message shape)? Noted as a candidate
  direction from prior discussion, not yet locked in at the intent level.
- What language/runtime the external MCP-facing process should be built in is still a
  first-version-vs-later-iteration question — prior discussion leaned toward whatever is most
  accessible now, with room to revisit.
- How will the two repositories (Cuis distribution and the bridge) be kept in sync as the
  Cuis-side component evolves alongside the external process?
