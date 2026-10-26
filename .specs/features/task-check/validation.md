# Task check validation (#593)

## Verdict

**Result:** FAIL

**Validator:** an independent validator sub-agent, not the author of the
feature. **Date:** 2026-10-26.

**Specification:** `.specs/features/task-check/spec.md` (TCK-01 to TCK-07)

**Commit validated:** `db966bfc048ab479d414f7b2adcfb3b228e81d0b` (HEAD of
`feat/593-task-check`); range
`4a33c0c8fa22b5f8d2baf831cf614919a96dee26..db966bfc048ab479d414f7b2adcfb3b228e81d0b`
(three commits).

**Host:** Windows x64, Node 24.14.0. The e2e journeys and the probes below ran
on Windows only; the Linux Secret Service and macOS branches were judged by
reading the code.

The core of the feature works: every check runs, a missing one is recorded
and the next one still runs, `not-checked` always names what it waits for, the
exit is 4 exactly when not ready, and no credential value is read. The overall
verdict is FAIL because of the following, all detailed under Findings:

- F1: one reachable path breaks the TCK-04 order.
- F2: a refusal that is not a public error loses its recovery.
- F3: one probe shows a `ready: true` that `task plan` then refuses.
- F4: a linked sessions root is probed where `task start` refuses it.
- Five of thirteen mutants survived.

## Requirement evidence

