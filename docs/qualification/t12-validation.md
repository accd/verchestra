# T12 Validation — Canonical Signing Pipeline

**Gate:** `corepack pnpm@10.34.5 gate:security`  
**Result:** 21 unit/property, 19 security, 10 architecture, and 248 retained qualification cases passed; 0 failed, 0 skipped, 0 todo. Format, lint, strict TypeScript, and build passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| RFC 8785 / I-JSON | `evidence-integrity.test.mjs:25–72` | Recursive UTF-16 ordering, ECMAScript number/string serialization, no normalization, and invalid I-JSON rejection | Yes |
| Cross-runtime fixture | `evidence-integrity.test.mjs:75–79` | Frozen canonical bytes produce exact SHA-256 `a6b95a…68a5` | Yes |
| Digest properties | `evidence-integrity.test.mjs:81–110` | Insertion-order invariance and leaf-change discrimination | Yes |
| Private-key boundary and purpose | `evidence-integrity.test.mjs:112–131` | Public SPKI reference only; unauthorized purpose cannot sign | Yes |
| Signed content address | `evidence-integrity.test.mjs:133–173` | Payload, schema, purpose, receiver binding, time, signer, and source state are bound | Yes |
| Positive and idempotent verification | `evidence-tamper.test.mjs:36–49` | Same artifact verifies repeatedly in the same context | Yes |
| Tamper and wrong key | `evidence-tamper.test.mjs:52–109` | Payload, digest, artifact ID, signature, unknown key, and impostor key fail closed | Yes |
| Purpose/schema/source/replay | `evidence-tamper.test.mjs:112–169` | Revocation, purpose, schema, source-state, and cross-context replay fail with stable codes | Yes |
| Trust validity and immutability | `evidence-tamper.test.mjs:172–234` | Not-yet-valid, expired, malformed, duplicate, and post-construction mutation cases fail safely | Yes |

## Check B — Non-shallow

The tests call the production RFC 8785 canonicalizer, Node SHA-256 and Ed25519 implementations, actual SPKI export/import, content-address derivation, and the production trust verifier. Security cases mutate each signed layer independently and assert exact public error codes. The trust-root mutation test proves verification inputs are snapshotted rather than held by caller reference.

The JCS dependency is exact-pinned to `canonicalize` 3.0.0, the JavaScript implementation listed by [RFC 8785 Appendix G](https://www.rfc-editor.org/rfc/rfc8785.html#appendix-G). The pre-existing `@tufjs/canonical-json` dependency remains limited to TUF because it implements a different canonical JSON dialect and is not RFC 8785 compatible.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| JCS, fixture, digest, source-state invalidation | VES-SPC-004…005 | Yes |
| Signed envelope, purpose and receiver binding | VES-HOF-001/003 | Yes |
| Immutable trust snapshot and verification evidence | VES-RLS-005 | Yes |
| Tamper, wrong key, revocation, expiry, replay | T12 security done criterion | Yes |

## Check D — Guidelines

Tests were authored before implementation. Canonical payloads remain JSON values; secrets and private keys are never serialized into artifacts or key references. Replay protection is explicit and portable: a byte-identical artifact is idempotent inside its declared binding, while reuse against another binding or source state is rejected without machine-local hidden state. The security and release gates now include unit tests so their claimed result cannot omit primitive-level security cases.

## Adequacy verdict

PASS — all T12 criteria have executable evidence, 40 focused unit/property/security cases exceed the ≥25 threshold, the full security gate passed, and no test exceeds T12 scope.
