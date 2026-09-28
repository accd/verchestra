# OpenCode runtime 1.18.33 validation

**Date:** 2026-09-29
**Diff:** `requal/opencode-1.18.23` rebased onto `main`, packages moved to `1.18.33`
**Verifier:** primary agent local verification; GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| OC-01 | `tests/agent-readiness/dependency-policy.test.mjs:30`, `:31` (manifest) and `:38` (lockfile) assert exactly `1.18.33`; `pnpm install --frozen-lockfile` passes | PASS |
| OC-02 | `spikes/opencode-driver/test/opencode-driver.test.mjs:79` keeps the `1.17.18` floor; `:82` pins the live probe to `1.18.33`; `:93`-`:106` discriminate drift from the pin. `VES_REQUIRE_PINNED_PROVIDERS=1 corepack pnpm qualify:opencode`: 18 of 18 pass | PASS locally |
| OC-03 | Boundary suite unchanged: `opencode-driver.test.mjs:150` (built-in tool bypass), `:157`/`:164` (permission), `:178` (unknown event envelope), `:183` (provider failure), `:189` (SDK abort before server close), `:228` (redaction and session identity). Upstream review recorded in `docs/qualification/opencode-driver-1.18.33.md` | PASS locally |
| OC-04 | `pnpm test:qualification` 254 of 254; `pnpm gate:quick` and `pnpm gate:full` pass with 0 skipped and 0 todo | PASS locally; pending externally |

## Discrimination sensor

The exact-pin assertions reject a stale package identity: before this change,
CI on PR #400 failed at `dependency-policy.test.mjs` with actual `1.18.23`,
expected `1.18.18`. The pinned-provider probe equally fails when the installed
version differs from `pinnedVersion`.

## Local caveat

A bare `node --test` (without pnpm prepending `node_modules/.bin` to `PATH`)
probes a machine-global `opencode`, the known `defaultCommand()` PATH fallback
recorded in `.specs/features/platform-qualification-matrix/handoff.md`. It is
unchanged by this dependency refresh. The Claude Code and Codex live probes
likewise need their CI-installed pins under `VES_REQUIRE_PINNED_PROVIDERS=1`.

## External verification

Quality, Site, CodeQL, and the required review rule must pass on the exact pushed
head before merge. No production-readiness claim is made.