| Requirement | Verdict | Implementation evidence (path:line) | Test evidence (path:line) |
| --- | --- | --- | --- |
| TCK-01 | FAIL (F1) | `apps/vestra-cli/src/task/task-check.ts:57-66` (a probe's refusal is pushed as a row, never rethrown); `:232-244` (the sequence); `:211-219` lists the no-Workspace rows with `gate-allowlist` before `provider-modes` | Not stopping: `tests/e2e/task-check-e2e.test.mjs:84-98` (four missing at once, every other check ready). Order with a Workspace: `:69-72` (`deepEqual` on the row names). Order without a Workspace: no proof, since `:110-111` look rows up by name (mutant M6b survived) |
| TCK-02 | FAIL (F2) | `task-check.ts:33-43` (statuses); `:48-52` (`missing` copies `code`, `safeDetails`, `recovery` from a public refusal, and only `stableCode` from anything else); `:68-70` (`skip` always sets `dependsOn`, and every call site passes a non-empty name); `task-credentials.ts:83-91` (same `notConfigured(logicalName)` as `readCredentials`) | `task-check-e2e.test.mjs:90-96` (code, `details.requirement`, non-empty recovery for four missing checks); `:111` (`deepEqual` `{check, status: "not-checked", dependsOn: "workspace"}`); `:112`, `:125-126`, `:164` (`dependsOn` values). No test covers a missing `provider-modes` (mutant M10 survived) or a non-public refusal |
| TCK-03 | PASS | `task-check.ts:245` (`ready` = every row `ready`); `:248` (one stderr line per check that is not ready); `:221-230` (line formats); `:249` (`exitCode: ready ? 0 : 4`); `task-command.ts:39-43`, `:51` (missing `--request` is `VES_CLI_ARGUMENT_INVALID`) | `task-check-e2e.test.mjs:67-68`, `:82-83`, `:107`, `:122`, `:159` (exit and `ready`); `:74` (no line when ready); `:99-100` (missing lines); `:115` (not-checked line). Exit 2 has no test in this suite; a probe observed exit 2 with `VES_CLI_ARGUMENT_INVALID` |
| TCK-04 | FAIL (F1, the same defect as TCK-01) | `task-check.ts:126-132` (implementer credential, the OpenAI key on an API-key verifier, then the signing passphrase); `:150-170` (gate allowlist, API-key models, billing for v2 only); `:172-187` (`executable:claude` when Claude Code runs, `executable:codex`, `codex-login` unless the verifier is on an API key); `:189-207` (`windows` on win32 when Claude Code runs); `:211-219` (order defect) | `task-check-e2e.test.mjs:36-48`, `:69-72` (subscription order incl. `windows` on win32); `:134-146` (API-key rows, no `codex-login`); `:163` (`billing` in a v2 request); `release-manifest.ts:150-159` is pinned by `tests/contract/cli-surface.test.mjs:96`, `:171-174`, `:216`, `tests/build/sealed-launcher-closure.test.mjs:86`, `tests/e2e/cli-launchers-e2e.test.mjs:45` |
| TCK-05 | FAIL (F4); the core claims hold, but parts are unproven | Presence only: `task-credentials.ts:86` calls `adapter.has`, which is `cmdkey /list` on Windows, a D-Bus item search on Linux, and `find-generic-password` without `-g` on macOS (`packages/platform-node/src/os-secret-backends/windows-credential-manager.ts:300-310`, `linux-secret-service.ts:154-161`, `darwin-keychain.ts:160-170`). No session: `task-check.ts:73-75`, `:81-85`, `:95-99` (`probe()` runs `--version` only). Temporary home: `:117-122`. Workspace not ensured: `:234` (`ensure: false`). Sessions probe: `task-windows.ts:95-101` | No value read: `task-check-e2e.test.mjs:53`, `:76` (no `Read` or `lookup` in the fake store log; skipped on macOS). Repository unchanged: `:65`, `:75` (ready journey only, ignored files not compared). Not proven: the provider children, Workspace state, and the identity directory (mutants M8 and M9 survived) |
| TCK-06 | PASS (code); the Claude Code half is unproven | `task-check.ts:79-91` (`ClaudeCodeDriver.probe()` at `CLAUDE_MEDIATED_MINIMUM_VERSION`); `:93-106` (`CodexDriver.probe()` at the driver default for v1, `CODEX_STRUCTURED_MINIMUM_VERSION` for v2), matching `task-codex.ts:313-319` and `packages/drivers/src/codex-driver.ts:692` | Codex: `task-check-e2e.test.mjs:152-154` (0.159.2 ready for v1); `:156-162` (missing, `codex-version`, for v2). Claude Code: no proof, because the fake always reports 2.1.282 (mutant M7 survived) |
| TCK-07 | PASS (by inspection) | `README.md:270` (task section); `README.md:359` (exit row 4 names `task check`); `docs/quick-start.md:321-332` (step 6); `CHANGELOG.md:11-13` | None asserts the mention. `tests/agent-readiness/beta-tester-docs.test.mjs:178-184` checks only that the exit table keeps its nine rows |

## Gate results

| Command | Exit | Test count | Result |
| --- | --- | --- | --- |
| `node --test tests/e2e/task-check-e2e.test.mjs` (HEAD, before the sensor) | 0 | 6 tests: 6 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | PASS |
| `node --test tests/e2e/task-check-e2e.test.mjs` (HEAD, after the sensor, restored tree) | 0 | 6 tests: 6 pass, 0 fail, 0 skipped | PASS |
| `node --test tests/contract/cli-surface.test.mjs tests/e2e/cli-launchers-e2e.test.mjs tests/agent-readiness/beta-tester-docs.test.mjs` | 0 | 83 tests: 83 pass, 0 fail, 0 skipped | PASS |
| `node --test tests/build/sealed-launcher-closure.test.mjs` | 0 | 14 tests: 14 pass, 0 fail, 0 skipped | PASS |

`pnpm gate:quick` was not re-run by the validator; the handoff records the
author's run.

## Discrimination sensor

Each mutant was applied to the working tree. Then the whole
`tests/e2e/task-check-e2e.test.mjs` suite ran. The file was restored with
`git checkout --`, and `git status --short` was confirmed empty before the
next mutant. The author's two mutants (the v2 Codex minimum, a value read in
place of presence) were not repeated.

