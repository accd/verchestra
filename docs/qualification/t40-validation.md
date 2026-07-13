# T40 Database Registry and Probe Planner Validation

## Scope

- Task: T40 — Implement database registration and engine-neutral Probe Planner
- Requirements: VES-DBP-001…003/005, VES-DSC-001
- Commit target: `feat(probe): add database registry and planner`
- Focused evidence: 58 cases (18 unit, 13 property, 27 security)
- Spec deviations: none

T40 introduces immutable content-addressed Database Registrations, a Workspace-isolated registry/store port, a closed normalized read-operation contract, explicit purpose/object/function/catalog/bounds policy, and an engine adapter validation port. Plans contain only logical credential bindings and protected request references; raw statements, connection strings, parameter values, and credential values are outside the canonical contract.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/database-registry-planner.test.mjs tests/unit/database-planner-property.test.mjs tests/security/database-planner-security.test.mjs` | PASS — 58 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 282 security, and 49 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Canonical registration | Exact closed schema, sorting/deduplication, immutable digest, idempotent save, conflicting-content rejection | Yes |
| Credential separation | Four secret-bearing field attacks, logical-name-only serialization, no parameter values delivered to adapter | Yes |
| Multi-database isolation | Multiple identities, same identity in separate Workspaces, missing/cross-Workspace rejection | Yes |
| Engine neutrality | PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, and MongoDB share one plan contract | Yes |
| Engine qualification port | Exact adapter identity, duplicate/missing adapter rejection, engine-specific violation handling | Yes |
| Read-only contract | Only structured `select`/`introspect`, exactly one statement, protected local request reference | Yes |
| Object policy | Approved schema, exact object allowlist, catalog denial, hostile identifier rejection | Yes |
| Function policy | Explicit allowlist and denylist with canonical case handling | Yes |
| Bounds | Timeout, row, byte, and concurrency lower/upper boundaries plus overflow rejection | Yes |
| Pre-worker rejection | Raw SQL, write, multi-statement, engine, purpose, policy, object, function, and bounds fail before adapter validation | Yes |
| Determinism | Input-order invariance and bound-field digest sensitivity | Yes |
| Defense in depth | Every plan requires read-only database principal and engine session checks | Yes |
| Minimum floor | 58 focused cases versus required 40 | Yes |

## Non-shallow checks

- Canonical configuration rejects undeclared fields, including `credentialValue`, `connectionString`, `password`, and `url`.
- SQL text and parameter values remain in protected request storage referenced by an opaque logical identifier; they cannot enter a plan artifact.
- Generic validation runs before the engine adapter, so common policy failures cannot exploit parser or worker differences.
- Production and non-production plans both require a read-only database principal and an engine-aware read-only session; T41 must verify both before execution.
- Object and function allowlists are positive authorization. Unknown values fail closed even when they are not present in a denylist.
- Plans bind Workspace, database registration digest, engine, purpose, policy, bounds, Capability Grant, and credential logical name into one deterministic digest.
- The temporary local dependency restoration used the exact locked pnpm 10.34.5 and cached lockfile artifacts; no manifest, lockfile, or repository supply-chain policy changed.

## Verdict

PASS. Tests preceded implementation, credential material and raw SQL are absent from the canonical contract, all required pre-worker denial families are covered, the test floor is exceeded, and the full security gate passes.
