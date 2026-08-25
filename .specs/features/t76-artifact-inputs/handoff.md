---
schema: verchestra-feature-handoff/v1
feature: t76-artifact-inputs
issue: 17
status: in_progress
branch: codex/issue-17-candidate-manifest
baseRevision: 1f034e3be8b0252963208d8bab26e3839c68f558
lastCompletedTask: T4
nextTask: "Dispatch t76-candidate-build.yml at an exact reviewed SHA, retain the five target artifacts and reconciled index, then materialize the four views and rollback proof before TUF publication."
lastGate: "HEAD 71b9089; workflow contract suite 6/6; agent:check PASS; gate:quick PASS (2093 unit + 159 readiness) and gate:release PASS (2093 unit + 39 architecture + 251 qualification + 1087 security + 284 fault + 28 release); dispatch and independent review pending"
updatedAt: 2026-08-25T06:40:00Z
---

# Scope completed

The new file-backed collector reads real bytes below one isolated build root,
rejects traversal, missing, directory, and symlink sources, and delegates the
result to the existing hermetic bundle validator. Tests prove digest/size
derivation, order-independent identity, root-path redaction, and boundary
errors.

The `scripts/t76-build-candidate.mjs` boundary now turns an exact checked-out
revision plus the host's real Node/native assets into that isolated root. The
`scripts/t76-materialize-candidate.mjs` boundary validates the resulting
bundle, component projection, build-info, payload bytes, four views, and
rollback proof before writing a canonical candidate manifest. The builder
requires all five passing gate evaluations with zero skips, todos, or surviving
mutants, and writes only portable bundle, component, evidence, and build-info
records. The requested target must equal the actual host and Node version; a
caller cannot label one platform's bytes as another platform's candidate.

# Remaining work

This is still an incremental T4 slice, not a public release. The boundaries
must be executed on all supported targets with their exact gate evidence, then
the resulting candidate must be wired to TUF root/delegations, four
independently equivalent views, rollback execution, an approved release signing
identity, and an independent T76 validation report before #17 can close.
