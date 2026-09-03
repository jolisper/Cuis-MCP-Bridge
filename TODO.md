# TODO

## cuis-mcp-bridge — Package vs. Category scope

Cuis organizes code at two distinct levels:

- **Package** (`.pck.st` files, `!provides:`) — the unit of loading/distribution.
- **Category** (`SystemOrganization`) — how classes are classified within the System
  Browser; this is what `initiatives/cuis-mcp-bridge` currently exposes (categories,
  classes, protocols, methods).

The initiative deliberately scopes the first delivery to categories only, matching "browse
like the System Browser." Packages are out of scope for now.

Revisit later: it may be useful for the bridge to also expose Package-level reflection (e.g.
"which `.pck.st` does this class live in") once the category-based read-only slice is done.
