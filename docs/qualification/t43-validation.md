# T43 MySQL and MariaDB Probe Adapter Validation

## Scope

- Task: T43 — Implement MySQL and MariaDB Probe adapters
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add mysql mariadb adapters`
- Focused evidence: 70 cases (18 contract, 18 integration, 34 security), 35 independently attributed to each engine
- Spec deviations: none

T43 introduces a conservative shared MySQL-family read grammar with separate MySQL and MariaDB components, server-family/version qualification, capability evidence, privilege checks, read-only session controls, timeout semantics, cancellation, metadata allowlists, protected parameters, and deterministic engine fixtures.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/mysql-family-probe-adapters.test.mjs tests/integration/mysql-family-probe-adapters.test.mjs tests/security/mysql-family-parser-security.test.mjs` | PASS — 70 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 347 security, and 55 fault cases |

## Adequacy matrix

| Criterion | MySQL | MariaDB |
| --- | --- | --- |
| Independently attributed focused cases | 35 | 35 |
| SELECT and read-only CTE | Yes | Yes |
| Safe information_schema introspection | Yes | Yes |
| Distinct component identity | `probe-worker:mysql` | `probe-worker:mariadb` |
| Version/family qualification | MySQL 8+ and non-MariaDB identity | MariaDB identity and CTE-capable version |
| Required capabilities | CTE, read-only transactions, metadata | CTE, read-only transactions, metadata |
| Read-only variable | `@@transaction_read_only` | `@@tx_read_only` |
| Timeout control | `MAX_EXECUTION_TIME` milliseconds | `max_statement_time` seconds |
| Privilege negatives | Write, FILE, SUPER, CREATE USER | Write, FILE, SUPER, CREATE USER |
| Unsafe paths | Procedure, export, LOAD DATA, HANDLER, metadata | Procedure, export, LOAD DATA, HANDLER, metadata |
| Parser bypass | Multi-statement, comments, literals, quoting, Unicode | Multi-statement, comments, literals, quoting, Unicode |
| Cancellation and protected parameters | Yes | Yes |
| Required minimum | 24 | 24 |

## Non-shallow checks

- Shared parsing does not imply shared qualification: the worker components, server identity, version policy, read-only observation, and timeout statements remain engine-specific.
- The grammar accepts only ASCII, schema-qualified, parameterized SELECT/CTE forms and a closed information_schema relation set.
- Stored procedures, server-side OUTFILE/DUMPFILE exports, LOAD DATA, HANDLER, system schemas, dangerous functions, comments, semicolons, literals, quoting, and Unicode tricks fail before streaming.
- Principal evidence rejects schema write grants and FILE, SUPER, or CREATE USER privileges independently for both engines.
- The exact protected SQL is reparsed at execution and must equal the approved normalized operation; parameter count must equal placeholder count.
- SQL and values remain inside the protected callback and connection stream, never the plan or result envelope.
- Live container evidence was unavailable for the same Docker daemon condition recorded by T42; deterministic per-engine connection fixtures provide portable conformance, while live MySQL/MariaDB promotion evidence remains mandatory.

## Verdict

PASS for T43 implementation and portable conformance. Both engines independently exceed the required test floor, their semantic differences remain explicit, and the full security gate passes. Live-container promotion evidence remains pending in a qualified environment.
