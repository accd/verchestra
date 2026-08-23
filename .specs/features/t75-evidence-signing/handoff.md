---
schema: verchestra-feature-handoff/v1
feature: t75-evidence-signing
issue: 294
status: blocked
branch: codex/issue-294-t75-evidence-signature
baseRevision: d5c7c75276bc0a972c18d8b3860531ddb98c2ef7
lastCompletedTask: T2
nextTask: Owner-provision the protected secret and a matching committed PublicKeyRef, then run the exact-SHA workflow and obtain independent verification; do not provision or access a release key locally.
lastGate: focused signing/workflow tests and pnpm gate:quick PASS; pnpm gate:security reached E2E but a disposable-repository cleanup hit a Windows EBUSY lock, pending the separately reviewed cleanup fix
updatedAt: 2026-08-23T00:00:00Z
---

# Scope

Issue #294 adds a T75-specific signing path around the existing canonical
evidence index. It does not replace release metadata, test-only artifact
signers, or the existing DSSE migration.

# Decision

Release qualification uses a repository-owner-provisioned PKCS#8 Ed25519 key
only through a protected GitHub Actions secret. A committed public `PublicKeyRef`
must match the public key derived from that private material before signing.
The trusted output is a DSSE envelope with an in-toto
`qualification-evidence-index` predicate; a separate verifier checks it using
only the public reference and index.

# Completed implementation

T1 provides a closed predicate registry plus a signer and public verifier. The
signer accepts private material only through the protected workflow environment,
derives its public identity, and rejects any mismatch with the committed
`PublicKeyRef` before producing output. T2 regenerates the unsigned canonical
index from all five profile artifacts at the requested revision, rejects
contradictions, verifies the result before publishing, and exposes only public
verification artifacts.

# Blockers

The implementation is merged in PR #303 and the issue is closed, but the
qualification path is blocked until the owner provisions the protected secret
and commits the matching public reference through human review. The public
reference is intentionally absent until that action, so the workflow cannot
produce a real attestation yet. Automation must not generate, access, print,
or commit either private material or any secret value.
