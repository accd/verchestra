# T09 Validation — TUF, Signing, Key Stores, Encryption, and Activation

**Gate:** `corepack pnpm@10.34.5 gate:security`  
**Result:** 248 passed, 0 failed, 0 skipped, 0 todo (45 T09 cases)  
**SPEC_DEVIATION:** none. The recipient wire format is deliberately deferred to T55; T09 qualifies primitives and failure behavior.

## Check A — Sufficient coverage

| Done-when / requirement | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Exact TUF/runtime selection | `tuf-release.test.mjs:23` — full `QUALIFIED_TUF` identity | Exact compatible client; incompatible latest rejected | Yes |
| Four distribution modes | `tuf-release.test.mjs:31–34` — release ID, mode, exact closure, every component verified | One complete trusted view online/mirror/offline/air-gap | Yes |
| Rollback and freeze | `tuf-release.test.mjs:45,52,59` — exact rollback/expired codes with `activationAllowed: false` | Candidate rejected; no activation | Yes |
| Threshold/signature | `tuf-release.test.mjs:65,71` — exact threshold failure | Threshold-invalid metadata rejected | Yes |
| Mix-and-match/integrity | `tuf-release.test.mjs:77,83` — exact integrity failure | Mixed/corrupt metadata or targets rejected | Yes |
| Platform/release closure | `tuf-release.test.mjs:89–101` — exact platform, mixed view, missing component outcomes | One compatible complete release view | Yes |
| Partial publication | `tuf-release.test.mjs:107,114` — exact partial-publish failure | No partial candidate | Yes |
| Ed25519/key boundary | `crypto-bundles.test.mjs:38–71` — verify/tamper/wrong-key/non-export/platform evidence assertions | Canonical signatures; private keys non-exportable; adapter evidence required | Yes |
| Recipient encryption | `crypto-bundles.test.mjs:78–108` — both recipients, wrong recipient, all tamper classes, expiry | Signed authenticated recipient envelope or stable rejection | Yes |
| Recovery exclusions | `crypto-bundles.test.mjs:116` — exact prohibited-content rejection | Credentials/machine auth/env/rows absent | Yes |
| Support allowlist/inspection | `crypto-bundles.test.mjs:122–138` — exact fields, exclusions, no upload, inspection | Prohibited content excluded; inspect before export | Yes |
| Support Approval/egress | `crypto-bundles.test.mjs:143–145` — exact Approval/egress failures and authorized receipt | No export without both decisions; no automatic upload | Yes |
| Successful activation | `activation.test.mjs:34–43` — exact receipt, active state, last event, pointer payload | Health before atomic pointer switch | Yes |
| Every activation failure | `activation.test.mjs:55–56` across wrong/mixed/missing/digest/four injected boundaries | Stable non-zero failure; active remains `1.0.0` | Yes |
| Rollback | `activation.test.mjs:102–113` — exact receipt and active state; missing/corrupt rejection | Verified rollback or last-known-good unchanged | Yes |

## Check B — Non-shallow

The 45 cases execute real TUF signature/metadata/target verification, Node Ed25519/X25519/HKDF/AES-GCM operations, real filesystem staging/renames, and active-pointer reads. Payload-bearing assertions verify complete release views, receipts, inspection manifests, revocation decisions, and persistent active state. Attack cases assert stable codes plus `activationAllowed: false` or the exact last-known-good release.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| TUF view and attack corpus | VES-RLS-001…002, VES-CLI-004 | Yes |
| Ed25519, key-store evidence, recipient envelope | VES-SEC-004…005 and T09 primitive criteria | Yes |
| Support allowlist/inspection/Approval/egress | VES-RLS-003…004 | Yes |
| Staging, pointer failures, rollback | VES-CLI-004, VES-SEC-005 | Yes |

## Check D — Guidelines

Tests follow AD-012/014/017, design sections 4.15–4.16 and 8.1, the T09 definition, and the project Test Coverage Matrix. Dependency behavior is exercised only through requirement-bound attack or compatibility cases.

## Adequacy verdict

PASS — all 45 cases are requirement-bound, exceed the ≥30 threshold, cover every named attack/failure class, and assert that activation is blocked or last-known-good remains active. The complete security gate passes without skips.
