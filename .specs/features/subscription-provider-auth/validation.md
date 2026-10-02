# Subscription Provider Authentication Validation (ADP-A)

## Verdict

**Result:** implementation evidence complete; pending independent
verification, human review, and the owner's first supervised run. Nothing was
observed against a real provider.

**Specification:** `.specs/features/subscription-provider-auth/spec.md`

**Commit range:** `a6df70a2347d34d0ddec00b99bb5bccef73284dc..b4e7a8b` (code, tests, and
user documentation), followed by the commit that carries this file. The branch
was rebased onto `origin/main` `a6df70a` before review; the gates below ran
after the rebase.

Deterministic fakes are labeled in their files: the fake `claude`
(`spikes/claude-code-driver/test/fake-claude-mediated.mjs`,
`tests/helpers/task-cli-fakes/fake-claude-task.mjs`) and the fake `codex`
(`tests/helpers/task-cli-fakes/fake-codex-task.mjs`). The Claude Code token and
the Codex login in every test are fixtures.

## TA1 evidence

Recorded in `spec.md` under "Evidence (TA1)" with each source. The probes were
read-only: `claude --version`, `claude --help`, `claude setup-token --help`,
`claude auth --help` and its subcommands' `--help`, a read-only inspection of
the text embedded in the installed Claude Code executable, `codex --version`,
`codex --help`, `codex login --help`, `codex login status --help`, and
`codex login status` in a disposable `CODEX_HOME` with a disposable `HOME`
(empty; with the pinned `config.toml`; with a synthetic API-key `auth.json`).
No prompt was sent to a model, no login or token command was run, and no owner
configuration, login, or keychain entry was read.

## Requirement evidence

`S` is `spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`,
`C` is `tests/contract/claude-code-driver-subscription.test.mjs`, `I` is
`tests/integration/codex-identity.test.mjs`, `E` is
`tests/e2e/task-cli-e2e.test.mjs`, `X` is
`tests/security/task-cli-security.test.mjs`, `U` is
`tests/unit/task-provider-auth.test.mjs`, `M` is
`tests/unit/budget-meter.test.mjs`, `R` is
`tests/integration/run-capsule-budget-evidence.test.mjs`, and `D` is
`tests/integration/doctor-secret-backend.test.mjs`.

