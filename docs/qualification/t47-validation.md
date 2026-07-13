# T47 SQLite Probe Adapter Validation

## Scope

- Task: T47 — Implement SQLite Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add sqlite adapter`
- Focused evidence: 50 cases (10 contract, 9 integration, 31 security)
- Spec deviations: no functional deviation; `node:sqlite` exposes no progress-handler API, so hard interruption remains owned by the qualified T41 isolated-worker termination path

T47 adds a real `node:sqlite` read adapter with anonymous binds, exact SQLite identity evidence, read-only file open, defensive and query-only controls, extension denial, a closed authorizer, single-main-database enforcement, cancellation, safe `sqlite_schema` introspection, and byte-for-byte file preservation evidence.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/sqlite-probe-adapter.test.mjs tests/integration/sqlite-probe-adapter.test.mjs tests/security/sqlite-probe-adapter.test.mjs` | PASS — 50 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 483 security, and 55 fault cases |

## Adequacy matrix

| Criterion | Exact assertion evidence | Result |
| --- | --- | --- |
| SELECT/CTE and secrecy | `tests/contract/sqlite-probe-adapter.test.mjs:11-20` — exact objects/functions and absent SQL/value assertions | PASS |
| Safe catalog introspection | `tests/contract/sqlite-probe-adapter.test.mjs:22-24` and `tests/integration/sqlite-probe-adapter.test.mjs:22-31` — closed `main.sqlite_schema` path with unchanged bytes | PASS |
| Read-only open plus independent session controls (VES-DBP-002) | `tests/contract/sqlite-probe-adapter.test.mjs:32-43` — exact identity/query-only/authorizer evidence; `tests/integration/sqlite-probe-adapter.test.mjs:33-38` — real file evidence | PASS |
| Byte/digest preservation | `tests/integration/sqlite-probe-adapter.test.mjs:5-31` — real SELECT, CTE, and catalog reads preserve exact bytes and SHA-256 | PASS |
| ATTACH/PRAGMA/extensions/functions/write/parser denial | `tests/security/sqlite-probe-adapter.test.mjs:12-42` — stable-code assertion over 28 named SQL paths | PASS |
| Defense in depth at the real driver | `tests/security/sqlite-probe-adapter.test.mjs:50-62` — authorizer/read-only write denial and permanently disabled extension loading preserve bytes | PASS |
| Timeout and limits (VES-DBP-003) | `tests/integration/sqlite-probe-adapter.test.mjs:50-75` — exact timeout/row/byte errors and zero commits/one rollback | PASS |
| Protected plan/values (VES-DBP-003/004) | `tests/contract/sqlite-probe-adapter.test.mjs:50-78` — plan mismatch and bind mismatch occur before execution | PASS |
| Contradictory schema sources (VES-DBP-005) | Owned by T49 Database Knowledge Package; T47 supplies bounded catalog evidence without resolving contradictions | N/A locally |

## Necessary-test reverse map

| Test group | Requirement / done-when mapping | Keep |
| --- | --- | --- |
| Contract normalization, identity, session, stream | VES-DBP-002/004; SELECT/CTE/catalog/read-only criteria | Yes |
| Integration real-file digest, identity, timeout, row, byte | VES-DBP-002…004; immutable-open/file-preservation/limits criteria | Yes |
| Security SQL denial table | VES-DBP-003; ATTACH/PRAGMA/write/function/parser criteria | Yes |
| Security real driver denials | VES-DBP-002/003; authorizer and extension defense-in-depth criteria | Yes |

Adequacy verdict: necessary and sufficient for T47; every done-when criterion has exact assertion evidence and the focused count exceeds 26.

## Non-shallow checks

- The production-path fixture opens an actual SQLite file through `DatabaseSync` with `readOnly: true`, `allowExtension: false`, and `defensive: true`.
- `PRAGMA query_only=ON` is verified before installing an authorizer that permits only approved SELECT, READ, and function actions.
- Only the `main` database is accepted; ATTACH, DETACH, temporary objects, extra attached-database evidence, all user PRAGMAs, and recursive queries fail closed.
- Inline literals, quoted identifiers, numbered/named parameters, unsafe functions, writes, transaction controls, batches, comments, and unapproved catalogs fail before driver execution.
- Extension loading cannot be re-enabled on the connection because it was disabled at construction.
- Node 24.14.0 does not expose SQLite's native progress handler. Cooperative cancellation occurs between returned rows, while bounded timeout and hard cancellation are enforced by the already-qualified T41 isolated-worker supervisor and process-tree termination. A future runtime API must be separately qualified before replacing that boundary.
- Live application databases are not required for SQLite because the integration suite exercises real local files with the exact qualified runtime; platform release qualification remains mandatory.

## Verdict

PASS for T47 portable and real-file conformance. SQLite independently exceeds its test floor, preserves database bytes/digests, and the full security gate passes.
