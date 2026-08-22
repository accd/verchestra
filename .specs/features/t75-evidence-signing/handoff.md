---
schema: verchestra-feature-handoff/v1
feature: t75-evidence-signing
issue: 294
status: in_progress
branch: codex/issue-294-t75-evidence-signature
baseRevision: d5c7c75276bc0a972c18d8b3860531ddb98c2ef7
lastCompletedTask: T0
nextTask: Implement the fail-closed signer and verifier with ephemeral test fixtures; do not provision a release key.
lastGate: agent:check and format:check PASS
updatedAt: 2026-08-22T21:05:00Z
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

# Blocker

The owner must provision the protected secret and commit the matching public
reference through human review. Automation must not generate, access, print, or
commit either private material or any secret value.