| Requirement | Evidence |
| --- | --- |
| SPA-01 | `C:48` (exact invocation), `C:86` (differs from `mediated-mcp` only by `--bare` against `--include-hook-events` and `--settings`; no bypass flag), `C:43` (settings value); `S:52` (the observed argv is exactly that list; no `--bare`, bypass, `--add-dir`, or plugin flag; prompt and token not in argv). The fake refuses any other argument list by itself (`spikes/claude-code-driver/test/fake-claude-mediated.mjs:97-100`). |
| SPA-02 | `S:104` (environment is exactly the declared keys; five ambient values not inherited; the echoed token is the brokered one), `S:193-215` (missing or empty token → `VES_CLAUDE_CREDENTIAL_MISSING`; an API key instead of or beside the token, a redirected config directory → `VES_CLAUDE_ENVIRONMENT_DENIED`; unredacted token → `VES_CLAUDE_CREDENTIAL_UNREDACTED`; nothing spawned), `S:185` (redaction), `C:102`, `C:35`. |
| SPA-03 | `S:104` (working directory is empty, per-run, inside the isolation directory, and not the worktree; `HOME` and config directory per-run; all three removed), `S:291` (removed after cancellation). |
| SPA-04 | `S:159-174` (`extra-tool` and `extra-server` → `VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`; `bridge-down` → `VES_CLAUDE_BRIDGE_UNAVAILABLE`; no tool request forwarded), `C:114`. |
| SPA-05 | `S:159-174` (`hook` → `VES_CLAUDE_HOOK_UNEXPECTED`). |
| SPA-06 | `S:225` (a policy file, a populated policy directory, and a directory that cannot be listed refuse before spawn; an absent path and an empty directory do not), `S:256` (relative path refused; the option refused on the bare profile). |
| SPA-07 | `tests/contract/claude-code-driver-mediated.test.mjs:18` and `:45` (T03 and `mediated-mcp` invocations, unchanged file), `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:57`, `:77` (unchanged assertions: flags, worktree working directory, exact environment), `S:176` (a hook event or a second server does not fail the bare profile), `S:218` (the bare profile refuses the subscription token). |
| SPA-08 | `S:31` (production driver and bridge against the fake), `spikes/claude-code-driver/test/fake-claude-mediated.mjs:97-103` (the fake's own argument and credential check), `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:239` (every flag of both profiles, `setup-token`, and the `--bare` sentence in the installed `--help`); report `docs/qualification/claude-code-driver-subscription.md`. |
| SPA-09 | `I:76` (directory name, `0700`, `config.toml` `0600` and exact content), `I:89` (planted configuration replaced; login untouched), `I:100` (a link refused); `spikes/codex-driver/test/codex-identity-probe.test.mjs:87` (the installed Codex loads the pinned configuration), `:104` (an API-key login there is not a login). |
| SPA-10 | `I:142` (ChatGPT accepted; isolated `HOME`; no ambient key), `I:172` (not logged in, API key, access token, wrong exit code, unknown text → `codex-login`, exact command on standard error, no path in the public error), `I:196` (a status check that hangs), `I:215` (an executable that cannot start; runs on every platform); `E:425` (`task start` refuses before any effect and prints the command; the same run starts after the login), `E:453` (API-key login refused). |
| SPA-11 | `I:277` (identity directory as `CODEX_HOME`, no `OPENAI_API_KEY`, per-session `HOME` removed, identity kept, configuration re-pinned), `I:295` (no login → fails closed), `I:306` (API-key mode unchanged), `I:317` (both or neither source refused); `E:175` (lines 258-267). `vestra` has no code that opens `auth.json`. |
| SPA-12 | `U:39`, `U:53-77`, `U:79-97`, `U:99`, `U:116`, `U:124`; `E:464` (malformed setting refused at plan time, with no task state, and at start). |
| SPA-13 | `E:357` (token missing while API keys are bound → `claude-code-oauth-token`; no status check, nothing started), `E:367` (API-key mode: `anthropic-api-key`, then `openai-api-key`), `E:425`. The default fixture binds no API key (`tests/helpers/task-cli-fixture.mjs`, `MODE_CREDENTIALS`), so every default-mode journey proves none is read. |
| SPA-14 | `E:175` (lines 245-267: not bare, token variable, identity directory), `E:387` (bare, API-key variable, per-session `CODEX_HOME`, identity directory never created), `E:492` (one provider per mode). |
| SPA-15 | `D:63` (default mode observes `claude-code-oauth-token`), `D:208`, `D:218`, `D:229`; `tests/security/os-secret-backend-security.test.mjs:333`. |
| SPA-16 | `tests/security/os-secret-backend-security.test.mjs:115`. |
| SPA-17 | `M:135`, `M:148`, `M:160`, `M:176`, `M:187`, `M:201`, `M:216`; the priced path's existing cases are unchanged (`M:75`). |
| SPA-18 | `R:63`, `R:73`, `R:79-99`; `E:175` (lines 267-272 status; 297-301 capsule), `E:387` (API-key run keeps a number and no billing member), `E:492`. |
| SPA-19 | `E:175`, `E:357`, `E:367`, `E:387`, `E:425`, `E:453`, `E:464`, `E:492`; the remaining journeys (`E:305` onward) now run in the default mode. |
| SPA-20 | `X:168-239` (token absent from child argv, every command's output, every file under the fixture except the fake keychain store, including sealed evidence decoded from base64, and every commit message; for a completed and a failed run), `X:241`, `X:275`, `X:292`; `S:104`. |
| SPA-21 | `docs/quick-start.md` (step 3, "Use API keys instead", Limits), `README.md` ("Bind a provider credential"), `.specs/features/live-task-pilot/spec.md` (amendment note, §3, §6, §7, §8, §9, §10) and `handoff.md` (Blockers 1–3 and 7). |

## Gate results

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

## Discrimination sensor

Each mutation was applied to the working copy, the named tests were run, and
the file was restored. 41 mutations, 41 killed, 0 survived; the whole set was
run again on the rebased tree with the same result.

| Mutation | Killing test |
| --- | --- |
| Hook events not refused | `S` (hook state) |
| A second MCP server accepted | `S` (extra-server state) |
| Subscription profile passes `--bare` | `S`, `C` (the fake refuses the arguments) |
| Child runs in a directory that is not the empty per-run one | `S:104` |
| Managed policy not refused | `S:225` |
| An unreadable policy location treated as absent | `S:225` |
| Any credential variable accepted | `S:193-215`, mediated suite |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS` dropped | `S:104` |
| `--settings` dropped | `S`, `C` |
| Token not required to be a sensitive value | `S:193-215` |
| Any exit-0 Codex status accepted | `I:172` |
| Forced ChatGPT method dropped from `config.toml` | `I:76` |
| `config.toml` not rewritten | `I` (9 cases) |
| A link accepted as the identity directory | `I:100` |
| Status check inherits the ambient environment | `I:142` |
| A subscription session also gets an API key | `I:277`, `I:295` |
| No command printed for the owner | `I:172` |
| Identity directory removed with the session | `I:277` |
| Unbilled model priced | `M` (5 cases) |
| Unbilled usage escapes the token ceiling | `M` (4 cases) |
| A billed unknown model runs for free | `M:75`, `M:160` |
| Ledger always carries `unbilledTokens` | `M:187` |
| Resumed unbilled tokens not bounded | `M:201` |
| A subscription run with no usage reports a zero cost | `M` (5 cases) |
| Capsule accepts a cost on subscription billing | `R:79-99` |
| Capsule accepts unbilled tokens without billing | `R:79-99` |
| Default mode is `api-key` | `U`, `D` (11 cases) |
| A malformed setting falls back to the default | `U:79-97` |
| An unknown member is ignored | `U:79-97` |
| The doctor ignores the mode | `D`, `os-secret-backend-security` (8 cases) |
| A linked setting is followed | `U:99` |
| A run always reads both API keys | `E:175`, `E:357` |
| The implementer always uses the bare profile | `E:175` |
| Subscription usage is priced | `E:175`, `E:492` |
| Status shows dollars for a subscription | `E:175` |
| The capsule carries a cost for a subscription | `E:175` |
| The Codex login is not proven before start | `E:425`, `E:453` |
| The verifier inherits the invoking environment | `X:241` |
| The status check uses the ambient `CODEX_HOME` | `X:292` |
| `task plan` does not check the provider setting | `E:464` |
| The token is written to the run outcome | `X:168-239` |

## Replaced test cases

| Old case | Replacement |
| --- | --- |
| `tests/e2e/task-cli-e2e.test.mjs`: the success journey asserted the API-key environment of both children | `E:387` asserts the same environment in API-key mode; `E:175` asserts the subscription environment in the default mode |
| `tests/e2e/task-cli-e2e.test.mjs`: "a missing credential" expected `anthropic-api-key` | `E:367` (API-key mode, same expectation, plus `openai-api-key`); `E:357` expects `claude-code-oauth-token` in the default mode |
| `tests/security/os-secret-backend-security.test.mjs`: `DOCTOR_CREDENTIAL_NAME === "anthropic-api-key"` | the same test (`:333`) asserts the default mode's `claude-code-oauth-token`; `D:208` asserts `anthropic-api-key` in API-key mode |
| `tests/integration/doctor-secret-backend.test.mjs`: every case bound `anthropic-api-key` | the same cases bind the default mode's credential; `D:208`, `D:218`, `D:229` cover API-key mode, the opposite credential, and an unreadable setting |
| `tests/security/os-credential-cross-platform-security.test.mjs`: imported `DOCTOR_CREDENTIAL_NAME` | the presence closure is asked about the credential the fixture stored (same assertions); which name the doctor asks for is covered in `D` |

No assertion was deleted without a replacement, and none was weakened. The
mediated fixture moved from `claude-driver-mediated.test.mjs` to
`tests/helpers/claude-mediated-fixture.mjs` so both suites share one
implementation; the mediated cases and assertions are unchanged.

## Guardrails

- **Complexity.** This branch does not change `complexity-baseline.json`
  (178 keys at `origin/main` `a6df70a`).
  `packages/drivers/src/claude-code-driver.ts :: Async method 'start'` stays
  24, its `Arrow function` stays 28, and
  `packages/application/src/execution/budget-meter.ts :: Function
  'createBudgetMeter'` stays 23. Every new function is at or below 10.
- **Census.** No file gained or lost `JSON.stringify` or `createHash` in a
  way the census counts; `pnpm test:census` passes with no refresh.
- **Citations.** `file:line` citations of every reshaped file were moved with
  the code in `.specs/features/claude-code-2-1-282/`, `governed-task-cli/`,
  `live-task-pilot/`, `platform-qualification-matrix/`, `dsse-attestation/`,
  `os-secret-backend/`, `os-secret-backend-cross-platform/`,
  `candidate-cross-platform-gates/`, and `.specs/STATE.md`. Some citations
  were already stale before this change and were not otherwise corrected:
  five in `governed-task-cli/validation.md` point past the end of their file
  (`task-cli-e2e.test.mjs:449` and `:441`, `task-cli-security.test.mjs:122`,
  `:126`, and `:131`), and the `run-capsule.ts` citations of the DSSE decision
  and its migration note point at lines other than the ones they describe.
  The second group was moved by this change's offset; the first was left as
  it was.
- **Digest-bound qualification reports.** The three credential-store reports
  and their digests in
  `packages/platform-node/src/os-secret-backends/credential-store.ts` are
  untouched.
- **Counts.** 12 migrations and 19 runtime public errors, unchanged. No public
  error definition was added: the new driver codes travel as the `reason` safe
  detail of `VES_TASK_FAILED`, and the new requirements `provider-auth`,
  `codex-login`, `codex-identity`, and `claude-code-oauth-token` as the
  `requirement` safe detail of `VES_TASK_NOT_CONFIGURED`.
- **Dependencies.** None added.

## Gaps and follow-up

- G1–G3 of `spec.md` are open owner decisions (managed policy, the Keychain
  lookup, startup requests).
- Nothing was observed live. The table "What needs the owner's real token" in
  `docs/qualification/claude-code-driver-subscription.md` lists each
  assumption and what the driver does if it is wrong.
- The child-process journeys use the documented machine-wide policy locations;
  on a machine that carries a managed Claude Code policy they report
  `VES_CLAUDE_MANAGED_POLICY_PRESENT` instead of passing.
- The journeys and the task security suite run their cases only on macOS, as
  before; on other hosts those cases return without asserting, which is the
  existing behaviour of those files. See "Windows behaviour" below.
- The task ledger shown by `task status` holds the implementer's usage; the
  verifier's usage spends from the same ceilings and is not added to that
  ledger. This is unchanged from the API-key path.
- PR CI runs on Ubuntu only. The task path and the drivers changed, so the
  platform matrix must prove this branch before merge
  (`.specs/features/architecture-deepening/spec.md`, Constraints).

## Windows behaviour

The platform matrix (run 37003050689, build gate, Windows x64) failed one case:
`I`, "a ChatGPT login is accepted and its check never sees the invoking home or
an ambient key", with `VES_TASK_NOT_CONFIGURED` (`codex-login`). The other four
targets and the whole security gate passed.

**Cause.** The fake `codex` died before it answered. Its fixture channel
(`tests/helpers/task-cli-fakes/fixture-channel.mjs`) writes an observation only
inside the child's own temp directory, and on Windows that directory is not the
one the test names: `os.tmpdir()` reads `TEMP`, never `TMPDIR`, and the child's
`TEMP` is the runner's, not the fixture's. The path comparison then fails (the
fixture resolves its root with the native `realpath`, the fake with the
JavaScript one, and the two differ where the runner's temp path has an 8.3
short name), the fake exits non-zero, and that reads as not logged in. This
could not be run on Windows locally; aiming `TMPDIR` at another directory on
macOS reproduces the same failure. The five "is not configured" cases and the
hang case passed on Windows for that wrong reason.

**Fix.** Tests only; no product code changed. On POSIX every case that starts
the fake now also asserts the fake's own observation (the login it reported,
the identity directory it read, the pinned configuration), so a fake that could
not run fails the case instead of passing as "not logged in": with the fake
made to die before answering, 7 cases fail where 6 used to pass. On Windows
those cases assert what is true there, following
`tests/helpers/mediation-platform.mjs`: `task start`, `task resume`, and `task
status` are refused with `VES_TASK_NOT_CONFIGURED` (requirement `platform`), so
no Codex check is reachable. Nothing is skipped.

| Case in `I` | On Windows |
| --- | --- |
| `:76` identity directory pinned | Runs: directory name, exact `config.toml`, directory listing (mode bits are asserted on POSIX only) |
| `:89` planted configuration replaced | Runs unchanged |
| `:100` a link refused | Runs; an account that cannot create a link asserts `EPERM` |
| `:142` ChatGPT login accepted | Asserts the task-path refusal |
| `:172` five statuses that are not a login | Each asserts the task-path refusal |
| `:196` a status check that hangs | Asserts the task-path refusal |
| `:215` an executable that cannot start | Runs unchanged: no process starts; `codex-login`, the exact command, and the pinned configuration are asserted |
| `:235` the one-time command is quoted | Runs unchanged |
| `:277`, `:295`, `:306`, `:317` verifier sessions | Each asserts the task-path refusal (as before) |

With the platform constant forced to the Windows branch on macOS the file
passes 16 of 16, 11 of them through the refusal.

**The other suites on Windows.**

| Suite | How it passed |
| --- | --- |
| `tests/integration/doctor-secret-backend.test.mjs` | By asserting. Its credential stores are in-process fakes; no process starts and no environment is passed through. The three mode cases use the host's own platform with the Windows store fake. |
| `spikes/codex-driver/test/codex-identity-probe.test.mjs` | By asserting, against the installed Codex with an explicit environment that carries `TEMP`, `TMP`, and `SystemRoot`; it does not use the fixture channel. The forced-method half of its second case is conditioned on the build (0.157.1 or later) on every platform, so on the fleet's pinned 0.115.0 that case asserts only that the answer is not a ChatGPT login. |
| `spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`, `tests/contract/claude-code-driver-subscription.test.mjs` | By refusal: each case asserts `VES_CLAUDE_MEDIATION_UNSUPPORTED` and the bridge refusal through `mediationRefusedOnWin32`. |
| `tests/unit/task-provider-auth.test.mjs` | By asserting; in-process. |
| `tests/e2e/task-cli-e2e.test.mjs` | One case asserts the `platform` refusal. The other 17, including the 6 this feature added, return at `if (!DARWIN) return;` without asserting. That is the file's existing pattern, not the convention above. |
| `tests/security/task-cli-security.test.mjs` | All 9 cases, including the 5 this feature added, return without asserting, by the same existing pattern. |

**Not changed.** The production status check passes only the locale and search
variables plus `HOME`, `USERPROFILE`, and `CODEX_HOME`. On Windows the real
`codex login status` would not need more (the process launcher fills `TEMP`,
`SYSTEMROOT`, and the other required variables from the parent), but it would
also inherit `HOMEDRIVE`, `HOMEPATH`, and `USERNAME` from the invoking user,
which `CodexProcessContext` blanks for the driver, and the executable lookup
does not resolve an npm `.cmd` shim. Both would have to be settled before the
task path could be qualified on Windows. They are left alone because the path
is refused there.

## Human review

Ready for independent verification. Only a human decides merge, and the owner
decides G1–G3.
