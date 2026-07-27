# DSSE Attestation Decision Design Notes

## Current State (verified)

- Detached base64url Ed25519 over project canonical JSON:
  `packages/evidence/src/integrity/signer.ts:51-59`,
  `canonical.ts`; verified by `artifact-sealer.ts`.
- No DSSE/in-toto adoption; the string appears only as a bundle logical
  path in `tests/helpers/hermetic-bundle-fixture.mjs:39`.
- Trust root and `PublicKeyRef` (`purposes`, validity windows) are
  envelope-agnostic — they survive any of the three options.

## Mapping Sketch for Option A

```text
in-toto Statement
  ├── subject[]        ← artifact digests already computed by the sealer
  ├── predicateType    ← "https://verchestra.dev/attestation/execution-package/v1"
  ├── predicate        ← current package metadata (requirements, approvals,
  │                      budgets, policy bundle digest)
  └── DSSE envelope    ← payloadType "application/vnd.in-toto+json",
                         signatures[] from KeyProviderPort signers
```

Materials linked by digest already exist throughout the evidence model, so
the predicate mapping is mechanical rather than conceptual.

## Migration Considerations

- Contract tests and fixtures pin the current canonical byte layout; a
  format change touches `tests/contract/`, `tests/helpers/`, and every
  evidence fixture — this is the bulk of the cost and argues for deciding
  early.
- Dual-format verification (Option A transition or Option C steady state)
  must record which format verified each artifact, fail closed on unknown
  envelope versions, and never silently downgrade.
- The decision interacts with key-lifecycle (T68a): new envelope support
  should land on top of `KeyProviderPort`, not on direct signer
  construction.

## Recommendation Recorded for the Owner

The external review recommends Option A before 1.0. This repository records
the decision as pending; the owner decides with this analysis, and the
outcome lands in `.specs/STATE.md` per DSSE-01.
