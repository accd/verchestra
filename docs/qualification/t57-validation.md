# T57 Allowlisted Sanitized Support Bundle Validation

## Scope

- Task: T57 — Implement allowlisted sanitized Support Bundles
- Requirements: VES-RLS-003/004, VES-TST-007, and VES-SEC-006
- Commit target: `feat(support): add sanitized support bundles`
- Focused evidence: 50 cases (10 end-to-end and 40 security)
- Required minimum: 45 security/end-to-end cases
- Spec deviations: none

T57 adds a fixed, versioned diagnostic registry whose values are restricted to digests, semantic versions, closed enums, bounded non-negative integers, booleans, stable code lists, safe evidence-reference lists, and HMAC path pseudonyms. It intentionally provides no unrestricted text, log, source, prompt, context, row, environment, transcript, raw Probe, or raw state-database field. Plans are content-addressed and semantically reconstructed at every use; inspection reveals the exact sanitized values and redaction summary before any authority check. Encryption is guarded by an unforgeable in-process export token created only after an exact state-bound Support Export Approval and Data Egress allow decision. Publication exists only on the explicit export coordinator and uses a deterministic idempotency key.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/support-bundle-e2e.test.mjs tests/security/support-bundle-security.test.mjs` | PASS — 50 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, unit/property, architecture, qualification, 735 security, and 129 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Only versioned allowlisted fields can be collected | `tests/e2e/support-bundle-e2e.test.mjs:16-24`; `tests/security/support-bundle-security.test.mjs:15-32` | Registry version and digest are visible; source, prompt, context, credential, environment, row, raw output, transcript, state database, and log fields fail collection | PASS |
| Diagnostic values have closed, bounded types | `tests/security/support-bundle-security.test.mjs:70-86` | Digest, semantic version, profile, counters, references, verdict, platform, and engine values outside their exact types fail closed | PASS |
| Machine paths are never exported literally | `tests/e2e/support-bundle-e2e.test.mjs:26-33` | Absolute paths become deterministic Workspace-bound HMAC-SHA-256 pseudonyms and raw path segments disappear from the plan | PASS |
| Error adapters expose stable codes only | `tests/e2e/support-bundle-e2e.test.mjs:35-44` | Error message, stack, cause, and private details are ignored; only the stable public code enters diagnostics | PASS |
| Prohibited-content scanning is independent and bounded | `tests/security/support-bundle-security.test.mjs:34-56` | Credentials, connection strings, private keys, SQLite bytes, authority-injection requests, multiline logs, and raw paths are rejected directly by the scanner and by field normalization | PASS |
| TypeScript, arbitrary code strings, or forged plan shapes grant no authority | `tests/security/support-bundle-security.test.mjs:58-74,94-109` | A correctly rehashed forged plan is semantically reconstructed; non-allowlisted fields and code-shaped content not registered by the release are denied; duplicates and extra collection controls fail | PASS |
| Exact inspection precedes all authority and effects | `tests/e2e/support-bundle-e2e.test.mjs:46-57`; `tests/security/support-bundle-security.test.mjs:111-124` | Any changed inspection digest blocks before Approval, egress, encryption, or publication | PASS |
| Support Export Approval precedes Data Egress | `tests/e2e/support-bundle-e2e.test.mjs:46-57,98-123` | Order is inspection → Approval → egress → encryption → publish; either denial produces no bundle and no publication | PASS |
| No automatic upload or builder publication path exists | `tests/e2e/support-bundle-e2e.test.mjs:133-138` | Plan and inspection are zero-effect; only the explicit coordinator owns the sink call | PASS |
| Recipient encryption protects the exact inspected closure | `tests/e2e/support-bundle-e2e.test.mjs:59-96`; `tests/security/support-bundle-security.test.mjs:126-143` | One General JWE archive opens identically for every declared X25519 recipient and rejects an undeclared recipient | PASS |
| Signed summary and encrypted archive remain mutually bound | `tests/e2e/support-bundle-e2e.test.mjs:59-75`; `tests/security/support-bundle-security.test.mjs:183-201` | Outer Ed25519 authentication and inner A256GCM authentication fail before diagnostic use when ciphertext changes | PASS |
| Time and authority domain prevent replay | `tests/security/support-bundle-security.test.mjs:145-181` | Expired and cross-Workspace bundles cannot be opened; run identity and not-before checks are also enforced by the implementation | PASS |
| Equivalent unordered input is deterministic | `tests/e2e/support-bundle-e2e.test.mjs:126-131` | Diagnostic and recipient permutations yield one canonical plan identity | PASS |

## Necessary-test reverse map

| Test group | Maps to | Keep |
| --- | --- | --- |
| Inspection and pseudonymization E2E | Exact review surface, safe redaction summary, no machine paths | Yes |
| Approval/egress/export E2E | Human and policy ordering, zero-effect denial, no auto-upload | Yes |
| Recipient E2E | Multi-recipient encryption, exact decrypted closure, no raw path leakage | Yes |
| Prohibited field corpus | VES-RLS-003 exclusion list and absence of unrestricted collectors | Yes |
| Prohibited content corpus | Credential/source-path/log/database and prompt-injection defense in depth | Yes |
| Closed-type matrix | Stable safe JSON/self-test values without general text channels | Yes |
| Forged-plan and inspection cases | Runtime semantic authority independent from TypeScript shapes and stale reviews | Yes |
| Cryptographic/replay cases | Recipient, signature, expiry, Workspace, and archive-summary binding | Yes |

## Non-shallow checks

- The registry is code-owned and versioned `1.0.0`; callers cannot register a new field at runtime. Updating the allowlist therefore requires a reviewed source and release change, not configuration data or retrieved content.
- Code-list fields are independently constrained by a content-addressed stable-code registry supplied by the trusted release and bound into the plan, inspection, signed summary, and encrypted archive. Merely matching `VES_*` syntax cannot create a diagnostic code or covert text channel.
- There is deliberately no generic string or map field. Even safe-looking arbitrary text would become a source/log/prompt exfiltration channel, so diagnostics use only closed machine-verifiable types.
- Paths are accepted only by the dedicated path field and are immediately replaced with an HMAC-SHA-256 pseudonym scoped to the Workspace. The HMAC key never enters the plan, inspection, bundle, or signed summary.
- The prohibited-content scanner independently detects credential forms, connection strings, private-key headers, raw SQLite signatures, authority-promotion language, newlines, and common absolute paths. It operates after typed normalization and again before encryption/open.
- Every `inspect`, authorized build, and decrypted open reconstructs the registry, diagnostic types, canonical order, recipients, redaction count, release binding, times, and plan digest. A caller cannot forge authority by manufacturing a TypeScript-shaped object and recomputing its hash.
- Inspection contains the exact sanitized values that encryption will carry. The Approval and egress requests both bind the plan and inspection digests plus Workspace, run, and destination.
- `authorizedBuild` requires a one-use object identity stored in a module-private `WeakSet`. Only the coordinator can mint it after both authority decisions, so direct builder access cannot create an exportable encrypted bundle.
- The outer signed summary contains field IDs and value digests, not diagnostic values. The encrypted archive contains the inspected values; open recomputes every field digest and compares it with the signed summary.
- General JWE uses X25519 `ECDH-ES+A256KW` recipient entries and one `A256GCM` ciphertext. The outer artifact is independently Ed25519-sealed for Verchestra trust-root and purpose enforcement.
- Planning and inspection have no sink reference and no upload method. Publication is an explicit caller action after review; no background or automatic transport exists.
- Stable self-test fields cover release digest, profile, check count, durations, safe evidence references, redaction count, failure codes, and verdict, satisfying the safe report payload required by VES-TST-007 without adding a report-text escape hatch.

## Verdict

PASS for T57. Support diagnostics now have a narrow, versioned, reviewable data model instead of a sanitized full dump. Project content and private runtime classes cannot be collected through the public schema; hostile values, forged plans, stale inspections, denied Approval/egress, wrong recipients, replay, and tamper fail before publication or diagnostic use. Export remains an explicit, inspected, state-bound, recipient-encrypted effect with no automatic upload path.
