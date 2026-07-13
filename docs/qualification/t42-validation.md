# T42 PostgreSQL Probe Adapter Validation

## Scope

- Task: T42 — Implement PostgreSQL Probe adapter
- Requirements: VES-DBP-002…005
- Commit target: `feat(probe): add postgresql adapter`
- Focused evidence: 41 cases (12 contract, 10 integration, 19 security)
- Spec deviations: none

T42 introduces a conservative PostgreSQL read parser/normalizer, exact protected-request-to-plan binding, restricted-role evidence, a read-only transaction/session handshake, safe catalog introspection, positional parameter validation, streaming, cancellation, and a deterministic PostgreSQL connection fixture behind the production connection port.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/postgresql-probe-adapter.test.mjs tests/integration/postgresql-probe-adapter.test.mjs tests/security/postgresql-parser-security.test.mjs` | PASS — 41 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,496 unit/property, 10 architecture, 248 qualification, 313 security, and 55 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Allowed read forms | Parameterized SELECT, read-only CTE, EXPLAIN FORMAT JSON | Yes |
| Normalization | Stable objects/functions/classifications with no SQL or values | Yes |
| Catalog introspection | Explicit introspection kind and closed safe catalog relation set | Yes |
| Principal proof | Superuser, create-role, create-database, replication, bypass-RLS, and write-grant negatives | Yes |
| Session proof | Exact BEGIN READ ONLY, local statement/lock timeouts, observed transaction_read_only | Yes |
| Plan binding | Reparsed protected request must equal the exact approved normalized operation | Yes |
| Parameters | Closed protected JSON, scalar positional values, continuous placeholders, exact count | Yes |
| Write bypass corpus | INSERT CTE, UPDATE, DELETE, COPY, row locking, multi-statement | Yes |
| Parser bypass corpus | Line/block comments, literals, dollar quotes, NUL, Unicode homoglyph, unqualified object | Yes |
| Function policy | pg_read_file and pg_sleep rejected; closed read function set | Yes |
| Runtime behavior | T41 bounded stream, timeout cancellation, connection cancel/terminate, protected values | Yes |
| Minimum floor | 41 focused cases versus required 28 | Yes |

## Non-shallow checks

- The accepted language is intentionally narrow ASCII, schema-qualified, parameterized SQL. Unsupported valid PostgreSQL syntax is denied rather than guessed safe.
- SQL comments, semicolons, inline string literals, quoted identifiers, dollar quoting, backslashes, non-ASCII text, and unknown functions fail closed.
- A CTE cannot hide INSERT or another write verb because the write vocabulary is checked before read-form normalization.
- Role evidence rejects every PostgreSQL privilege class that can bypass normal read-only assumptions, plus any observed schema write grant.
- Session setup uses fixed control statements with bound timeout values and trusts only the server-observed `transaction_read_only=on` response.
- SQL and parameter values stay inside protected bytes and the connection callback; the canonical operation and plan contain neither.
- Adapter errors crossing the isolated-worker boundary are accepted only under the closed `VES_POSTGRES_*` namespace and safe-message grammar; arbitrary worker errors remain sanitized.

## Environmental qualification note

Docker Desktop is installed on the validation machine, but its Linux daemon did not become available during the bounded startup attempt on 2026-07-13. Therefore the portable deterministic PostgreSQL connection fixture ran, while live-container evidence was not produced in this task execution. Live PostgreSQL qualification remains a mandatory promotion/release environment check and must not be inferred from this report.

## Verdict

PASS for T42 implementation and portable conformance. Tests preceded implementation, all required allowed and hostile families pass, the test floor is exceeded, and the security gate is green. Live-container promotion evidence remains explicitly pending in an environment with an available Docker/PostgreSQL service.