| Mutation (in `apps/vestra-cli/src/task/task-check.ts`) | Test that should catch it | Result |
| --- | --- | --- |
| M1: stop at the first missing check (later probes are not run or reported) | `task-check-e2e.test.mjs:79` (every missing prerequisite at once) | killed (3 of 6 failed) |
| M2: drop `dependsOn` from every not-checked row | `:103` (no Workspace), `:118` (rejected request) | killed (3 of 6 failed) |
| M3: exit 0 when not ready | `:82`, `:107`, `:122`, `:159` | killed (4 of 6 failed) |
| M4: never run or report `codex-login` | `:69-72`, `:88` | killed (2 of 6 failed) |
| M5: credentials before the request settings (order) | `:69-72` | killed (1 of 6 failed) |
| M6: drop `provider-modes` from the no-Workspace rows | `:110-111` | killed (1 of 6 failed) |
| M6b: reorder the no-Workspace rows (`gate-allowlist` after `api-key-models`) | an order assertion on the no-Workspace journey (none exists) | **survived** |
| M7: drop the mediated Claude Code minimum (the probe falls back to 2.1.168) | a Claude Code below 2.1.282 (none exists) | **survived** |
| M8: `openTaskWorkspace(io, { ensure: true })`, which creates the Workspace state layout | an assertion on the state root (none exists) | **survived** |
| M9: judge the login with `task start`'s `requireCodexSubscription`, which rewrites `config.toml` in the Workspace identity directory | an assertion on Workspace state or the identity directory (none exists) | **survived** |
| M10: drop the not-checked `credential:providers` row when the provider modes are missing | a journey with a malformed `task-providers.json` (none exists) | **survived** |
| M11: no stderr line for a not-checked row | `:115` | killed (1 of 6 failed) |
| M12: a missing row loses its recovery | `:95` | killed (1 of 6 failed) |

Eight of thirteen killed; five survived (M6b, M7, M8, M9, M10).

## Findings

The probes below ran outside the repository and drove the real `vestra`
binary through the repository's own fixture
(`tests/helpers/task-cli-fixture.mjs`). They left no repository file changed.

- **F1 (TCK-01, TCK-04; low): the no-Workspace path breaks the listed order.**
  `task-check.ts:211-219` emits `gate-allowlist` before `provider-modes`. The
  probe observed this order: `workspace`, `request`, `gate-allowlist`,
  `provider-modes`, `api-key-models`, `credential:evidence-signing-passphrase`,
  `executable:claude`, `executable:codex`, `codex-login`, `windows`. TCK-04
  puts `provider-modes` before `gate-allowlist`. Failure scenario: a tester
  runs `task check` in a clone whose `.verchestra/workspace.yaml` was removed.
  A consumer that relies on the documented order reads the rows out of order.
  No test pins this order (M6b survived). Fix: swap the two names and assert
  the full order in the no-Workspace journey.
- **F2 (TCK-02; medium): a refusal that is not a public error loses its
  recovery and may change its code.** `task-check.ts:49` keeps only
  `stableCode(error)`. `task plan` and `task start` map the same error through
  `task-command.ts:27-37`: a registered platform, runtime, or init code becomes
  that public error with its recovery, and anything else becomes
  `VES_TASK_FAILED` with the code as `reason`. Failure scenario (observed):
  `<state>/tasks` is a junction to a directory outside the state root. The
  check row is `{check: "workspace", status: "missing", code:
  "VES_STATE_ROOT_ESCAPE"}` and the stderr line is
  `missing workspace: VES_STATE_ROOT_ESCAPE`, with no recovery. `task plan
  --dry-run` refuses `VES_STATE_ROOT_ESCAPE` with the recovery "Remove the link
  crossing the isolated Workspace state root.". This contradicts TCK-02 and the
  quick-start sentence "A missing check prints the code and recovery that
  `task plan` or `task start` would give for it". Fix: map the error with the
  same `publicError` function before recording it.
