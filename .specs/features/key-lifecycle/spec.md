# Key Lifecycle Specification

## Problem Statement

`NodeEd25519Signer` (`packages/evidence/src/integrity/signer.ts:19-59`) has a
single creation path, `generate()`, which calls `generateKeyPairSync` and
lets the private key die with the process. There is no `load()`, no
persistence, no rotation, and no revocation. Worse, `generate()` is called
only from tests and fixtures — no product wiring holds a signer at all. The
surrounding structure is ready: `PublicKeyRef` carries `purposes`,
`validFrom`, and `validUntil`; `ArtifactSealer` verifies Ed25519 properly; a
trust root exists. Without a key lifecycle, an Execution Package sealed on
one machine can never be verified on another, which breaks the central
portability promise of the product.

## Goals

- Persistent, loadable signing keys behind a provider port.
- One concrete adapter: encrypted file keystore. No KMS, no sigstore yet.
- Rotation with an overlap window during which the previous key remains
  verifiable.
- Revocation that fails closed.
- A two-machine portability proof: package sealed on machine A, resumed and
  verified on machine B with a different driver.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| KMS, HSM, OS keychain, sigstore keyless (OIDC) adapters | Later adapters behind the same port; not needed to unblock portability. |
| Multi-party or threshold signing | No requirement evidence. |
| Changes to the canonical JSON or signature format | Belongs to the DSSE decision (see `.specs/features/dsse-attestation/`). |
| Publishing or sharing public keys through a remote directory | Trust root exchange stays a local, explicit ceremony for now. |

## Acceptance Criteria

1. **KEY-01** — WHEN a caller requests a signer THEN a `KeyProviderPort`
   SHALL return a signer loaded from persistent storage or, on first use,
   generate and persist one, with the same `PublicKeyRef` on every
   subsequent load.
2. **KEY-02** — WHEN the encrypted-file adapter stores a key THEN the
   private key material SHALL be encrypted at rest (authenticated
   encryption), the file SHALL live outside shared artifacts under the
   machine-local state root, and the plaintext SHALL never be logged,
   serialized into evidence, or committed.
3. **KEY-03** — WHEN a key is rotated THEN artifacts signed by the previous
   key SHALL remain verifiable for a configured overlap window via
   `validUntil`, and new signatures SHALL use the new key.
4. **KEY-04** — WHEN a key is revoked, expired, or its purpose does not
   cover the operation THEN verification and signing SHALL fail closed with
   a distinct public error code, consistent with the existing
   `VES_POLICY_*` / `VES_TRUST_ROOT_*` discipline.
5. **KEY-05** — WHEN the composition root (`apps/vestra-cli`) builds sealing
   and verification workflows THEN it SHALL obtain signers exclusively
   through `KeyProviderPort`, never by constructing `NodeEd25519Signer`
   directly.
6. **KEY-06** — WHEN an Execution Package sealed on one environment is
   transferred to a second environment with a different qualified driver
   THEN the receiving environment SHALL verify the package signature against
   the transferred trust root and resume work, producing a passing
   end-to-end portability test (the "two-minute demo", R13).
7. **KEY-07** — WHEN a keystore file is corrupted, truncated, or tampered
   THEN loading SHALL fail closed with a distinct error code and no partial
   key material SHALL be used.

## Design Constraints

- Follow the existing inward dependency direction (contracts → domain →
  application); the port lives beside the integrity module, adapters are
  outer layers.
- Reuse `node:crypto`; no new runtime dependency for the file adapter.
- Keys, passphrases, and machine-local paths never enter tracked artifacts,
  evidence, or CLI output.
- Existing test fixtures calling `NodeEd25519Signer.generate()` remain valid
  for ephemeral test use.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| KEY-01, KEY-02, KEY-07 | T2 | Complete |
| KEY-03, KEY-04 | T3 | Pending |
| KEY-05 | T4 | Pending |
| KEY-06 | T5 | Pending |

## Success Criteria

- A sealed package is verifiable on a second machine without regenerating
  keys.
- Rotation never invalidates in-window historical evidence.
- All failure modes fail closed with distinct, documented error codes.
