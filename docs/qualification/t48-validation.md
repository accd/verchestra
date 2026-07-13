# T48 MongoDB Probe Adapter Validation

## Scope

- Task: T48 — Implement MongoDB Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add mongodb adapter`
- Focused evidence: 59 cases (10 contract, 17 integration, 32 security)
- Spec deviations: none

T48 adds a closed protected JSON/BSON-template adapter for `find`, `aggregate`, `explain`, and collection introspection. It uses positional protected-value references, exact product/database/role/action evidence, a typed-read-only driver surface, closed database/collection/stage/operator allowlists, server-side `maxTimeMS`, cursor batch/limit controls, cancellation, and deterministic fixture conformance.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/mongodb-probe-adapter.test.mjs tests/integration/mongodb-probe-adapter.test.mjs tests/security/mongodb-probe-adapter.test.mjs` | PASS — 59 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 515 security, and 55 fault cases |

## Adequacy matrix

| Criterion | Exact assertion evidence | Result |
| --- | --- | --- |
| Closed find/aggregate/explain/introspection normalization | `tests/contract/mongodb-probe-adapter.test.mjs:11-40` — exact objects/operators and no protected values | PASS |
| All four read forms execute through the typed port | `tests/contract/mongodb-probe-adapter.test.mjs:68-71` and `tests/integration/mongodb-probe-adapter.test.mjs:5-27` | PASS |
| Exact read identity (VES-DBP-002) | `tests/contract/mongodb-probe-adapter.test.mjs:48-53`; `tests/integration/mongodb-probe-adapter.test.mjs:30-50` — product/database/auth/role/action matrix | PASS |
| Independent bounded session controls | `tests/contract/mongodb-probe-adapter.test.mjs:55-66` and `tests/integration/mongodb-probe-adapter.test.mjs:52-54` — typed-only surface, generic command denial, majority read concern, max time, batch, cursor timeout | PASS |
| Writes, output stages, JavaScript, stage/operator/database/collection denial | `tests/security/mongodb-probe-adapter.test.mjs:8-80` — stable-code assertion over 28 named command paths | PASS |
| Planner database/collection allowlists | `tests/security/mongodb-probe-adapter.test.mjs:91-97` — normalized but unapproved resources fail planner authorization | PASS |
| Timeout and limits (VES-DBP-003) | `tests/integration/mongodb-probe-adapter.test.mjs:56-79` — timeout/row/byte errors and zero commits/one rollback | PASS |
| Protected plan/values (VES-DBP-003/004) | `tests/contract/mongodb-probe-adapter.test.mjs:73-82`; `tests/integration/mongodb-probe-adapter.test.mjs:81-86`; `tests/security/mongodb-probe-adapter.test.mjs:82-89` | PASS |
| Contradictory schema sources (VES-DBP-005) | Owned by T49 Database Knowledge Package; T48 supplies bounded collection introspection evidence without resolving contradictions | N/A locally |

## Necessary-test reverse map

| Test group | Requirement / done-when mapping | Keep |
| --- | --- | --- |
| Contract normalized operations, identity, session, stream | VES-DBP-002/004; all four read forms and role/session criteria | Yes |
| Integration operation execution, identity matrix, timeout/limits/values | VES-DBP-002…004; typed execution and bounded behavior | Yes |
| Security command/stage/operator matrix | VES-DBP-003; write, `$out`, `$merge`, JavaScript, database, and collection criteria | Yes |
| Security planner and protected request checks | VES-DBP-003/004; allowlist and parameter-reference criteria | Yes |

Adequacy verdict: necessary and sufficient for T48; every done-when criterion has exact assertion evidence and the focused count exceeds 28.

## Non-shallow checks

- Protected requests are closed structural templates rather than raw JavaScript or shell/driver expressions; business values are referenced as `{$param:n}` and resolved only inside the connection boundary.
- The adapter never exposes a generic database-command method. Its port accepts only the already normalized typed read command.
- Only the exact `read` role on the target database is accepted. `readAnyDatabase`, `readWrite`, foreign-database roles, disabled authorization, and observed write/admin/server-execution actions fail closed.
- `$out` and `$merge` are denied as write stages. MongoDB documents both as collection-writing aggregation stages.
- `$where`, `$function`, `$accumulator`, and `mapReduce` are denied as server-side execution, independent of their deprecation status.
- `aggregate` permits only `$match`, `$project`, `$sort`, and a bounded `$limit`; collection-crossing and streaming stages such as `$lookup`, `$unionWith`, `$graphLookup`, and `$changeStream` are denied.
- Server-side `maxTimeMS`, bounded batch size, cursor timeout policy, T41 wall-clock/row/byte/concurrency bounds, and cursor cancellation are independent controls.
- Portable conformance uses a deterministic typed connection fixture. A live MongoDB server and selected production driver remain mandatory promotion evidence before production eligibility.

## Primary sources

- MongoDB authorization and cumulative role behavior: <https://www.mongodb.com/docs/manual/core/authorization/>
- MongoDB built-in roles: <https://www.mongodb.com/docs/manual/reference/built-in-roles/>
- MongoDB aggregation stages: <https://www.mongodb.com/docs/current/reference/operator/aggregation-pipeline/>
- MongoDB `$merge` write behavior: <https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/>
- MongoDB `$out` write behavior: <https://www.mongodb.com/docs/manual/reference/operator/aggregation/out/>
- MongoDB server-side JavaScript: <https://www.mongodb.com/docs/v8.0/core/server-side-javascript/>
- MongoDB cursor `maxTimeMS`: <https://www.mongodb.com/docs/manual/reference/method/cursor.maxtimems/>

## Verdict

PASS for T48 portable conformance. MongoDB independently exceeds its test floor and the full security gate passes.
