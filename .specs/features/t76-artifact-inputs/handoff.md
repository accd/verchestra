---
schema: verchestra-feature-handoff/v1
feature: t76-artifact-inputs
issue: 17
status: in_progress
branch: codex/issue-17-t76-artifact-inputs
baseRevision: 56ac0ce96d793517964b5828edd228bef4e1086b
lastCompletedTask: T4
nextTask: "Produce real isolated target artifacts and their SBOM, license, provenance, and evaluation inputs."
lastGate: "gate:quick and gate:release PASS; independent review pending"
updatedAt: 2026-08-24T00:00:00Z
---

# Scope completed

The new file-backed collector reads real bytes below one isolated build root,
rejects traversal, missing, directory, and symlink sources, and delegates the
result to the existing hermetic bundle validator. Tests prove digest/size
derivation, order-independent identity, root-path redaction, and boundary
errors.

# Remaining work

This is an incremental T4 slice, not a public release. Real reproducible target
builds, SBOM/license/provenance/evaluation generation, TUF root/delegations,
four independently equivalent views, rollback execution, and an independent
T76 validation report are still required before #17 can close.
