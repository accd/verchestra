# Validation — signed-evidence canonical JSON

Status: implementation evidence recorded; independent verification pending.

## Author evidence

- `node --test tests/unit/execution-package.test.mjs tests/security/execution-package-security.test.mjs tests/security/evidence-tamper.test.mjs tests/security/canonical-json-census.test.mjs tests/security/canonical-json-locale-allowlist.test.mjs` — 115 pass, 0 fail, 0 skip, 0 todo.
- `corepack pnpm gate:quick` — PASS; 2,064 unit tests and 150 readiness tests, with 0 fail, skip, or todo.
- `corepack pnpm gate:security` — PASS; all selected build, unit, contract, E2E, architecture, qualification, and security stages completed with 0 fail, skip, or todo.
- `corepack pnpm site:check` and `corepack pnpm site:build` — PASS. `site:test` is not claimed: its Playwright web-server parent exited after the Astro preview daemon started, before browser assertions ran.

The author has not produced the independent verdict. The verifier must test the
requirements and discrimination sensor below against the committed candidate.

The verifier must independently recreate a V1 package, a V2 package, and the
mixed-case ordering case; inspect schema/predicate selection; and run a disposable
mutation that reintroduces locale ordering or accepts a schema/predicate mismatch.
