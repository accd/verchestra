# OpenCode runtime 1.19.4 validation

**Date:** 2026-10-24
**Diff:** the #581 branch taken over on `main` (`58ad85e`), packages moved to `1.19.4`
**Verifier:** primary agent local verification on Windows x64 (an account
without the symlink privilege), Node 24.14.0; GitHub required checks remain
authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| OC-01 | `tests/agent-readiness/dependency-policy.test.mjs:30`, `:31` (manifest) and `:38` (lockfile) assert exactly `1.19.4`; the lockfile diff is 116 lines and changes only `opencode-ai`, `@opencode-ai/sdk`, and their twelve platform binaries; `pnpm install --frozen-lockfile` passes | PASS |
| OC-02 | `spikes/opencode-driver/test/opencode-driver.test.mjs:79` keeps the `1.17.18` floor; `:82` pins the live probe to `1.19.4`; `:93`-`:107` discriminate drift from the pin with a newer `1.20.0` and an unsupported `1.16.0`. `VES_REQUIRE_PINNED_PROVIDERS=1 corepack pnpm qualify:opencode`: 23 of 23 pass, 0 skipped, 0 todo; the probe reports the repo-local `1.19.4` | PASS locally |
| OC-03 | Boundary suite unchanged in the same run (built-in tool bypass, permission, unknown event envelope, provider failure, SDK abort before server close, redaction and session identity, cancel order). The published `@opencode-ai/sdk` differs from `1.18.33` only in `package.json` and `dist/v2/gen/types.gen.d.ts`; every runtime file is byte-identical. Upstream review recorded in `docs/qualification/opencode-driver-1.19.4.md` | PASS locally |
| OC-04 | See "Gates" below | PASS locally for every stage this change can affect; pending externally |

## Gates

- `test:qualification` with `VES_REQUIRE_PINNED_PROVIDERS=1`: 357 of 358, 0
  skipped. The one failure is `probes the installed Claude Code without
  invoking a model`: the exact-pin gate requires the CI-installed Claude Code,
  and this host has another version. The OpenCode suite inside it passes.
- Every `gate:quick` stage passes: `format:check`, `lint`, `complexity:check`,
  `typecheck`, `test:unit` (3015 of 3015), `test:agent-readiness` (357 of 357)
  and `test:census` (13 of 13); `agent:check` passes.
- `gate:full` adds `test:contract`, 968 of 968.
  `test:integration` passes 1244 of 1267: 22 failures are `EPERM` creating a
  symlink on this host (`tests/helpers/mcp-bridge-fixture.mjs:33`, 17 in
  `driver-execution-adapter.test.mjs`; `git-context-source.test.mjs`, 5), and
  one is the Windows named-pipe case `a frame relayed in whole 128 KiB blocks
  reaches the controller and is refused for its size`, which passed 3 of 3
  when run alone. None of these files is touched by this change.
- The stages after it, run on their own: `test:e2e` 310 of 311 (the one failure
  is the same symlink `EPERM`, `task-cli-e2e.test.mjs:888`), `test:fault` 310 of
  310, `test:mutation` 8 of 8; 0 skipped in each.

## Discrimination sensor

The exact-pin assertions reject a stale package identity: CI on PR #581 failed
at `dependency-policy.test.mjs:30` with actual `1.19.3`, expected `1.18.33`
(run 40089817497), as #549 had with `1.18.35`. The pinned-provider probe
equally fails when the installed version differs from `pinnedVersion`.

## Local caveat

A bare `node --test` (without pnpm prepending `node_modules/.bin` to `PATH`)
probes a machine-global `opencode`, the known `defaultCommand()` PATH fallback
recorded in `.specs/features/platform-qualification-matrix/handoff.md`. It is
unchanged by this dependency refresh. The Claude Code and Codex live probes
likewise need their CI-installed pins under `VES_REQUIRE_PINNED_PROVIDERS=1`.

## External verification

Quality, Site, CodeQL, and the required review rule must pass on the exact pushed
head before merge. No production-readiness claim is made.