- **F3 (scope gap against the feature's purpose; medium): `ready: true` does not
  mean `task plan` accepts the request.** The `request` check is
  `readRequest` alone. `task plan` also proves the source revision
  (`task-plan.ts:72-87`) and validates the Workspace task authority policy
  (`task-plan.ts:316`, `.verchestra/policy/task-authority.json`). Failure
  scenario (observed): a request whose `sourceRevision` names no commit of the
  repository. `task check` exits 0 with `ready: true` and `request` ready, and
  `task plan --dry-run` then refuses `VES_TASK_REQUEST_REJECTED` (reason
  `VES_TASK_SOURCE_REVISION_UNKNOWN`). The spec's Out of scope table does not
  exclude either check.
- **F4 (TCK-05, "as `task start` does"; medium): the Workspace check skips the
  state containment proof, and the Windows probe follows a linked sessions
  root.** `ensure: false` (`task-check.ts:234`) skips the `realpath`
  containment checks of `ensureWorkspaceState`
  (`packages/platform-node/src/state-root.ts:104-138`). `task start` and a
  non-dry-run `task plan` apply those checks. Failure scenario (observed on
  Windows): `<state>/sessions` is a junction to a directory outside the state
  root. `task check` exits 0 with `workspace` and `windows` ready. It created
  and removed its `acl-probe-*` directory in the link target, so the ACL it
  judged is not the Workspace's own. `task plan` then refuses
  `VES_STATE_ROOT_ESCAPE`. If the link pointed into the repository, the probe
  would write and remove a directory there. Fix: prove containment read-only,
  without creating anything, before the Windows probe, or check the sessions
  root with `requireContained`.
- **F5 (TCK-05 proof; medium): the "no Workspace state" and "only `--version`
  and `codex login status`" clauses have no test.** The probe observed the
  right behavior on Windows:
  - only `sessions/` was added to the state root;
  - the identity directory was unchanged;
  - the provider witness logs held only `claude --version`, `codex --version`,
    and `codex login status`;
  - the store log held only `cmdkey` presence queries.

  But M8 and M9 survived. The repository check (`task-check-e2e.test.mjs:65`,
  `:75`) runs in the ready journey only and does not compare ignored files.
  The value-read check is skipped on macOS (`:53`).
- **F6 (TCK-06 proof; low): the Claude Code minimum is unproven.** The fake
  Claude Code always reports 2.1.282 (`tests/helpers/task-cli-fakes/fake-claude-task.mjs:16`),
  so a probe at the driver default 2.1.168 passes every journey (M7 survived).
  A fixture flag for an older Claude Code would discriminate it.
- **F7 (TCK-02 proof; low): a missing `provider-modes` is untested.** The probe
  observed correct rows for a malformed `task-providers.json`:
  `provider-modes` missing (requirement `provider-auth`), and `api-key-models`,
  `credential:providers`, `codex-login`, and `windows` not-checked, each
  waiting for `provider-modes`. No journey covers this path (M10 survived).
- **F8 (TCK-04 consistency; low): rows disagree when nothing names the
  provider credentials.** A missing `provider-modes` yields a not-checked
  `credential:providers`. A missing Workspace yields no provider credential
  row at all (`task-check.ts:211-219`). So a tester without a Workspace is not
  told that provider credentials remain to be checked.
- **F9 (TCK-02; low): `claude-version` is a requirement only `task check`
  uses.** `task-check.ts:88` names `claude-version`. No prerequisite refusal of
  `task plan` or `task start` uses it: in `apps/vestra-cli/src` it appears only
  there. The quick-start requirement table lists `codex-version` but not
  `claude-version`. A tester who gets it has no documented recovery beyond the
  generic `VES_TASK_NOT_CONFIGURED` text.
- **F10 (low, usability): the login refusal omits the login command.** A
  missing `codex-login` does not print the one-time `codex login` command that
  `task start` prints for the same piece (`task-codex-identity.ts:231-233`).
  The data carries the same code and recovery, so TCK-02 holds, but the
  terminal is less helpful than the refusal it previews.
- **F11 (low): a rejected request judges Codex at the v1 floor.** With the
  request missing, `executable:codex` uses the v1 default
  (`task-check.ts:97`). A v2 request rejected for another reason can therefore
  show `executable:codex` ready, and its `codex-version` gap appears only after
  the request is fixed.

`mutating: false` (`release-manifest.ts:154`) is honest under the manifest's
convention: `self-test`, `doctor`, and `task status` are also declared
non-mutating. `task check` changes no repository file, no run record, and no
setting. Its only lasting effect is the empty Windows sessions directory,
which `task start` would create anyway; F4 is the exception.

## Gaps and follow-up

- Fix F1 and F2, and assert the full order and the recovery of a non-public
  refusal.
- Decide whether F3 and F4 belong to `task check`. If not, record them in the
  spec's Out of scope table and in the quick-start text.
- Add journeys or assertions for M6b, M7, M8, M9, and M10:
  - the full no-Workspace order;
  - an older fake Claude Code;
  - a state-root listing before and after the check;
  - the identity directory unchanged;
  - a malformed `task-providers.json`.
- Linux and macOS were not exercised by this validation.

## Human review

Not ready for merge on this evidence: the result is FAIL. Only a human decides
merge, release, or deployment.
