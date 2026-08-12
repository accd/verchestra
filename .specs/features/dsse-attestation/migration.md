# DSSE Migration Specification (DSSE-02)

Required by acceptance criterion **DSSE-02** because the owner chose Option A
(AD-014, 2026-08-09). This document defines the three things DSSE-02 demands:
the treatment of pre-decision artifacts, the exact predicate type URIs, and
the fixture/contract-test migration plan. It is a specification, not an
implementation record; the implementation lands before T76 (#17) starts and
carries its own tasks and evidence.

All line references were measured on `1f21582`.

## 1. Target envelope

### 1.1 DSSE envelope

```jsonc
{
  "payloadType": "application/vnd.in-toto+json",
  "payload": "<base64 of the canonical in-toto Statement>",
  "signatures": [{ "keyid": "<PublicKeyRef.keyId>", "sig": "<base64 signature>" }]
}
```

The signed bytes are the DSSE Pre-Authentication Encoding, replacing the
current `Buffer.from(canonicalizeJson({ artifactId, ...base }), "utf8")` at
`packages/evidence/src/integrity/artifact-sealer.ts:137`:

```text
PAE = "DSSEv1" SP len(payloadType) SP payloadType SP len(payload) SP payload
```

`len()` is the ASCII decimal byte length; `payload` in the PAE is the raw
Statement bytes, not the base64 text. Signing stays `NodeEd25519Signer.sign`
(`signer.ts:75`) through `KeyProviderPort`; the trust root, `PublicKeyRef`,
purposes, and validity windows are unchanged (they are envelope-agnostic).

### 1.2 in-toto Statement payload

```jsonc
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "<artifact kind>", "digest": { "sha256": "<payloadDigest>" } }],
  "predicateType": "<see section 2>",
  "predicate": {
    "binding": {
      "schema": { "name": "...", "version": 1 },
      "purpose": "...",
      "bindingId": "...",
      "sourceStateDigest": "...",
      "algorithm": "Ed25519",
      "issuedAt": "<canonical instant>"
    },
    "content": {/* the current SealedArtifact.payload, unchanged */}
  }
}
```

**The binding block stays inside the signed payload — this is not optional.**
`ArtifactSealer.verify` derives five of its thirteen error codes from binding
comparisons (`artifact-sealer.ts:158-169`:
`VES_INTEGRITY_SCHEMA_MISMATCH`, `_PURPOSE_MISMATCH`, `_SOURCE_STATE_MISMATCH`,
`_BINDING_MISMATCH`, and the `artifactId` check at 151). Moving any binding
field out of the signed payload would silently drop that cryptographic cover.

`subject[].digest.sha256` carries the existing `payloadDigest`
(`artifact-sealer.ts:131`), so the payload-digest check survives as a
Statement-native property rather than a bespoke field.

### 1.3 Fields that change meaning

| Today (`types.ts:33-42`)                              | Under DSSE                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelopeVersion: 1`                                  | Removed. Replaced by `payloadType` + `_type`. A v1 envelope is **rejected**, see section 3.                                                                                                        |
| `algorithm`, `keyId`                                  | `keyid` moves to `signatures[0].keyid` (DSSE-native); `algorithm` stays in the predicate binding block so evidence records it explicitly rather than inferring it from the trust root.             |
| `payloadDigest`                                       | Becomes `subject[0].digest.sha256`.                                                                                                                                                                |
| `payload`                                             | Becomes `predicate.content`.                                                                                                                                                                       |
| `signature`                                           | Becomes `signatures[0].sig`.                                                                                                                                                                       |
| `artifactId`                                          | Retained, recomputed as the sha256 of the canonical Statement. **Its value changes for every artifact**; everything that stores or cross-references an artifact id regenerates in the same change. |
| `schema`, `purpose`, `bindingId`, `sourceStateDigest` | Move into `predicate.binding`, unchanged in meaning.                                                                                                                                               |

`envelopeVersion` today has **no rejection gate anywhere** in the product —
`verify` never inspects it (the only assertion is a test,
`tests/unit/evidence-integrity.test.mjs:148`); it is protected only
implicitly by feeding the `artifactId` digest. The migration closes that gap:
envelope identity becomes an explicitly gated, fail-closed field.

### 1.4 New error code

`VerificationErrorCode` (`types.ts:52-65`) gains
**`VES_ENVELOPE_UNSUPPORTED`** — returned when the envelope is not a
recognized DSSE envelope, when `payloadType` is not
`application/vnd.in-toto+json`, when `_type` is not the in-toto Statement
type, or when the input is a legacy v1 `SealedArtifact`. Fail closed: never
attempt a legacy verification path, never downgrade.

## 2. Predicate type URIs (exact)

One URI per sealed artifact kind, versioned independently of the product
version:

| Artifact kind                    | Sealed at                                                                     | Predicate type URI                                                              |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Execution Package                | `packages/evidence/src/execution-package/execution-package.ts:848`            | `https://accd.github.io/verchestra/attestation/execution-package/v1`            |
| Run Capsule                      | `packages/evidence/src/run-capsule/run-capsule.ts:499`                        | `https://accd.github.io/verchestra/attestation/run-capsule/v1`                  |
| Recovery Bundle                  | `packages/evidence/src/recovery-bundle/recovery-bundle.ts:514`                | `https://accd.github.io/verchestra/attestation/recovery-bundle/v1`              |
| Support Bundle                   | `packages/evidence/src/support-bundle/support-bundle.ts:609`                  | `https://accd.github.io/verchestra/attestation/support-bundle/v1`               |
| Doctor report                    | `apps/vestra-cli/src/doctor-composition.ts:59`                                | `https://accd.github.io/verchestra/attestation/doctor-report/v1`                |
| Promotion report                 | `apps/vestra-cli/src/promotion-composition.ts:65`                             | `https://accd.github.io/verchestra/attestation/promotion-report/v1`             |
| Self-test report                 | `apps/vestra-cli/src/self-test-composition.ts:171`                            | `https://accd.github.io/verchestra/attestation/self-test-report/v1`             |
| Approval grant                   | `apps/vestra-cli/src/self-test-full-scenario.ts:251`                          | `https://accd.github.io/verchestra/attestation/approval-grant/v1`               |
| T75 qualification evidence index | not yet sealed — `scripts/t75-evidence-index.mjs` (added to scope 2026-08-12) | `https://accd.github.io/verchestra/attestation/qualification-evidence-index/v1` |

**Why this host:** `accd.github.io/verchestra` is the domain the project
provably controls today (AD-001). Predicate type URIs are identifiers and
need not resolve, but using an uncontrolled domain invites collision and
misattribution. If a custom domain is acquired before T76, superseding these
URIs is an owner decision recorded as a new AD; the trailing `/v1` exists so
that change is a versioned migration rather than a redefinition.

**The URI set is closed.** An unknown `predicateType` is rejected with
`VES_ENVELOPE_UNSUPPORTED` — an attestation the product cannot name is not an
attestation it will verify.

### 2.1 Scope boundary (restated from AD-014)

This migration covers **only** the 9 kinds above: the 8 routed through
`ArtifactSealer`, plus the T75 qualification evidence index.

The index is the one entry with no sealing call site yet. It is generated today
by `scripts/t75-evidence-index.mjs` with an explicit
`signingState.signed = false` and a stated reason, because signing real
qualification runs with the repository's committed TEST-ONLY key would look like
signed evidence while carrying none. `matrix.md` section 8 permits shipping it
unsigned **only** on condition that the signature is scheduled rather than
deferred, which is what this row is: the predicate type is reserved now, and the
generator's output is routed through the sealer in the same change that migrates
the envelope. Its URI is reserved here and deliberately **not** yet added to
`PREDICATE_TYPES` in `packages/evidence/src/integrity/dsse.ts`, since a type the
closed set accepts with no producer behind it is an unreachable branch rather
than a capability.

Which identity signs release evidence remains an open owner key-custody
decision, and is a precondition for sealing this kind — not for the other 8,
which already have a trust root. The parallel signature surfaces —
`packages/policy/src/policy-bundle.ts` (signs a digest string),
`passport-registry.ts`, `governed-skill-registry.ts`,
`application/src/coordination/work-claims.ts`,
`application/src/egress/trust-egress.ts`, and the context manifest — are out
of scope and keep their current mechanism. TUF release metadata
(`packages/distribution/src/tuf-update-client.ts`, `tuf-js@5.0.1`) already
speaks an external standard and is untouched.

## 3. Pre-decision artifacts and dual-format verification

**Defined behavior: the product performs no dual-format verification. A v1
`SealedArtifact` is rejected with `VES_ENVELOPE_UNSUPPORTED`. Pre-decision
artifacts are re-sealed under recorded evidence instead of being
dual-verified** (DSSE-03's second branch).

This is a definition, not a waiver, and it rests on an inventory rather than
an assumption. The complete set of pre-decision sealed artifacts is:

| Artifact                 | Location                                                        | Disposition                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Published proof artifact | `docs/proof/execution-package.json` (+ `.md`)                   | Regenerated and re-sealed by `scripts/generate-proof-artifact.mjs` from its committed fixture key, in the migration change.                                  |
| Test fixtures            | the 5 sealing fixtures in `tests/helpers/` and their dependents | Regenerated (section 4).                                                                                                                                     |
| Qualification records    | `docs/qualification/*` (11 files mention `ed25519`/`base64url`) | Prose describing historical runs; historical text is **not** rewritten. Reports remain accurate statements about the format in force when they were written. |

**No sealed artifact exists outside this repository**, because the product is
`0.0.0-qualification` with no release and no installer — so there is no
installed base whose artifacts could arrive at a verifier. That is precisely
why Option A was chosen now (AD-014).

**Re-run the inventory at implementation time.** If any sealed artifact has
been published or distributed between this specification and the
implementation, this section is void and a genuine dual-format transitional
path must be specified before proceeding. The inventory command and its
result are recorded as evidence in the implementation change.

**Precedent:** rejecting rather than shimming an old sealed schema is the
established pattern — `packages/application/src/verification/verification.ts:267`
bumped a sealed report to `schemaVersion: 2` and rejects `1` outright. The
dual-acceptance pattern at `packages/workspace/src/init/safe-init.ts:115-128`
exists only because a hard crash can genuinely leave a v1 journal on disk;
no equivalent mechanism can produce a v1 sealed artifact after this change.

## 4. Fixture and contract-test migration plan

41 test and helper files reference signature machinery
(`signature|signer|sealer|keyId|detached|base64url`): 29 tests + 12 helpers,
of which 16 files plus 1 script call `seal`/`verify`/`createTrustRoot`
directly. The order below is chosen so each step is verifiable before the
next begins.

**Step 1 — envelope and sealer.** `types.ts` (`SealedArtifact` → DSSE types,
new `VES_ENVELOPE_UNSUPPORTED`), then `artifact-sealer.ts` `seal`
(line 111, PAE at 137) and `verify` (line 142). Gate: `pnpm gate:quick`.

**Step 2 — the four structural re-validation blocks.** Each evidence module
re-reads envelope fields independently of the sealer and must be rewritten
against the Statement shape: `execution-package.ts:860-889` (plus the
`envelopeVersion` echo at 923), `run-capsule.ts:522-547` (echo 566),
`recovery-bundle.ts:613-632` (echo 792), `support-bundle.ts:625-638`.

**Step 3 — the five sealing fixtures**, each of which builds its own
`createTrustRoot` and is the leverage point for everything downstream:
`tests/helpers/execution-package-fixture.mjs`, `run-capsule-fixture.mjs`,
`support-bundle-fixture.mjs`, `recovery-bundle-fixture.mjs`,
`authority-fixture.mjs`.

**Step 4 — the assertion-heavy suites**, in descending blast radius:

| File                                                               | Why it is the hard part                                                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/security/evidence-tamper.test.mjs` (78 matches)             | ~20 `sealer.verify` assertions, one per `VerificationErrorCode`. **Every existing code keeps a test, and `VES_ENVELOPE_UNSUPPORTED` gains one** — a tamper suite that shrinks is a weakened suite. |
| `tests/unit/evidence-integrity.test.mjs` (31)                      | Asserts `envelopeVersion === 1` (line 148) and canonical-order determinism; the envelope assertion is replaced by a DSSE-shape assertion, never deleted.                                           |
| `tests/e2e/key-lifecycle-portability.test.mjs` (16)                | Cross-machine verification — the portability promise; must pass unchanged in meaning.                                                                                                              |
| `tests/unit/encrypted-file-key-rotation.test.mjs` (13)             | Rotation overlap window; envelope-independent but fixture-coupled.                                                                                                                                 |
| `tests/fault-injection/self-test-composition-faults.test.mjs` (11) | Sealed self-test path.                                                                                                                                                                             |
| `tests/unit/self-test-adapter.test.mjs:147`                        | The one test asserting raw signature bytes.                                                                                                                                                        |

**Step 5 — published artifact.** Regenerate `docs/proof/` via
`scripts/generate-proof-artifact.mjs` (lines 32, 36 construct the signer) and
record the re-seal as evidence per section 3.

**Step 6 — make the bundle slot truthful.** The hermetic bundle's
`provenance.intoto.jsonl` component
(`tests/helpers/hermetic-bundle-fixture.mjs:39`) is today a `logicalPath`
string that nothing produces, reads, or validates. With DSSE in place it
becomes a real emitted artifact. **This step is the reason Option A was
chosen over B; it is not optional polish** — a bundle slot that promises
in-toto provenance and ships none is the discrepancy this migration exists to
remove.

**Step 7 — discrimination sensor.** At minimum: (a) a DSSE envelope whose
`payload` is mutated without re-signing must fail; (b) a valid signature over
a _different_ `payloadType` must fail (PAE domain separation — this is the
mutation that a naive implementation signing raw payload bytes would
survive); (c) a legacy v1 `SealedArtifact` must fail with
`VES_ENVELOPE_UNSUPPORTED` and never verify; (d) an unknown `predicateType`
must fail. Surviving mutants block the change.

## 5. Completion criteria

- DSSE-01 satisfied by AD-014 in `.specs/STATE.md` (done, 2026-08-09).
- DSSE-02 satisfied by this document: pre-decision treatment (section 3),
  exact predicate type URIs (section 2), migration plan (section 4).
- DSSE-03 satisfied when `docs/proof/` and all fixtures are re-sealed with
  the inventory of section 3 recorded as evidence in the implementation
  change.
- `pnpm gate:security` passes; no test is weakened, deleted, or skipped; the
  tamper suite covers every error code including the new one.
- Independent verification and human review before merge; the change lands
  **before** T76 qualification starts.
