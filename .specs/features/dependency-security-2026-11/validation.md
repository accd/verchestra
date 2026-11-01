# Dependency security, November 2026: validation

**Date:** 2026-11-01
**Host:** Windows 11, Node 24.14.0, pnpm 10.34.5
**Base:** `main` at `6a90d021`

| Requirement | Evidence                                                                                                                                                                                                                                                                                                                           | Result                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DSN-01      | Declared ranges, read with `npm view`: `express` 5.2.1 `body-parser ^2.2.1`; `express-rate-limit` 8.7.0 `ip-address ^10.2.0`; `socks` 2.8.9 `ip-address ^10.1.1`. Both overrides are exact and inside those ranges. Published `body-parser` 2.4.0 on 2026-10-22 and `ip-address` 10.7.5 on 2026-10-25, both older than three days. | PASS                              |
| DSN-02      | The new assertions in `tests/agent-readiness/dependency-policy.test.mjs` failed on the base (`body-parser@2.3.0 is below 2.4.0`) and pass after the change, 13 of 13. `pnpm why -r` resolves `body-parser` 1.20.9 and 2.4.0, and `ip-address` 10.7.5 only. `pnpm audit` lists only GHSA-g3hv-75wg-m249 (`minimatch`).              | PASS                              |
| DSN-03      | The `pnpm-lock.yaml` diff touches the two override lines, `body-parser` 2.3.0 → 2.4.0 and `ip-address` 10.7.2 → 10.7.5 (no new transitive package). The `legacy-javascript` 0.0.3 → 0.0.4 re-resolution was reverted. `pnpm install --frozen-lockfile` succeeds.                                                                   | PASS                              |
| DSN-04      | `minimatch` stays at 10.2.6 and 3.1.5. The reasons are in `spec.md`.                                                                                                                                                                                                                                                               | PASS (no override by design)      |
| DSN-05      | `gate:quick` PASS: unit 3681, agent-readiness 471, canonical JSON census 14, each with 0 failed and 0 skipped. `test:architecture` 149 of 149 and `agent:check` PASS.                                                                                                                                                              | PASS locally; CI is authoritative |

## Sealed closure check

`bundleSealedLauncherWithMetafile` (from `scripts/t76-build-candidate.mjs`) ran
for every `SEALED_BUNDLE_ENTRIES` component and listed its metafile inputs:

| Component                                | Inputs    | `express`, `body-parser`, `express-rate-limit`, `ip-address`, `socks` |
| ---------------------------------------- | --------- | --------------------------------------------------------------------- |
| `launcher:vestra`, `launcher:verchestra` | 1597 each | none; 18 MCP SDK client-path modules                                  |
| `self-test:full-crash-child`             | 206       | none                                                                  |
| `mcp:tool-bridge-relay`                  | 68        | none                                                                  |
| `probe:sqlite-worker`                    | 38        | none                                                                  |
