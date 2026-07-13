# T45 SAP ASE (Sybase) Probe Adapter Validation

## Scope

- Task: T45 — Implement SAP ASE (Sybase) Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add sap ase adapter`
- Focused evidence: 58 cases (10 contract, 8 integration, 40 security), plus the canonical eight-engine planner route
- Spec deviations: none

T45 adds SAP Adaptive Server Enterprise as a first-class engine under the canonical `sybase` registration value. It is not a SQL Server compatibility mode. The adapter owns SAP ASE prepared-statement normalization, server-login and database-user evidence, role and permission checks, session transaction controls, lock and row limits, local system-catalog allowlists, cancellation, protected parameter binding, and a deterministic SAP ASE connection fixture.

## Official semantic basis

- SAP ASE prepared statements use dynamic parameter markers (`?`) and keep values separate from SQL.
- SAP ASE chained and unchained transaction modes have materially different behavior; the adapter explicitly selects unchained mode before beginning its transaction.
- `set lock wait` is the session-level lock timeout mechanism.
- `set rowcount` stops processing after the approved row count.
- `sysobjects`, `syscolumns`, and related local system tables are SAP ASE catalogs with their own permission model.
- SAP ASE roles and permissions are distinct from SQL Server database/server roles.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/sap-ase-probe-adapter.test.mjs tests/integration/sap-ase-probe-adapter.test.mjs tests/security/sap-ase-probe-adapter.test.mjs` | PASS — 58 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 417 security, and 55 fault cases |

## Sufficient coverage matrix

| Criterion / requirement | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| First-class SAP ASE route | Registration and planning accept `sybase` through an exact adapter route | `tests/unit/database-planner-property.test.mjs:55` — supported-engine loop includes `sybase` and asserts one neutral route | PASS |
| SELECT and derived-table normalization | One bounded read operation over owner-qualified approved objects | `tests/contract/sap-ase-probe-adapter.test.mjs:18-22` — exact object/function and secrecy assertions; `:27` — derived-table object assertion | PASS |
| Local catalog allowlist | Only approved local catalog objects are normalized for introspection | `tests/contract/sap-ase-probe-adapter.test.mjs:32` — exact `dbo.sysobjects` catalog; `tests/security/sap-ase-probe-adapter.test.mjs:43` — stable denial table | PASS |
| Dual read-only evidence (VES-DBP-002) | Restricted principal and engine-aware session/transaction evidence are both required | `tests/contract/sap-ase-probe-adapter.test.mjs:45-47` — exact product/principal evidence; `:53-60` — session result and controls; `tests/integration/sap-ase-probe-adapter.test.mjs:20-27` — session permission/role denials | PASS |
| Server/database privilege failures | Every elevated role or permission family produces non-read-only principal evidence | `tests/security/sap-ase-probe-adapter.test.mjs:61` — `principalReadOnly === false` over 11 named privilege families | PASS |
| Batch, procedure, dynamic SQL, proxy, database switch, temp/remote/system paths | Each unsafe SAP ASE form is rejected before connectivity with a stable adapter code | `tests/security/sap-ase-probe-adapter.test.mjs:43` — `assert.throws(..., { code })` over 26 named parser/security cases | PASS |
| Timeout and cancellation (VES-DBP-003) | Timeout cancels and produces zero partial promotion | `tests/integration/sap-ase-probe-adapter.test.mjs:35-37` — exact timeout, cancellation, zero commits/one rollback | PASS |
| Row and byte limits (VES-DBP-003) | Bound violations reject and roll back without promotion | `tests/integration/sap-ase-probe-adapter.test.mjs:45-46` and `:54-55` — exact codes and rollback state | PASS |
| Exact protected plan and parameters (VES-DBP-003/004) | Reparsed SQL equals the approved operation and value count equals markers before streaming | `tests/contract/sap-ase-probe-adapter.test.mjs:77-78` and `:89-90` — exact error plus zero stream; `tests/integration/sap-ase-probe-adapter.test.mjs:61-62` — values reach only stream | PASS |
| Accepted evidence (VES-DBP-004) | T41 promotes only a complete bounded result envelope with protected rows | `tests/contract/sap-ase-probe-adapter.test.mjs:66` — exact complete status and row count; the complete envelope remains covered by the T41 supervisor contract | PASS |
| Contradictory schema sources (VES-DBP-005) | Preserve all conflicting sources for later resolution | T45 produces bounded catalog evidence; source contradiction behavior remains owned by the Database Knowledge Package in T49 | Not applicable to adapter-local behavior |

## Necessary-test reverse map

| Test group | Requirement / done-when mapping | Keep |
| --- | --- | --- |
| Engine route and contract normalization | VES-DBP-002/004; first-class engine, SELECT, derived-table, catalog, and fixture criteria | Yes |
| Handshake, identity, session, stream, protected-plan contract | VES-DBP-002…004; read-only identity/session and protected evidence criteria | Yes |
| Integration identity/session/timeout/row/byte/value paths | VES-DBP-002…004; privilege, cancellation, and limits criteria | Yes |
| Security parser denial table | VES-DBP-003; batch, procedure, dynamic SQL, proxy, database switch, temp/remote/system and parser-bypass criteria | Yes |
| Security role/permission table | VES-DBP-002; server-login and database-user privilege-failure criterion | Yes |

Adequacy verdict: necessary and sufficient for the T45 adapter surface; all done-when criteria have exact assertion evidence and the focused count exceeds 32.

## Non-shallow checks

- The `sybase` engine identity is verified as `sap-ase`; SQL Anywhere or SAP IQ cannot satisfy the handshake evidence.
- SAP ASE does not inherit SQL Server parser, catalog, role, session, or cancellation semantics.
- Principal checks cover `sa_role`, `sso_role`, `oper_role`, `replication_role`, `dtm_tm_role`, database ownership, server administration, write, DDL, execute, and proxy authority independently.
- Session setup fixes transaction mode, lock wait, row count, and transaction start, then independently rechecks active write, dangerous-role, and execute authority.
- The adapter and T41 supervisor jointly enforce timeout, row, byte, and transactional non-promotion bounds.
- SQL and values remain inside the protected request callback and prepared connection stream.
- The parser denies global variables, inline numeric/string literals, comments, multiple batches, remote or cross-database names, temporary objects, control commands, procedures, dynamic SQL, writes, and unapproved catalogs/functions.
- Live SAP ASE evidence was unavailable in this environment. The deterministic fixture proves portable adapter conformance; the production driver and a live SAP ASE instance remain mandatory promotion evidence.

## Verdict

PASS for T45 implementation and portable conformance. SAP ASE is now a first-class, independently enforced engine and the full security gate passes. Live-instance and corporate-driver promotion evidence remains pending in a qualified environment.
