# Architecture deepening: validation of ADP-A (tasks TA1 and TA2)

Branch `feat/subscription-provider-auth`, base
`a6df70a2347d34d0ddec00b99bb5bccef73284dc`. The feature's own specification,
design, threat model, and full requirement matrix are in
`.specs/features/subscription-provider-auth/`. This file maps ADP-A to that
evidence and records the programme's guardrails.

Nothing here was observed against a real provider. The Claude Code token and
the Codex login in every test are fixtures, and the provider executables are
labeled deterministic fakes.

## TA1 — evidence

`.specs/features/subscription-provider-auth/spec.md`, "Evidence (TA1)": E1 (how
a subscription credential reaches Claude Code), E2 (each `--bare` effect and
its equivalent or gap), E3 (ambient session), E4 (Codex), and the gaps G1–G3.
Sources are `claude --help` 2.1.282, the Claude Code documentation pages named
there, a read-only inspection of the installed executable's embedded text,
`codex login --help` 0.157.1, `codex login status` in a disposable
`CODEX_HOME`, and the Codex authentication documentation. No model was called,
no login or token command was run, and no owner configuration or keychain
entry was read.

## TA2 — ADP-A, clause by clause

`S` is `spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`,
`I` is `tests/integration/codex-identity.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`, `X` is
`tests/security/task-cli-security.test.mjs`, and `U` is
`tests/unit/task-provider-auth.test.mjs`.

| Clause of ADP-A | Evidence |
| --- | --- |
| A Workspace selects subscription authentication for a provider | `U:39` (default), `U:53-77` (per provider), `U:79-97` (anything unrecognized is not configured), `U:116` (never from a Task Request); `E:464` (refused at plan time and at start) |
| A task runs with that provider's subscription credential | `E:175` (lines 245-272: Claude Code not bare with `CLAUDE_CODE_OAUTH_TOKEN`; Codex from the identity directory; run reaches `COMPLETED`), `S:31`, `I:277` |
| The credential is supplied explicitly | `S:104` (exactly the declared environment; the echoed token is the brokered one), `S:193-215` (refusals before spawn), `I:142` (login proven in the identity directory), `tests/contract/claude-code-driver-subscription.test.mjs:48` (exact invocation) |
| No ambient session is read | `S:104` (five ambient values not inherited; per-run `HOME` and config directory), `X:241` (no ambient value reaches Claude Code, the Codex status check, or the Codex session), `X:275` (an ambient Claude Code session does not stand in for an unbound token), `X:292` (an ambient Codex login does not stand in for the identity) |
| No API key is required | the default fixture binds no API key (`tests/helpers/task-cli-fixture.mjs`, `MODE_CREDENTIALS`), and every default-mode journey in `E` passes; `E:357` (bound API keys are not used in place of a missing token) |
| When the credential is absent the task reports not configured before any effect | `E:357` (`claude-code-oauth-token`), `E:425` (`codex-login`, with the exact command), `E:453`, `E:367` (API-key mode); each asserts no transition, no grant, no provider child, and no worktree |
| The mediated profile's isolation is not weakened | `tests/contract/claude-code-driver-mediated.test.mjs:18`, `:45` (T03 and `mediated-mcp` invocations unchanged), `S:159-174`, `S:225` (the three added fail-closed checks), `X:168-239` (the token never leaves the child's environment) |

## Gates

Run on the tree of `b4e7a8b8b68816a14c9a243f819ced04da506097` (the last revision that changes code or tests) with this branch's documentation on top, rebased on `origin/main` `a6df70a`, Node 24.14.0, macOS arm64.

| Command | Result | Counts |
| --- | --- | --- |
| `pnpm gate:quick` | PASS | test:unit 2395/2395; test:agent-readiness 323/323; test:census 13/13; failed 0, skipped 0, todo 0 |
| `pnpm gate:build` | PASS | test:unit 2395/2395; test:contract 673/673; test:integration 861/861; test:e2e 236/236; test:architecture 69/69; test:build 146/146; test:qualification 296/296; failed 0, skipped 0, todo 0 |
| `pnpm gate:security` | PASS | test:unit 2395/2395; test:contract 673/673; test:e2e 236/236; test:architecture 69/69; test:qualification 296/296; test:security 1339/1339; test:fault 310/310; failed 0, skipped 0, todo 0 |
| `pnpm qualify:claude` | PASS | 53/53 tests; failed 0, skipped 0, todo 0 |
| `VES_REQUIRE_PINNED_PROVIDERS=1 pnpm qualify:claude` | PASS | 53/53 tests; failed 0, skipped 0, todo 0 |
| `pnpm qualify:codex` | PASS | 20/20 tests; failed 0, skipped 0, todo 0 |
| `pnpm site:check` | PASS | 50/50 tests; failed 0, skipped 0, todo 0 |
| `pnpm test:architecture` | PASS | 69/69 tests (a stage of `gate:build` and `gate:security`) |
| `pnpm agent:check` | PASS | run on the revision that carries this file |

## Guardrails

- **Complexity.** `complexity-baseline.json` is unchanged. No hotspot moved or
  rose: `packages/drivers/src/claude-code-driver.ts :: Async method 'start'`
  24, `:: Arrow function` 28,
  `packages/application/src/execution/budget-meter.ts :: Function
  'createBudgetMeter'` 23. Every new function is at or below the target of 10.
- **Census.** `pnpm census:refresh` was not needed and `pnpm test:census`
  passes: no changed file gained or lost a `JSON.stringify` or `createHash`
  the census counts.
- **Citations.** `file:line` citations of every reshaped file were moved with
  the code; see "Guardrails" in
  `.specs/features/subscription-provider-auth/validation.md` for the
  documents touched and for the citations that were already stale.
- **Digest-bound reports.** The qualification reports bound in
  `packages/platform-node/src/os-secret-backends/credential-store.ts` and
  their digests are untouched.
- **Counts.** 12 migrations, 19 runtime public errors: unchanged.
- **Dependencies.** None added.
- **Tests replaced, not layered.** "Replaced test cases" in the feature's
  `validation.md` lists each old case and its replacement. No assertion was
  deleted without one.

## Discrimination sensor

41 mutations, 41 killed, 0 survived. The table is in the feature's
`validation.md`.

## Open decisions and risks

- **G1 managed policy, G2 Keychain lookup, G3 startup requests** (feature
  `spec.md`, "Gaps"): owner decisions.
- **Never run live.** What Claude Code 2.1.282 advertises and loads under the
  subscription invocation is the owner's first supervised run. If an
  assumption is wrong the driver fails closed with a named code
  (`docs/qualification/claude-code-driver-subscription.md`).
- **Windows.** The first matrix run failed one case of `I` on Windows x64
  because the fake `codex` could not run there. The cases that start the fake
  now assert its own observation on POSIX and the `platform` refusal of the
  task path on Windows; see "Windows behaviour" in the feature's
  `validation.md`, which also says how each other suite passed there.
- **Platform matrix.** The task path and the drivers changed, and PR CI runs
  on Ubuntu only, where the journeys do not run their cases. The matrix must
  prove this branch before merge.
- **Default changed.** A Workspace that used API keys must now say so in
  `task-providers.json`; without it `task start` reports
  `claude-code-oauth-token` as not configured.
- **Live pilot.** `.specs/features/live-task-pilot/` was amended before any
  run and now needs a candidate that carries this change.
