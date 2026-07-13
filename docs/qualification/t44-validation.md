# T44 SQL Server Probe Adapter Validation

## Scope

- Task: T44 — Implement SQL Server Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add sql server adapter`
- Focused evidence: 46 cases (10 contract, 6 integration, 30 security)
- Spec deviations: none

T44 introduces a conservative T-SQL read grammar, login and database-role evidence, independent session permission revalidation, cancellation, catalog allowlists, protected parameter binding, and a deterministic SQL Server connection fixture. SQL Server has no direct read-only transaction mode equivalent to PostgreSQL `BEGIN READ ONLY`; the adapter therefore does not make that false claim. It requires a restricted principal and independently proves the active session cannot update the database before the T41 supervisor permits execution.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/sqlserver-probe-adapter.test.mjs tests/integration/sqlserver-probe-adapter.test.mjs tests/security/sqlserver-probe-adapter.test.mjs` | PASS — 46 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 377 security, and 55 fault cases |

## Sufficient coverage matrix

| Criterion / requirement | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| SELECT and CTE normalization | One bounded read operation over approved qualified objects | `tests/contract/sqlserver-probe-adapter.test.mjs:18` — `assert.deepEqual(operation.objects, ...)`; `:26` — CTE object assertion | PASS |
| Catalog allowlist | Unsafe catalogs are rejected before execution | `tests/contract/sqlserver-probe-adapter.test.mjs:31` — approved `sys.tables`; `tests/security/sqlserver-probe-adapter.test.mjs:57` — exact denial-code table including system object | PASS |
| Dual read-only controls (VES-DBP-002) | Restricted principal plus engine-aware session evidence are both required | `tests/contract/sqlserver-probe-adapter.test.mjs:44` — `principalReadOnly === true`; `:51` — session and transaction evidence; `tests/integration/sqlserver-probe-adapter.test.mjs:14` — writable session denial | PASS |
| Permission failures | Every listed elevated role/permission produces non-read-only principal evidence | `tests/security/sqlserver-probe-adapter.test.mjs:76` — `principalReadOnly === false` for seven privilege families | PASS |
| Batch separator, EXEC, temp/system objects, hints | Each listed unsafe T-SQL form is rejected with a stable adapter error | `tests/security/sqlserver-probe-adapter.test.mjs:57` — `assert.throws(..., { code })` over 17 named cases | PASS |
| Cancellation and timeout (VES-DBP-003) | Timeout cancels execution and promotes no partial evidence | `tests/integration/sqlserver-probe-adapter.test.mjs:23-25` — timeout code, cancellation, zero commits/one rollback | PASS |
| Row and byte limits (VES-DBP-003) | Bound violation rejects and promotes no partial evidence | `tests/integration/sqlserver-probe-adapter.test.mjs:33-34` and `:42-43` — exact limit codes and rollback state | PASS |
| Protected plan/parameters (VES-DBP-003/004) | SQL/value content is absent from the plan and execution must equal the approved operation | `tests/contract/sqlserver-probe-adapter.test.mjs:20-21` — no value/SQL; `:75-76` — plan mismatch before stream; `:87-88` — parameter mismatch before stream; `tests/integration/sqlserver-probe-adapter.test.mjs:49-50` — values reach only stream | PASS |
| Accepted evidence (VES-DBP-004) | T41 promotes only a complete bounded result envelope with protected row reference | `tests/contract/sqlserver-probe-adapter.test.mjs:64` — complete status and exact row count; inherited full envelope assertions remain in the T41 supervisor contract | PASS |
| Contradictory schema sources (VES-DBP-005) | Preserve contradictions rather than resolving silently | No SQL Server-specific behavior is introduced; T44 produces introspection evidence for the later Database Knowledge Package in T48 | Not applicable to adapter-local behavior |

## Necessary-test reverse map

| Test group | Requirement / done-when mapping | Keep |
| --- | --- | --- |
| Contract normalization, handshake, identity, session, stream | VES-DBP-002/004; SELECT/CTE/catalog and fixture criteria | Yes |
| Contract plan/parameter mismatch and lifecycle delegation | VES-DBP-003/004; cancellation and protected execution criteria | Yes |
| Integration identity/session/timeout/row/byte/value paths | VES-DBP-002…004; permission, cancellation, limits criteria | Yes |
| Security parser denial table | VES-DBP-003; batch, EXEC, temp/system object, hint criteria | Yes |
| Security elevated-principal table | VES-DBP-002; permission-failure criterion | Yes |

Adequacy verdict: necessary and sufficient for the T44 adapter surface; all listed done-when cases have exact assertion evidence and the focused count exceeds 28.

## Non-shallow checks

- Principal checks cover `sysadmin`, `securityadmin`, `db_owner`, `db_ddladmin`, `db_datawriter`, direct write permission, and impersonation independently.
- Session setup applies `XACT_ABORT`, bounded lock timeout, snapshot isolation, and an explicit transaction, then checks effective database `UPDATE` permission inside that session.
- The exact protected SQL is reparsed and must equal the approved normalized operation; placeholder and protected-value cardinality must match before streaming.
- Timeout, row overflow, and byte overflow assert both the public failure and transactional non-promotion state.
- The grammar denies batch separators, execution, writes, temporary objects, hints, external data functions, comments, literals, quoted identifiers, unqualified objects, unsafe catalogs, and non-ASCII parser bypasses.
- Live SQL Server/container evidence was unavailable in this environment. The deterministic connection fixture proves portable adapter conformance; a live-instance promotion check remains mandatory before production qualification.

## Verdict

PASS for T44 implementation and portable conformance. The adapter exceeds the required case floor, preserves SQL Server's real read-only limitations, and the full security gate passes. Live-instance promotion evidence remains pending in a qualified environment.
