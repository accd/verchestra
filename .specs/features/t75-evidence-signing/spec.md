# T75 Qualification Evidence Signing Specification

## Goal

Produce a DSSE/in-toto attestation over the canonical T75 evidence-index body
at one exact candidate revision, verified by a committed public trust reference
and independently checkable without a private key.

## Requirements

| ID | Requirement |
| --- | --- |
| TES-01 | The evidence package shall recognize `qualification-evidence-index` as a closed v1 predicate type. |
| TES-02 | The signing command shall accept only a PKCS#8 Ed25519 private key supplied through its protected environment input and shall never write or print that value. |
| TES-03 | The command shall derive the public key, require byte-for-byte equality with the committed `PublicKeyRef`, and refuse a missing, malformed, mismatched, or unauthorized reference. |
| TES-04 | The command shall sign the canonical index body in a DSSE envelope whose in-toto statement binds the body digest, exact candidate revision, predicate type, purpose, and key identity. |
| TES-05 | An external verifier shall reject a changed index body, revision, predicate type, signature, or public-key identity. |
| TES-06 | The qualification workflow shall check out the requested full SHA, regenerate the index from the supplied fleet evidence, sign only after zero contradictions, verify the result, and publish the index, DSSE envelope, public trust reference, and verification instructions. |
| TES-07 | Missing protected configuration shall fail closed before publication and shall not present an unsigned index as signed. |

## Constraints

- No private key, passphrase, environment value, or local profile may be
  committed, logged, or included in a generated artifact.
- A public key is not provisioned by automation. It must be supplied by the
  repository owner and committed through normal review.
- This work does not close #294, #16, or advance T75 without a real provisioned
  run, independent verification, and human review.
