# Qualification Evidence Attestation for T75

This document describes how to verify the public artifact set produced by the
manual **Sign T75 qualification evidence** workflow. It does not claim that a
T75 candidate has been signed; a missing protected key or committed public
reference makes the workflow fail before publication.

## Published artifact set

- `signed-evidence-index.json` — the canonical T75 index with a declaration
  that its body is attested;
- `qualification-evidence-index.dsse.json` — the bare DSSE envelope containing
  an in-toto `qualification-evidence-index` predicate;
- the committed public `PublicKeyRef` selected by the workflow.

The signed body is every field in the index except `bodyDigest` and
`signingState`. The body contains the exact candidate revision. `bodyDigest`
is canonical JSON V2 SHA-256; the DSSE subject carries the same digest. The
`signingState` records the key id, predicate type, and envelope filename but is
not itself authority: verification must include the DSSE envelope and public
reference.

## Verification

Use the candidate checkout that produced the artifact and run:

```bash
node scripts/t75-evidence-attestation.mjs verify \
  --index signed-evidence-index.json \
  --public-key-ref docs/qualification/trust/t75-evidence-public-key.json \
  --revision <exact-40-character-candidate-sha> \
  --envelope qualification-evidence-index.dsse.json
```

The verifier rejects a changed body, candidate revision, predicate type,
signature, key id, or public key. It uses only public evidence and does not
read a private key.

A rotated key's reference moves to `docs/qualification/trust/retired/<keyId>.json`
and gains `validUntil` (#408). The verifier accepts an envelope under a
reference only if the envelope's `issuedAt` falls inside that reference's
window, and the signer refuses a reference whose window has closed. To verify
evidence signed before a rotation from a later checkout, pass the retired
reference. The committed T75 evidence at `be92397` verifies under
`docs/qualification/trust/retired/t75-evidence-20260825.json`.

## Owner provisioning boundary

Before the workflow can produce an attestation, the repository owner must
commit the selected public `PublicKeyRef` under `docs/qualification/trust/` and
configure the matching PKCS#8 Ed25519 private value as the
`VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64` secret of the protected
`t75-evidence-signing` environment (#408). The signing job binds that
environment, so it starts only for a run dispatched from `main` and approved by
the environment's reviewer. The workflow passes the secret only to the signing
step, as the `VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64` process variable the
script reads, and it must never be copied into source, logs, or artifacts.
