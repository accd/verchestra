# T56 Encrypted Workspace Recovery Bundle Validation

## Scope

- Task: T56 — Implement encrypted Workspace recovery bundles and staged restore
- Requirements: VES-SEC-004/005 and VES-HOF-005/006
- Commit target: `feat(recovery): add encrypted workspace bundles`
- Focused evidence: 39 cases (9 end-to-end, 9 fault injection, and 21 security)
- Required minimum: 35 end-to-end/fault/security cases
- Spec deviations: none

T56 creates an explicit, content-addressed recovery closure from one consistent runtime/memory snapshot barrier; signs its manifest with Ed25519; and encrypts one authenticated archive for one or more X25519 recipients using RFC 7516 General JWE JSON Serialization with `ECDH-ES+A256KW` and `A256GCM`. Restore authenticates and decrypts before staging, validates the staged closure, requires logical-secret rebinding, reevaluates policy/source/Approval/claim authority, reconciles uncertain effects, and only then calls the atomic activation port. Credential values, secret values, machine authentication, provider sessions, and derived vector indexes are mandatory exclusions.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/recovery-bundle-e2e.test.mjs tests/fault-injection/recovery-bundle-faults.test.mjs tests/security/recovery-bundle-security.test.mjs` | PASS — 39 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, unit/property, architecture, qualification, 695 security, and 129 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Runtime and memory share one consistent snapshot barrier | `tests/e2e/recovery-bundle-e2e.test.mjs:43-75` | Canonically ordered sources are captured only if every before/after state digest is unchanged inside the barrier | PASS |
| Object closure is complete and content-addressed | `tests/e2e/recovery-bundle-e2e.test.mjs:97-105`; `tests/security/recovery-bundle-security.test.mjs:113-129` | Every required object has exact identity, kind, byte size, and SHA-256 digest; missing, extra, or changed content fails before encryption/publication | PASS |
| Inclusion and exclusion decisions are explicit | `tests/e2e/recovery-bundle-e2e.test.mjs:97-105`; `tests/security/recovery-bundle-security.test.mjs:71-95` | Mandatory private-state exclusions are always present and no class may be simultaneously included and excluded | PASS |
| One bundle supports multiple explicit recipients | `tests/e2e/recovery-bundle-e2e.test.mjs:17-27`; `tests/security/recovery-bundle-security.test.mjs:13-19,97-111` | Each declared X25519 recipient opens the same signed closure; unknown or duplicate recipient identities fail closed | PASS |
| Inspection cannot expose encrypted object bytes | `tests/e2e/recovery-bundle-e2e.test.mjs:29-41` | Signature-verified metadata is inspectable without returning archive plaintext | PASS |
| Time validity and Workspace binding precede staging | `tests/security/recovery-bundle-security.test.mjs:21-43` | Expired, future-created, or foreign-Workspace bundles are rejected before any restore port is called | PASS |
| Sensitive/private content cannot enter a plan | `tests/security/recovery-bundle-security.test.mjs:45-68` | Credential, secret, token, session, transcript, environment, row, and local-path fields fail recursively | PASS |
| Ciphertext and signed manifest tamper fail closed | `tests/security/recovery-bundle-security.test.mjs:70-77`; `tests/fault-injection/recovery-bundle-faults.test.mjs:62-74` | Ed25519 envelope verification and AES-GCM authentication prevent semantic use or staging of modified bytes | PASS |
| Restore order is safe and explicit | `tests/e2e/recovery-bundle-e2e.test.mjs:77-95` | Stage, validate, rebind every logical secret, reevaluate authority, reconcile effects, then activate | PASS |
| Wrong recipient, missing secret, or stale authority leaves active state unchanged | `tests/security/recovery-bundle-security.test.mjs:13-19,153-166`; `tests/fault-injection/recovery-bundle-faults.test.mjs:33-47` | No rejected recovery can replace the active Workspace | PASS |
| Unknown high-risk effects require reconciliation | `tests/fault-injection/recovery-bundle-faults.test.mjs:49-60` | An unknown outcome remains fail-closed and cannot be interpreted as not applied | PASS |
| Stage, validation, and activation faults preserve authority | `tests/fault-injection/recovery-bundle-faults.test.mjs:12-31` | Every injected restore-boundary failure leaves the original active state untouched | PASS |
| Publication is immutable, canonical, and retry-convergent | `tests/e2e/recovery-bundle-e2e.test.mjs:107-149` | Repeating identical canonical bytes returns `already-published`; different randomized ciphertext cannot overwrite the first bundle; corrupt/noncanonical stored bytes fail integrity | PASS |

## Necessary-test reverse map

| Test group | Maps to | Keep |
| --- | --- | --- |
| Snapshot and multi-recipient end-to-end cases | Consistent cut, canonical closure, recipient interoperability, metadata-only inspection | Yes |
| Restore sequence end-to-end case | Staged validation, secret rebinding, authority refresh, effect reconciliation, atomic activation | Yes |
| Publication end-to-end cases | Idempotency, acknowledgement-loss convergence, no-clobber immutability | Yes |
| Restore fault matrix | Active-state preservation at every durable boundary and for every authority class | Yes |
| Planner/closure security matrix | Explicit exclusions, recursive sensitive-field denial, exact content closure | Yes |
| Cryptographic security cases | Wrong-recipient denial, expiry, Workspace isolation, signature and AEAD tamper detection | Yes |

## Non-shallow checks

- The plan identity is calculated from the normalized manifest material before encryption. Recipient order, object order, inclusion/exclusion order, logical-secret bindings, and uncertain-effect IDs are canonicalized, so the recovery intent is stable even though JWE ciphertext is deliberately randomized.
- The signed outer envelope binds the full JWE and manifest. Authentication is evaluated before exposing inspection metadata, decrypting archive bytes, or invoking a staging port.
- General JWE gives every recipient an independent X25519 key-wrap entry while sharing one A256GCM ciphertext. Adding recipients does not create divergent recovery archives.
- The encrypted archive repeats the plan identity and exact object identity/kind/bytes. Decryption is not sufficient: the implementation recomputes every size and raw-byte SHA-256 digest against the signed manifest.
- Restore never imports credential values. It imports only logical secret names and requires the destination machine's secret broker to prove each one is locally bound.
- Policy, source, Approvals, and claims are reevaluated in the destination environment. A valid historical signature is evidence of origin, not current execution authority.
- An uncertain remote effect is reconciled to one of `applied`, `not-applied`, or `already-applied`. Any other result blocks activation instead of guessing or blindly retrying.
- The store publishes through a same-filesystem hard link with no replacement semantics. Identical retries converge; a competing bundle for the same immutable plan remains untouched and raises a conflict.
- Derived vector indexes are excluded because they can be rebuilt from authoritative memory. This reduces bundle size and prevents derived state from outranking restored lexical authority.

## Cryptographic profile

- Container: RFC 7516 General JWE JSON Serialization
- Recipient algorithm: `ECDH-ES+A256KW`
- Recipient keys: X25519 JWK thumbprints bound into the signed manifest
- Content encryption: `A256GCM`
- Outer artifact signature: Ed25519 through the Verchestra trust-root and purpose system
- Protected binding: media type, schema version, and immutable recovery plan identity

## Verdict

PASS for T56. A Workspace can now be captured as one explicit, signed, recipient-encrypted recovery closure and restored only through a fail-closed staged sequence. Wrong recipients, expiry, cross-Workspace replay, closure drift, missing secret bindings, stale authority, unknown effects, tamper, faults, and competing publication bytes cannot replace the active Workspace; retries converge without weakening authority.
