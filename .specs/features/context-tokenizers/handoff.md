---
schema: verchestra-feature-handoff/v1
feature: context-tokenizers
issue: null
status: planned
branch: main
baseRevision: 6e0af0527d35080f178eafcfae7f00eb289378bd
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-07-26T17:54:19Z
---

# Scope

Decision record for replacing the injected, unimplemented token estimator
in `DeterministicContextCompiler` with a qualified default whose identity
is recorded in the context manifest digest (review item R6). Decision
mandatory before T76; implementation is out of scope here.

# Completed Evidence

Decision spec written with three options (real per-model tokenizers, one
pinned deterministic estimator, hybrid), verified current-state reading
(`context-compiler.ts:140-151` injection; only test fixtures implement
estimators), and the portability failure mode documented.

# Next Exact Action

T1: owner picks an option and records it in `.specs/STATE.md`; if the
choice adds a dependency, obtain explicit approval and a lockfile update
before any code.

# Blockers

None.

# Decisions

- The decision itself is reserved for the owner; this feature carries the
  analysis.
- Tokenizer identity goes into the manifest digest regardless of option.

# Files Intentionally Left Unchanged

- `context-compiler.ts` and all fixtures.
- The dependency manifest and lockfile.
