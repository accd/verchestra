# Validation — signed-evidence canonical JSON

Status: corrected candidate awaiting fresh independent validation; no independent PASS.

## Author evidence

- `node --test tests/unit/execution-package.test.mjs tests/security/execution-package-security.test.mjs tests/security/evidence-tamper.test.mjs tests/security/canonical-json-census.test.mjs tests/security/canonical-json-locale-allowlist.test.mjs` — 116 pass, 0 fail, 0 skip, 0 todo after the correction.
- `corepack pnpm gate:quick` — PASS; 2,064 unit tests and 150 readiness tests, with 0 fail, skip, or todo.
- `corepack pnpm gate:security` — PASS; all selected build, unit, contract, E2E, architecture, qualification, and security stages completed with 0 fail, skip, or todo.
- `corepack pnpm site:check` and `corepack pnpm site:build` — PASS. `site:test` is not claimed: its Playwright web-server parent exited after the Astro preview daemon started, before browser assertions ran.

The quick and security gates above were rerun after the V1 ordering correction.

## Independent rejection of candidate `b116e84`

The independent verifier rejected CJE-01 and CJE-05. The candidate routed every
set through the V1 locale comparator, but the predecessor used native
code-unit `sort()` for `uniqueStrings`, task component references, verification
commands, done criteria, and pending-task `blockedBy`. With mixed-case values,
that changed V1 payload bytes and identities. The original focused suite passed
because its fixture values did not discriminate those comparators.

The correction restores native `sort()` at the legacy default-sort sites for
both schema versions, retains V1 `localeCompare` only at its historical sites,
and adds a mixed-case regression test. A fresh independent verdict is required.

The verifier must independently recreate a V1 package, a V2 package, and the
mixed-case ordering case; inspect schema/predicate selection; and run a disposable
mutation that reintroduces locale ordering or accepts a schema/predicate mismatch.
