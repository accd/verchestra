# Database probe contract and conformance kit

Issue: #233. Resolves the 1.0 half of AD-017 (`.specs/STATE.md`): a
published probe contract, a runnable conformance kit, and real-SQLite
qualification are the claim; no other live engine is claimed qualified by
this repository.

## The edge-qualification model

A team implements the published `packages/data-probe` connection port for
its own engine **in its own repository**, runs the conformance kit against
its own database, and commits the resulting probe like any other delivered
code. This is workspace-side only: generated or hand-written probe code
never enters the installed product. Verchestra's job is verified delivery —
the team's probe is delivered *by* Verchestra's own flow (gates, review,
commit) and re-verified continuously by the kit in the team's own CI.

SAP ASE / Sybase holds contract-kit parity with every other engine — it is
not a principal qualification target; no engine other than SQLite is
claimed live-qualified by this repository.

## The flow

1. **Implement the port.** Pick your engine's connection port and its
   supporting types, exported from `packages/data-probe/src/index.ts`
   (`PostgreSqlConnectionPort`, `FamilyConnectionPort`, `SqlServerConnectionPort`,
   `SapAseConnectionPort`, `OracleConnectionPort`, `SqliteConnectionPort`,
   `MongoDbConnectionPort`). Each port is a handful of methods —
   `inspectPrincipal`, a control/session method, `stream`, `cancel`,
   `terminate` — that a thin adapter over your driver's native client can
   satisfy directly. No product code is exposed beyond the port and its
   plan/observation types.
2. **Run the kit.** Each engine's conformance kit lives in
   `tests/helpers/<engine>-probe-fixture.mjs` and `tests/contract/<engine>-probe-adapter.test.mjs`.
   Every kit accepts `options.realConnection` — pass your implementation
   instead of the built-in fixture connection and the identical
   `ProbeWorkerSupervisor` bounds and contract assertions run against it,
   exactly the way `tests/helpers/sqlite-probe-fixture.mjs`'s
   `realSqliteFixture` already runs a real `node:sqlite`-backed connection
   through the SQLite kit. `tests/contract/conformance-kit-parity.test.mjs`
   pins that every kit accepts this seam.
3. **Commit the probe in your own repository.** The implementation and its
   kit run stay in your workspace's own repo, gated by your own CI. Nothing
   is uploaded to or merged into this repository.

## Read-only session obligations per engine

Every adapter's `configureReadOnlySession` (or `configureAuthorization` /
`configureReadOnly`) issues engine-specific statements to force the session
into a verifiably read-only state before any row streams, then reads back
session state to prove it — never trusts the driver's own claim. A
conforming implementation must let the adapter drive this sequence
unmodified; it must not pre-open the connection in a way that makes any of
these statements a no-op.

| Engine | Read-only enforcement | Timeout binding | Principal evidence read back |
| --- | --- | --- | --- |
| PostgreSQL | `BEGIN READ ONLY` | `SET LOCAL statement_timeout`, `SET LOCAL lock_timeout` (both bound to the plan's `bounds.timeoutMs`) | `SHOW transaction_read_only` |
| MySQL | `START TRANSACTION READ ONLY` | `SET SESSION MAX_EXECUTION_TIME` | `SELECT @@transaction_read_only` |
| MariaDB | `START TRANSACTION READ ONLY` | `SET SESSION max_statement_time` (seconds) | `SELECT @@tx_read_only` |
| SQL Server | `BEGIN TRANSACTION` under `SET TRANSACTION ISOLATION LEVEL SNAPSHOT` | `SET LOCK_TIMEOUT` | `HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE')` |
| Oracle | `SET TRANSACTION READ ONLY` | (session-level; not separately bound) | `session_write_count`, `session_dangerous_role_count`, `transaction_read_only` from `dual` |
| SAP ASE | `set chained off`, `begin transaction` | `set lock wait <seconds>` (ceiling of the plan's timeout), `set rowcount` (row bound) | `session_write_count`, `session_dangerous_role_count`, `session_execute_count` |
| SQLite | `PRAGMA query_only=ON` at connection open, plus a `setAuthorizer` callback restricting `SQLITE_READ`/`SQLITE_FUNCTION` to the plan's approved objects and functions | n/a (local file) | The authorizer's own accepted/denied state, plus `PRAGMA query_only` |
| MongoDB | `readConcern`/`noCursorTimeout` session controls, `genericCommandDisabled` | `maxTimeMS` (bound to the plan's `bounds.timeoutMs`), `batchSize` (bound to `bounds.rowLimit`) | The session control echo itself (no separate read-only query; MongoDB has no session-level write flag to read back) |

Every `inspectPrincipal` call additionally returns an engine-specific
privilege/role observation (for example PostgreSQL's `superuser`,
`createRole`, `createDatabase`, `replication`, `bypassRls`,
`writePrivilegeCount`; SQL Server's `sysadmin`, `securityAdmin`, `dbOwner`,
and similar). The adapter's `verifyIdentity` derives `principalReadOnly`
from that observation before any statement executes — a conforming
connection implementation must observe and report the same signals a real
credential audit would use, not fabricate a permissive default.

## Error handling

An adapter's own validation errors (malformed protected requests, plan
mismatches, denied objects or functions) carry static, pre-written
messages that never interpolate SQL text, parameter values, or row data —
propagate them unchanged. An error your connection implementation raises
(a real driver error) is untrusted by the adapter and gets rewritten to a
single generic `..._CONNECTION_FAILURE` code before it reaches the caller,
because a real error message may itself contain the failing statement or a
bound value. See `packages/data-probe/src/postgresql-adapter.ts`'s
`execute()` for the reference implementation of this split.
