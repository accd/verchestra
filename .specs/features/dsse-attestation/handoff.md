---
schema: verchestra-feature-handoff/v1
feature: dsse-attestation
issue: 217
status: planned
branch: main
baseRevision: 6e0af0527d35080f178eafcfae7f00eb289378bd
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-08-09T00:00:00Z
---

# Scope

Decision record for adopting DSSE + in-toto as the Verchestra signature
envelope before 1.0 (review item R5). Decision mandatory before T76;
implementation is out of scope here.

# Completed Evidence

Decision spec written with three options (adopt DSSE/in-toto, document
proprietary, dual-format projection), verified current-state reading
(detached base64url over canonical JSON; trust root is envelope-agnostic),
and a mapping sketch showing the evidence model already fits an in-toto
Statement.

# Next Exact Action

T1: owner reviews the three options and records the choice as an
architecture decision in `.specs/STATE.md` (any time before T76 starts).

# Blockers

None.

# Decisions

- The decision itself is reserved for the owner; this feature carries the
  analysis, not the verdict.
- Any format change lands on top of `KeyProviderPort` (T68a), never on
  direct signer construction.

# Files Intentionally Left Unchanged

- All signing, verification, and fixture code.
- The `provenance.intoto.jsonl` bundle slot (becomes truthful only if
  Option A or C is chosen).
