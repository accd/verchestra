---
schema: verchestra-feature-handoff/v1
feature: t76-artifact-inputs
issue: 17
status: in_progress
branch: codex/issue-17-real-inputs
baseRevision: f13ae8e5855d8430dbdfe558d8171305663962b5
lastCompletedTask: T4
nextTask: "Run the builder on every supported target with exact gate evidence, then bind the resulting bytes to the candidate and approved TUF signing identity."
lastGate: "focused reproducible-target-build suite 3/3; typecheck and agent:check PASS; gate:quick, gate:security, and gate:release PASS with zero failures/skips/todos; independent review pending"
updatedAt: 2026-08-25T03:45:00Z
---

# Scope completed

The new file-backed collector reads real bytes below one isolated build root,
rejects traversal, missing, directory, and symlink sources, and delegates the
result to the existing hermetic bundle validator. Tests prove digest/size
derivation, order-independent identity, root-path redaction, and boundary
errors.

The `scripts/t76-build-candidate.mjs` boundary now turns an exact checked-out
revision plus the host's real Node/native assets into that isolated root. It
requires all five passing gate evaluations with zero skips, todos, or surviving
mutants, and writes only portable bundle, component, evidence, and build-info
records. The requested target must equal the actual host and Node version; a
caller cannot label one platform's bytes as another platform's candidate.

# Remaining work

This is still an incremental T4 slice, not a public release. The boundary must
be executed on all supported targets with their exact gate evidence, then the
resulting candidate must be wired to TUF root/delegations, four independently
equivalent views, rollback execution, an approved release signing identity, and
an independent T76 validation report before #17 can close.
