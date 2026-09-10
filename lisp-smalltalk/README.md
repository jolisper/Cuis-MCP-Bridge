# Lisp in Smalltalk

An exercise: implement Lisp in Cuis Smalltalk, using the `Cuis-MCP-Bridge` bridge
purely as an exploration tool (read-only reflection into the live image) to inform
design decisions along the way, instead of guessing Cuis kernel APIs.

## Scope

McCarthy's original minimal core — the 7 primitives from "Recursive Functions of
Symbolic Expressions", plus `lambda`/`label` for defining and naming functions:

`quote`, `atom`, `eq`, `car`, `cdr`, `cons`, `cond`, `lambda`, `label`
(named `quote`, `atom?`, `eq?`, `first`, `rest`, `cons`, `cond`, `lambda`,
`label` here — see naming rationale below)

Explicitly out of scope for this pass: Scheme-like closures/tail-call
optimization, macros, quasiquote/unquote. Those are larger follow-on exercises,
not this one.

## Process

Exploratory/informal — no `functional-spec.md`/`technical-spec.md` and no strict
TDD `spec-implement` flow (unlike `mcp-bridge`, which used that rigor). This file
is the only running record of decisions.

## Primitive names

Kept the classic McCarthy names where they're already clear; renamed the two that
read poorly or actively conflict with modern Lisp conventions. Considered
Clojure's naming as a reference point, but didn't default to it mechanically —
Clojure's own `atom` means something unrelated (a mutable reference), and its
`fn`/`=` aren't drop-in equivalents for `lambda`/`eq?` here.

| McCarthy original | Name used here | Why |
|---|---|---|
| `quote` | `quote` | already clear; Clojure keeps the same name too |
| `atom` | `atom?` | `?` suffix follows Lisp/Scheme/Clojure predicate convention; renaming avoids colliding with Clojure's *different* meaning of `atom` (a mutable ref) |
| `eq` | `eq?` | `?` suffix for the same predicate-naming reason as `atom?` — Scheme names this `eq?` for the same reason (considered `identical?`/`=` too, kept the classic root name) |
| `car` | `first` | `first`/`rest` are self-explanatory in a way `car`/`cdr` (register-name history, not meaning) never were |
| `cdr` | `rest` | see above |
| `cons` | `cons` | already clear; Clojure keeps the same name too |
| `cond` | `cond` | already clear; Clojure keeps the same name too |
| `lambda` | `lambda` | kept as-is (considered `fn`, kept the classic name) |
| `label` | `label` | kept as-is — see below for what it does |

### What `label` does

`lambda` alone can't recurse: an anonymous function has no name to call itself
by from inside its own body. `label` gives a function a name that's visible
**from within its own body**, specifically so it can call itself:

```lisp
(label fact
  (lambda (n)
    (cond ((eq? n 0) 1)
          (t (fact (sub1 n))))))
```

When this is invoked, the body's environment has both the parameter (`n`) *and*
the function's own name (`fact`) bound — so the recursive call inside the body
resolves correctly.

`label` is a **special form**, not a normal function call: its second argument
(the `lambda` expression) is not evaluated the usual way — the evaluator must
recognize `label` by name and handle it specially, the same way it already must
for `quote` and `cond`. The reader needs no special support for it at all:
`(label fact (lambda (n) ...))` reads as an ordinary nested list, indistinguishable
from any other form at parse time.

(Clojure's `(fn name [args] ...)` — a `fn` with its own name, visible only for
self-recursion — is the direct modern descendant of this same mechanism, just
folded into `fn` instead of being a separate form.)

### Example: `first`/`rest` vs `car`/`cdr`

```lisp
;; with the names used here
(label sum
  (lambda (xs)
    (cond ((atom? xs) 0)
          (t (+ (first xs) (sum (rest xs)))))))

;; classic McCarthy naming, for comparison
(label sum
  (lambda (xs)
    (cond ((atom xs) 0)
          (t (+ (car xs) (sum (cdr xs)))))))
```

## Data representation

- **Atoms**: Lisp symbols map directly to Smalltalk `Symbol` (interned, no
  wrapper class needed). Numbers map directly to Smalltalk `Integer`/`Float`.
- **NIL / empty list**: Smalltalk's own `nil` doubles as Lisp's `NIL` — no
  separate singleton class.
- **Pairs**: a new class, `LispCons`, with `car`/`cdr` instance variables and
  accessors. A proper list is a chain of `LispCons` terminated by `nil`; an
  improper (dotted) list is a chain terminated by some other non-`LispCons`
  object.

## Reader (done)

`LispReader` — a tokenizer + recursive-descent parser over a `ReadStream`,
producing the data representation above from source text. Handles:

- Symbol and number atoms (leading `-`/`+` only starts a number if followed by
  a digit — `-foo` reads as a symbol, `-7` as a number)
- Symbol atoms containing characters invalid in bare Smalltalk identifiers
  (`?`, `!`, embedded `-`) — these need Smalltalk's quoted-symbol syntax
  (`#'list?'`) when writing them as literals in test code, a real gotcha hit
  while writing the test suite
- Proper lists `(a b c)`, dotted pairs `(a . b)`, and nested lists
- The quote shorthand `'expr`, desugared to `(quote expr)`
- Line comments (`;` to end of line)
- Malformed input (unmatched `)`, unterminated list, malformed dotted list)
  signals `LispReaderError`, not a generic Smalltalk error

22/22 SUnit tests pass (`lisp-smalltalk/Tests-LispReader.pck.st`), verified via
`tools/run-headless-tests.sh lisp-smalltalk/run-tests.st`.

A real bug was found and fixed via this test suite: `parseListAfterOpenParen`
recursed into itself to parse a list's remaining elements, but its first line
unconditionally consumed a leading `(` — correct only for the very first call,
so every element past the first ate one extra character. Fixed by splitting
into `parseListAfterOpenParen` (consumes the `(` once) and `parseListElements`
(the actual recursive body, expecting no `(`).

## REPL window (prototype, dummy evaluator)

`LispWorkspace.pck.st` — a working proof that Cuis's `Workspace`/`TextEditor`
machinery can host a Lisp REPL, built by exploring the live image via the bridge
rather than guessing:

- `Workspace`'s `editorClass` method (answers `SmalltalkEditor` by default) is
  the extension point — `LispWorkspace` overrides it to answer `LispEditor`
  instead. Traced end-to-end: `Workspace>>openLabel:` → `WorkspaceWindow` →
  `TextModelMorph` → `InnerTextMorph`, which lazily does
  `model editorClass new morph: self` the first time it needs an editor.
- `LispEditor` subclasses `TextEditor` (not `SmalltalkEditor` — no Smalltalk
  compiler involved), and implements `printIt`/`defaultMenuSpec` itself, since
  plain `TextEditor` has no do-its at all (those live only in `SmalltalkEditor`
  today).
- `LispEditor>>printIt` is currently a **dummy**: it reverses the selected text
  and inserts the result, just to validate the full interaction (select text →
  evaluate → insert result) before wiring a real evaluator.

Open it with:

```smalltalk
LispWorkspace new contents: ''; openLabel: 'Lisp Workspace'.
```

## Status / what's left

- [x] Reader/parser, with tests
- [x] REPL-window UI proven out end-to-end (dummy evaluator)
- [x] Primitive naming decided (this document)
- [ ] Real evaluator (`eval: expr env:`) implementing the primitives above
- [ ] Wire `LispEditor>>printIt` to the real evaluator instead of the `reversed`
      dummy
