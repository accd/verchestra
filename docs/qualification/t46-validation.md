# T46 Oracle Probe Adapter Validation

## Scope

- Task: T46 — Implement Oracle Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add oracle adapter`
- Focused evidence: 53 cases (10 contract, 8 integration, 35 security)
- Spec deviations: none

T46 adds a conservative Oracle 19c+ read adapter with `:pN` binds, exact product and privilege evidence, native `SET TRANSACTION READ ONLY`, effective-session revalidation, driver-level maximum rows, cancellation, safe `ALL_*` introspection, and deterministic fixture conformance.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/oracle-probe-adapter.test.mjs tests/integration/oracle-probe-adapter.test.mjs tests/security/oracle-probe-adapter.test.mjs` | PASS — 53 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 452 security, and 55 fault cases |

## Adequacy matrix

| Criterion | Exact assertion evidence | Result |
| --- | --- | --- |
| SELECT/CTE and secrecy | `tests/contract/oracle-probe-adapter.test.mjs:11-18` — exact objects/functions and absent SQL/value assertions | PASS |
| Safe catalog introspection | `tests/contract/oracle-probe-adapter.test.mjs:19` — exact `all_tables` catalog; security denial table for all other contexts | PASS |
| Principal plus native read-only transaction (VES-DBP-002) | `tests/contract/oracle-probe-adapter.test.mjs:21-22` — restricted identity and exact session controls; `tests/integration/oracle-probe-adapter.test.mjs:7-10` — identity/session denials | PASS |
| PL/SQL, procedure, link, catalog and parser denial | `tests/security/oracle-probe-adapter.test.mjs:34` — stable-code assertion over 23 named SQL paths | PASS |
| Privilege failures | `tests/security/oracle-probe-adapter.test.mjs:42` — `principalReadOnly === false` over 11 elevated privilege families | PASS |
| Timeout and limits (VES-DBP-003) | `tests/integration/oracle-probe-adapter.test.mjs:11-13` — exact timeout/row/byte errors and zero commits/one rollback | PASS |
| Driver row limit | `tests/contract/oracle-probe-adapter.test.mjs:23` — exact `maximumRows === 100` with complete result | PASS |
| Protected plan/values (VES-DBP-003/004) | `tests/contract/oracle-probe-adapter.test.mjs:24-25` — mismatch before stream; `tests/integration/oracle-probe-adapter.test.mjs:14` — value reaches only driver | PASS |
| Contradictory schema sources (VES-DBP-005) | Owned by T49 Database Knowledge Package; T46 supplies bounded introspection evidence without resolving contradictions | N/A locally |

## Necessary-test reverse map

| Test group | Requirement / done-when mapping | Keep |
| --- | --- | --- |
| Contract normalization, identity, session, stream | VES-DBP-002/004; SELECT/CTE/catalog/row-limit criteria | Yes |
| Integration identity, session, timeout, row, byte, values | VES-DBP-002…004; permission/cancellation/limits criteria | Yes |
| Security SQL denial table | VES-DBP-003; PL/SQL/procedure/link/catalog/parser criteria | Yes |
| Security privilege table | VES-DBP-002; privilege-failure criterion | Yes |

Adequacy verdict: necessary and sufficient for T46; every done-when criterion has exact assertion evidence and the focused count exceeds 28.

## Non-shallow checks

- Oracle product identity is exact; compatible-lookalike products fail closed.
- Native read-only transaction evidence is required in addition to a restricted database user.
- SYS administrative identities, DBA role, write system/object privileges, procedure execution, and database-link creation are independently rejected.
- Database links, row locks, sequences, PL/SQL, procedures, hints/comments, literals, unsafe packages, and privileged catalogs fail before streaming.
- The driver receives the approved row maximum while T41 independently enforces row, byte, time, and transactional promotion bounds.
- Live Oracle/container evidence was unavailable; deterministic fixture conformance passes, while live-instance and production-driver evidence remain mandatory for promotion.

## Verdict

PASS for T46 portable conformance. Oracle independently exceeds its test floor and the full security gate passes.
