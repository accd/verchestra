---
schema: verchestra-feature-handoff/v1
feature: key-lifecycle
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

Persistent signing-key lifecycle for the evidence trust boundary:
`KeyProviderPort`, encrypted-file adapter, rotation with overlap,
revocation, composition-root wiring, and the two-machine portability proof
(review item R1 + demo R13). Roadmap task T68a.

# Completed Evidence

Specification, design, and tasks written from verified code reading:
`signer.ts` has only `generate()`; no product wiring constructs a signer;
`PublicKeyRef` already supports purposes and validity windows;
`ArtifactSealer` verifies Ed25519.

# Next Exact Action

T1: define `KeyProviderPort` in `packages/evidence/src/integrity/` and the
new public error codes (`VES_KEYSTORE_INTEGRITY`, `VES_KEY_REVOKED`,
`VES_KEY_EXPIRED`) through the schema generator in `schemas/`.

# Blockers

None.

# Decisions

- Encrypted-file adapter first; KMS/keychain/sigstore are later adapters
  behind the same port.
- Historical evidence keeps its recorded verdict after revocation;
  revocation blocks new artifacts only.
- Starting T68a includes the deliberate status-surface migration from
  "T69 next" to "T68a next" recorded in the external-review-triage handoff.

# Files Intentionally Left Unchanged

- All product code and tests (specification-only so far).
- The canonical JSON and signature format (owned by the DSSE decision).
