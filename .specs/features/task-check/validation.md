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

## Round 2

**Result:** FAIL

**Validator:** an independent validator sub-agent, not the author of the
feature (round 2). **Date:** 2026-10-26.

**Commit validated:** `eed64107d2b9a7c0c560ca283b26a2e74e1a7a1d` (HEAD of
`feat/593-task-check`, the fix commit); range
`4a33c0c8fa22b5f8d2baf831cf614919a96dee26..eed64107d2b9a7c0c560ca283b26a2e74e1a7a1d`
(five commits).

**Host:** Windows x64, Node 24.14.0. The e2e journeys, the probes, and the
sensor ran on Windows only; the Linux and macOS branches were judged by
reading the code.

**Verdict rule:** a requirement passes when each of its clauses has behavior
evidence and a test assertion that discriminates it (root `AGENTS.md`:
file-and-assertion evidence). A clause shown only by this validator's probe is
a proof gap. It fails the requirement, and the table marks it "proof" to set it
apart from a behavior defect.

The fix closes F1, F2, F3, F6 to F9, and F11. All five round-1 survivors are
now killed. The overall verdict is still FAIL:

- N2 (behavior): a linked Codex identity directory makes `task check` report
  `ready`, or a different code, where `task start` refuses it as
  `codex-identity`.
- Five of nine new mutants survived (R2, R5, R6, R7, R9). The identity
  containment, the status home outside the Workspace, the containment of the
  Workspaces root, the task-policy judgement, and the v1 floor for an
  unreadable request have no discriminating test.
- N1: the login command printed for a missing login fails as printed when the
  identity directory does not exist.

### Round-1 findings

| Finding | Status | Evidence (path:line) |
| --- | --- | --- |
| F1 (no-Workspace order) | RESOLVED | `apps/vestra-cli/src/task/task-check.ts:211-219` emits `provider-modes`, `gate-allowlist`, `api-key-models`, (`billing`), `credential:providers`, then the signing passphrase. `tests/e2e/task-check-e2e.test.mjs:149-167` pins the whole order with `deepEqual`, and M6b is killed |
| F2 (non-public refusal loses its recovery) | RESOLVED | `task-check.ts:54-57` maps every error through `publicError` (`apps/vestra-cli/src/task/task-public-error.ts:17-27`). `task-command.ts:13` and `:89` use the same function. Test `task-check-e2e.test.mjs:174-190` (`:186-187`, code and recovery), and R3 is killed. Probe P1: a `<ws>/tasks` junction gives the same code and recovery as `task plan --dry-run` |
| F3 (`ready: true` that `task plan` refuses) | RESOLVED | `source-revision`: `task-check.ts:192-193`, `:209`, using `sourceState` (exported, `task-plan.ts:72`). `task-policy`: `task-check.ts:194`, `:210`. `spec.md:43` names what only planning proves. Test `:204-213`, and R1 is killed. P5 and P6 agree with `task plan --dry-run`. The task-policy row has no missing journey (R7 survived, N3) |
| F4 (state containment, linked sessions root) | PARTLY | Fixed in code: `task-check.ts:85-89` calls `requireWorkspaceStateContained` (`task-workspace.ts:114-129`). `task-check.ts:128-129` calls `requireWorkspaceDirectoryContained` (`task-workspace.ts:133-135`) before `codex login status`. Probes P1 to P3 observed the refusals. `task-check-e2e.test.mjs:174-190` covers the sessions link only, so R2 (identity) and R6 (Workspaces root and Workspace root) survived. The identity proof is containment, not the real-directory proof that `task start` applies (N2) |
| F5 (no-state and children clauses untested) | PARTLY | The ready journey compares the Workspace state tree, identity directory included (`task-check-e2e.test.mjs:72-86`, `:91`, `:99`). It also compares the repository with ignored files (`:90`, `:98`). M8 and M9 are killed. Still not asserted: which children start and where the status check runs (R5 survived), and the value-read check on macOS (`:59`, `:100` skip it there) |
| F6 (Claude Code minimum unproven) | RESOLVED | `tests/helpers/task-cli-fakes/fake-claude-task.mjs:16-18` (the `claude-2.1.281` flag); test `task-check-e2e.test.mjs:247-255`; M7 is killed |
| F7 (missing `provider-modes` untested) | RESOLVED | Test `task-check-e2e.test.mjs:215-223`; M10 is killed |
| F8 (no provider credential row without a Workspace) | RESOLVED | `task-check.ts:216`; tests `task-check-e2e.test.mjs:142`, `:159` |
| F9 (`claude-version` undocumented) | RESOLVED | `docs/quick-start.md:330-334` names `executable:claude`, `executable:codex`, `claude-version`, and `codex-version`, each with its recovery |
| F10 (login hint omitted) | PARTLY | `task-check.ts:140-142` prints `codexFileLoginCommand` (`task-codex-identity.ts:150-152`); test `task-check-e2e.test.mjs:126`; R4 and R8 are killed. The printed command fails when the identity directory does not exist (N1) |
| F11 (rejected request at the v1 floor) | RESOLVED (documented) | `spec.md:30` (TCK-06 now states it); `task-check.ts:107-113`; probe P9 observed it. No test covers it (R9 survived, N3) |

### Requirement evidence at HEAD

| Requirement | Verdict | Implementation evidence (path:line) | Test evidence (path:line) |
| --- | --- | --- | --- |
| TCK-01 | PASS | `task-check.ts:62-71`: a probe's refusal becomes a row and is never rethrown. `:271-287` is the sequence, `:186-200` the order with a Workspace, `:204-221` the order without one | `task-check-e2e.test.mjs:95`, `:108`, `:149-167` (full order, with and without a Workspace); `:115-123` (four missing checks, every other check ready); M6b is killed |
| TCK-02 | FAIL (behavior: N2; proof: R7) | Statuses: `task-check.ts:39`. `missing` is built from the public envelope (`:54-57`, `task-public-error.ts:17-27`). `skip` always names `dependsOn` (`:73-75`). Presence refusal: `task-credentials.ts:83-90`. Exception: `task-check.ts:128-129` judges a linked identity directory by containment only (N2) | `task-check-e2e.test.mjs:115-121`, `:168-171`, `:184-187`, `:199-200`, `:209-212`, `:220-221`. No journey has a missing `task-policy` (R7 survived) |
| TCK-03 | PASS | `task-check.ts:281-286` (`ready`, one diagnostic per row that is not ready, exit 0 or 4); `:262-269` (line formats); `task-command.ts:17-22`, `:30` (`--request` required, `VES_CLI_ARGUMENT_INVALID`) | `task-check-e2e.test.mjs:93-97`, `:106-107`, `:124-125`, `:133`, `:171`. Exit 2 has no test in this suite. Probe P8 observed exit 2 with `VES_CLI_ARGUMENT_INVALID` (argument `--request`) |
| TCK-04 | PASS | `task-check.ts:186-200`, `:204-221` (order); `:146-164` (credentials); `:166-182` (`billing` for v2 only); `:223-238` (executables, `codex-login` unless the verifier is on an API key); `:240-258` (`windows` on win32 when Claude Code runs); `release-manifest.ts:150-159` | `task-check-e2e.test.mjs:40-54`, `:95`, `:108`, `:149-167`, `:225-244` (API-key rows, no `codex-login`), `:269` (`billing` for v2) |
| TCK-05 | FAIL (proof: R2, R5, R6, macOS value read) | Presence only: `task-credentials.ts:86` (`adapter.has`). Probe-only drivers: `task-check.ts:78-80`, `:98`, `:114`. Temporary status home: `:134-139`. No state is created: `:86` (`ensure: false`). Containment: `:87`, `task-workspace.ts:114-129`. Identity containment: `task-check.ts:128-129`. Probes P1 to P3 and P6 observed every clause | State tree, identity directory, and repository unchanged: `task-check-e2e.test.mjs:88-101`. No value read on Windows and Linux: `:100`. Sessions link: `:174-190`. Survivors: an identity link (R2), the status home under `<ws>/sessions` (R5), and the Workspaces root or Workspace root as a link (R6). The macOS value read is unasserted |
| TCK-06 | FAIL (proof: R9) | `task-check.ts:93-105` (Claude Code at `CLAUDE_MEDIATED_MINIMUM_VERSION`); `:107-122` (Codex at the driver default, or `CODEX_STRUCTURED_MINIMUM_VERSION` for v2; an unreadable request at the v1 floor). Probe P9 observed the last clause | `task-check-e2e.test.mjs:247-255` (2.1.281 missing as `claude-version`; M7 is killed); `:257-271` (0.159.2 ready for v1 and missing for v2). No test covers an unreadable request (R9 survived) |
| TCK-07 | PASS (by inspection) | `README.md:270` (task section), `README.md:359` (exit row 4); `docs/quick-start.md:321-341` (step 6); `CHANGELOG.md:11-13` | None asserts the mentions; `tests/agent-readiness/beta-tester-docs.test.mjs` checks the exit table's nine rows only |

### Gate results

| Command | Exit | Test count | Result |
| --- | --- | --- | --- |
| `node --test tests/e2e/task-check-e2e.test.mjs` (HEAD, before the sensor) | 0 | 10 tests: 10 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | PASS |
| `node --test tests/e2e/task-check-e2e.test.mjs` (after the sensor, restored tree) | 0 | 10 tests: 10 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | PASS |
| `corepack pnpm gate:quick` (HEAD, clean tree) | 0 | `format:check`, `lint`, `complexity:check` (PASS, 170 baselined hotspot keys), and `typecheck`. `test:unit` 3029, `test:agent-readiness` 378, and `test:census` 13 tests pass, with 0 failed, skipped, cancelled, or todo | PASS |

### Probes

Each probe ran outside the repository, through the repository's own fixture
(`tests/helpers/task-cli-fixture.mjs`) and the real `vestra` binary. They left
no repository file changed. `<ws>` is `<state>/workspaces/<workspaceId>`.

- **P1:** `<ws>/tasks` is a junction to a directory outside. `workspace` is
  missing with `VES_STATE_ROOT_ESCAPE` and the recovery "Remove the link
  crossing the isolated Workspace state root.". `task plan --dry-run` exits 5
  with the same code and recovery.
- **P2:** `<state>/workspaces` is a junction to a directory outside.
  `workspace` is missing with `VES_STATE_ROOT_ESCAPE`. `task plan --dry-run`
  exits 0 because it proves no state containment. `ensureWorkspaceState`
  refuses the link for `task start`
  (`packages/platform-node/src/state-root.ts:116-119`).
- **P3:** the identity directory is a junction to a directory outside that
  holds a ChatGPT login. `codex-login` is missing with
  `VES_STATE_ROOT_ESCAPE`. No `codex login status` ran, and the target holds
  only its `auth.json`. After `task plan` and `task approve`, `task start`
  exits 5 with `VES_TASK_NOT_CONFIGURED` (requirement `codex-identity`).
- **P4:** the identity directory is a junction to a real directory inside
  `<ws>` (below `cache/`) that holds a ChatGPT login. `task check` exits 0
  with `ready: true`. After `task plan` and `task approve`, `task start` exits
  5 with `VES_TASK_NOT_CONFIGURED` (requirement `codex-identity`).
- **P5:** `.verchestra/policy/task-authority.json` is malformed.
  `task-policy` is missing with `VES_TASK_STATE_INVALID` (reason
  `VES_TASK_STATE_MALFORMED`) and plan's recovery, and every other row is
  ready. `task plan --dry-run` exits 5 with the same envelope.
- **P6:** the ready fixture. `task check` exits 0, and `task plan --dry-run`
  exits 0 (`NOT_PERSISTED`). The children were `claude --version`,
  `codex --version`, and one `codex login status`. That status check ran with
  its working directory and `HOME` in a `verchestra-task-check-*` directory
  below the child's temporary directory, outside the Workspace, with
  `CODEX_HOME` set to the identity directory. The store log holds two
  `cmdkey` presence queries, and no session log exists.
- **P7:** a missing login (fixture `codexLogin: null`). The stderr reads:
  `$env:CODEX_HOME='<ws>\codex-identity'; codex login -c 'cli_auth_credentials_store="file"'`.
  The identity directory still does not exist after the check. The real Codex
  CLI 0.115.0, run as `codex login status` with `CODEX_HOME` naming a
  directory that does not exist, exits 1 with `Error loading configuration:
  CODEX_HOME points to "<dir>", but that path does not exist`. `codex login`
  itself was not run, because it starts a sign-in.
- **P8:** `task check` without `--request` exits 2 with
  `VES_CLI_ARGUMENT_INVALID` (argument `--request`).
- **P9:** a rejected request, with the fake Codex at 0.159.2.
  `executable:codex` is ready, judged at the v1 floor.

### Discrimination sensor

Each mutant was applied to the working tree. Then the whole
`tests/e2e/task-check-e2e.test.mjs` suite ran (10 journeys). The file was
restored with `git checkout --`, and `git status --short` was confirmed empty
before the next mutant. Line numbers are at HEAD.

| Mutation | Test that should catch it | Result |
| --- | --- | --- |
| M6b: reorder the no-Workspace rows, `gate-allowlist` after `api-key-models` (`task-check.ts:211-219`) | `task-check-e2e.test.mjs:129` | killed (1 of 10 failed) |
| M7: drop the mediated Claude Code minimum (`task-check.ts:97`) | `:247` | killed (1 of 10 failed) |
| M8: `openTaskWorkspace(io, { ensure: true })` (`task-check.ts:86`) | `:88` (state tree) | killed (1 of 10 failed) |
| M9: judge the login with `task start`'s `requireCodexSubscription` (`task-check.ts:237`) | `:88`, `:103` | killed (2 of 10 failed) |
| M10: drop the not-checked `credential:providers` row when the provider modes are missing (`task-check.ts:161`) | `:215` | killed (1 of 10 failed) |
| R1: the `source-revision` probe always succeeds (`task-check.ts:193`) | `:204` | killed (1 of 10 failed) |
| R2: drop the identity-directory containment proof (`task-check.ts:129`) | a linked identity directory (none exists) | **survived** |
| R3: bypass `publicError`: a public envelope is kept, any other error records only its code, with no recovery (`task-check.ts:55-56`) | `:174` | killed (1 of 10 failed) |
| R4: drop the login hint (`task-check.ts:140-142`) | `:103` (`:126`) | killed (1 of 10 failed) |
| R5: run `codex login status` from a `codex-status-*` home under `<ws>/sessions`, as `task start` does, in place of the OS temporary directory (`task-check.ts:134`) | an assertion on the status check's home (none exists; the state snapshot leaves `sessions/` out) | **survived** |
| R6: drop the Workspaces-root and Workspace-root containment (`task-workspace.ts:116-117`) | a linked `<state>/workspaces` or `<ws>` (none exists) | **survived** |
| R7: the `task-policy` probe always succeeds (`task-check.ts:194`) | a malformed `task-authority.json` (none exists) | **survived** |
| R8: `codexFileLoginCommand` without `-c 'cli_auth_credentials_store="file"'` (`task-codex-identity.ts:151`) | `:103` (`:126`) | killed (1 of 10 failed) |
| R9: an unreadable request is judged at the v2 Codex floor (`task-check.ts:113`, `=== 2` changed to `!== 1`) | a rejected request with Codex 0.159.2 (none exists) | **survived** |

Nine of fourteen were killed, including all five round-1 survivors. Five
survived: R2, R5, R6, R7, and R9.

### New findings

- **N1 (low, usability; follow-up of F10): the printed login command fails
  when the identity directory does not exist.** `task-check.ts:130-142` prints
  `codexFileLoginCommand(directory)` whether the directory exists or not, and
  by design (TCK-05) nothing creates it. `task start` creates the directory
  before it prints its own command (`ensureCodexIdentity`,
  `task-codex-identity.ts:157-160`). The quick start's step 3 creates it before
  `codex login` (`docs/quick-start.md:134-136`, `:141-144`). Failure scenario:
  a tester who has never signed Codex in for this Workspace runs `task check`
  and runs the printed command as it stands. Codex refuses it, because
  `CODEX_HOME` names a path that does not exist (P7). The fake Codex does not
  model this refusal, so the journeys cannot see it. Fix: print the directory
  creation with the command, as step 3 does, or point to step 3.
- **N2 (medium; TCK-02 and the feature's purpose): a linked Codex identity
  directory is judged by containment, while `task start` refuses any link
  there.** `ensureCodexIdentity` (`task-codex-identity.ts:157-160`) refuses an
  identity directory that `lstat` does not report as a real directory. It
  answers `VES_TASK_NOT_CONFIGURED`, requirement `codex-identity`.
  `task check` proves only that the directory resolves inside `<ws>`
  (`task-check.ts:128-129`).
  - Failure scenario 1 (P4): a link to a real directory inside `<ws>`.
    `task check` exits 0 with `ready: true`, and `task start` then refuses
    `codex-identity`. This is the same class as round-1 F3.
  - Failure scenario 2 (P3): a link that escapes. `codex-login` is missing
    with `VES_STATE_ROOT_ESCAPE` and its recovery. `task start` refuses the
    same piece as `VES_TASK_NOT_CONFIGURED` (`codex-identity`) with the
    not-configured recovery. That contradicts TCK-02, which asks for the code,
    safe details, and recovery of the refusal that `task plan` or `task start`
    gives.
  - Fix: when the directory exists, prove it read-only as
    `ensureCodexIdentity` does (a real directory, not a link), refused as
    `codex-identity`. Keep the containment proof, and add a journey with a
    linked identity directory. The journey also kills R2.
- **N3 (low, proof): five new mutants survive** (R2, R5, R6, R7, and R9; see
  the sensor). Each needs a journey:
  - a linked identity directory;
  - an assertion that the status check's `home` and `cwd`
    (`fake-codex-status.log`) lie outside the state root;
  - a linked `<state>/workspaces` or `<ws>`;
  - a malformed `.verchestra/policy/task-authority.json`;
  - a rejected request with Codex 0.159.2.

  The value-read check is still skipped on macOS
  (`task-check-e2e.test.mjs:59`, `:100`).
- **N4 (low, process): the fix commit left the handoff and the task list
  stale.** It added two checks and four journeys, but
  `.specs/features/task-check/handoff.md` was not changed:
  - its `lastGate` cites the e2e suite at "6 of 6";
  - its `nextTask` is still the first validation;
  - `updatedAt` is `2026-10-26T08:30:00Z`;
  - its Completed Evidence lists six journeys.

  `.specs/features/task-check/tasks.md` (T2) also says "6 journeys". The root
  `AGENTS.md` change rules require the handoff to be updated in the same
  change when behavior changes.

`mutating: false` (`release-manifest.ts:154`) stays honest. Both new checks
only read: `git rev-parse` and the policy file.

### Gaps and follow-up

- Fix N2, and add the linked-identity journey (it also kills R2).
- Fix N1.
- Add the journeys of N3 for R5, R6, R7, and R9.
- Bring `handoff.md` and `tasks.md` up to date (N4).
- Linux and macOS were not exercised by this validation.

### Human review

Not ready for merge on this evidence: the round-2 result is FAIL. Only a human
decides merge, release, or deployment.

## Round 3

**Result:** FAIL

**Validator:** an independent validator sub-agent, not the author of the
feature (round 3). **Date:** 2026-10-26.

**Commit validated:** `7e19779500c6d35f8f04ce592e9145a0ce7c8d3c` (HEAD of
`feat/593-task-check`, the T5 fix commit); range
`4a33c0c8fa22b5f8d2baf831cf614919a96dee26..7e19779500c6d35f8f04ce592e9145a0ce7c8d3c`
(seven commits).

**Host:** Windows x64, Node 24.14.0. The e2e journeys, the probes, and the
sensor ran on Windows only; the Linux and macOS branches were judged by
reading the code.

**Verdict rule:** round 2's. A requirement passes when each of its clauses has
behavior evidence and a test assertion that discriminates it. A clause shown
only by a probe, with no test that catches a change to it, fails as "proof".

T5 closes N1, N2, and N4, and the four round-2 survivors that still exist (R5,
R6, R7, R9) are killed. The round-3 verdict is still FAIL:

- Two behavior divergences from the refusals `task plan` and `task start` give
  (N5, N6), both in corner cases.
- Eight of fifteen mutants survived (NM1, NM4, NM5, R6a, MT3, MT4, MT5, MT7).
  Each one changes observable behavior, which a probe confirmed, and no test
  catches it.

### Round-2 findings and survivors

| Item | Status | Evidence (path:line) |
| --- | --- | --- |
| N1 (printed login command fails without the directory) | RESOLVED | `apps/vestra-cli/src/task/task-codex-identity.ts:151-159` creates the directory first (`New-Item -ItemType Directory -Force` on Windows; `mkdir -p` and `chmod 700` on POSIX); `task-check.ts:143-145` prints it. Test `tests/e2e/task-check-e2e.test.mjs:129` (Windows branch on this host, POSIX branch on POSIX hosts); NM3 is killed. Probe Q5: the printed Windows command, run in PowerShell 7 with a stub `codex`, created the directory, set `CODEX_HOME`, and passed `login -c cli_auth_credentials_store="file"`, and a second `task check` exited 0. The POSIX form, run in Git Bash with a stub and a quote in the path, created the directory. The command's `CODEX_HOME` and its POSIX branch have no discriminating test on this host (N7) |
| N2 (linked identity directory) | RESOLVED | `task-check.ts:126-132` (`lstat`; a link or a non-directory is `codex-identity`), `:136`. Test `task-check-e2e.test.mjs:299-312` (a link to a directory inside `<ws>`: `codex-identity`, and no status check ran); the N2 mutant and NM2 are killed. Probes Q1 and Q2 re-ran round 2's P4 and P3 through `tests/helpers/task-cli-fixture.mjs`. For a link inside `<ws>` and for a link that escapes, `task check` and `task start` now give the same code (`VES_TASK_NOT_CONFIGURED`), the same safe details (`requirement: codex-identity`), and the same recovery. A file or a dangling link at that path still diverges (N5) |
| N3 (five survivors) | PARTLY | R5, R6, R7, and R9 are killed (see the sensor). R2 is not applicable: `requireWorkspaceDirectoryContained`, its target, was removed by `7e19779`, and `identityDirectoryPresent` took its role, which the N2 mutant exercises (killed). R6 removed both containment lines and is killed only through `task-workspace.ts:117`; its half for `task-workspace.ts:116` (R6a) survives (N10). The macOS value read stays unasserted; this validator judges it out of reach on this host (see Residual gaps) |
| N4 (stale handoff and task list) | RESOLVED | `.specs/features/task-check/handoff.md` frontmatter: `lastCompletedTask: T5`, `nextTask` names round 3, `lastGate` cites 15 of 15, `updatedAt: 2026-10-26T11:30:00Z`; Completed Evidence names fifteen journeys. `tasks.md:6` no longer counts journeys; `tasks.md:8-9` add T4 and T5 |
| R2 (round 2: drop the identity containment proof) | NOT APPLICABLE | Target function removed; see N3 |
| R5 (status check home under `<ws>/sessions`) | RESOLVED | Killed by `task-check-e2e.test.mjs:279-294` (`:288-292`, the home and working directory lie outside the state root; `:293`, the home is removed) |
| R6 (drop the Workspaces-root and Workspace-root containment) | RESOLVED | Killed by `task-check-e2e.test.mjs:316-325` (a `<ws>` link out of the state root) |
| R7 (`task-policy` always succeeds) | RESOLVED | Killed by `task-check-e2e.test.mjs:327-337` |
| R9 (unreadable request at the v2 Codex floor) | RESOLVED | Killed by `task-check-e2e.test.mjs:341-348` |

### Requirement evidence at HEAD

| Requirement | Verdict | Implementation evidence (path:line) | Test evidence (path:line) |
| --- | --- | --- | --- |
| TCK-01 | PASS | `apps/vestra-cli/src/task/task-check.ts:57-66` (a refusal becomes a row and is never rethrown); `:274-283` (the sequence) | `task-check-e2e.test.mjs:95`, `:108`, `:152-170` (full order, with and without a Workspace); `:115-123` (four missing checks at once, every other check ready) |
| TCK-02 | FAIL (behavior: N5) | Statuses: `task-check.ts:34`. A missing row is built from the public envelope (`:49-52`, `task-public-error.ts:17-27`). `skip` always names `dependsOn` (`:68-70`). Presence refusal: `task-credentials.ts:83-91`. Identity: `task-check.ts:126-132`. Exception: for a file or a dangling link at the identity path, `task start` answers `VES_TASK_FAILED` (reason `VES_TASK_INTERNAL`), not the `codex-identity` refusal `task check` reports (N5) | `task-check-e2e.test.mjs:115-121`, `:171-174`, `:189-190`, `:200-204`, `:213-215`, `:222-225`, `:256-257`, `:270-273`, `:308-309`, `:333-335` |
| TCK-03 | FAIL (proof: MT3) | `task-check.ts:284-288` (`ready`, one diagnostic per row that is not ready, exit 0 or 4); `:265-272` (line formats); `task-command.ts:18-23`, `:30` (`--request` required, `VES_CLI_ARGUMENT_INVALID`) | `task-check-e2e.test.mjs:93-97`, `:106-107`, `:124-125`, `:136`, `:174`. The exit 2 of an argument error is shown only by probe Q8. MT3 makes a missing `--request` exit 4, and it passes this suite, `tests/contract/cli-surface.test.mjs`, and `tests/e2e/cli-launchers-e2e.test.mjs` (N11). Round 2 recorded PASS on the same evidence |
| TCK-04 | FAIL (proof: MT4) | `task-check.ts:189-203`, `:207-224` (order); `:153-167` (credentials); `:179-184` (`billing` for v2 only); `:226-241` (executables, `codex-login` unless the verifier is on an API key); `:243-261` (`windows`); `release-manifest.ts:150-159` | `task-check-e2e.test.mjs:40-54`, `:95`, `:108`, `:152-170` (v1 order); `:232-246` (API-key rows, no `codex-login`); `:272` (`billing` ready). No test pins the v2 order: MT4 moves `billing` after the credential rows and passes every journey (N9). Probe Q9 observed the order TCK-04 states |
| TCK-05 | FAIL (behavior: N6; proof: NM1, NM4, NM5, R6a, MT5) | Presence only: `task-credentials.ts:86` (`adapter.has`). Probe-only drivers: `task-check.ts:73-75`, `:90-94`, `:106-110`. Temporary status home: `:137-142`. No state is created: `:81` (`ensure: false`). Containment: `:82`, `task-workspace.ts:114-129`. Real identity directory: `task-check.ts:126-132`. Login command: `task-codex-identity.ts:151-159`. Exception: `task-workspace.ts:106` refuses a directory that resolves to its owner, which `ensureWorkspaceState` accepts (`packages/platform-node/src/state-root.ts:111`) (N6) | Repository, state tree, and identity directory unchanged: `task-check-e2e.test.mjs:88-101`. No value read on Windows and Linux: `:100`. Status home: `:279-294`. Sessions link: `:177-193`. Workspace root link: `:316-325`. Linked identity directory: `:299-312`. Directory creation in the printed command: `:129`. Not discriminated: a file at the identity path (NM1); the printed command's `CODEX_HOME` (NM5) and its POSIX branch on this host (NM4); a `<state>/workspaces` link (R6a); which provider children start (MT5) |
| TCK-06 | PASS | `task-check.ts:88-100` (Claude Code at `CLAUDE_MEDIATED_MINIMUM_VERSION`); `:104-117` (Codex at the driver default, or `CODEX_STRUCTURED_MINIMUM_VERSION` for v2; an unreadable request at the v1 floor) | `task-check-e2e.test.mjs:250-258` (2.1.281 missing as `claude-version`); `:260-274` (0.159.2 ready for v1, missing as `codex-version` for v2); `:341-348` (a rejected request at the v1 floor; R9 is killed) |
| TCK-07 | PASS (by inspection, as in rounds 1 and 2) | `README.md:270` (task section); `README.md:359` (exit row 4); `docs/quick-start.md:319-341` (step 6, `task check` at `:324`); `CHANGELOG.md:11-13` | None asserts the mentions. MT7 removes `task check` from README exit row 4 and passes this suite and `tests/agent-readiness/beta-tester-docs.test.mjs` (N12). This validator keeps the inspection verdict, because the requirement is about the tracked documents themselves. The verdict rule still counts MT7 as a survivor |

### Gate results

| Command | Exit | Test count | Result |
| --- | --- | --- | --- |
| `node --test tests/e2e/task-check-e2e.test.mjs` (HEAD, before the sensor) | 0 | 15 tests: 15 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | PASS |
| `node --test tests/e2e/task-check-e2e.test.mjs` (after the sensor, restored tree) | 0 | 15 tests: 15 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo | PASS |
| `corepack pnpm gate:quick` (HEAD, clean tree) | 0 | `format:check`, `lint`, `complexity:check` (PASS, 170 baselined hotspot keys), and `typecheck`. `test:unit` 3029, `test:agent-readiness` 378, and `test:census` 13 tests pass, with 0 failed, skipped, cancelled, or todo | PASS |

### Probes

Each probe ran outside the repository, through the repository's own fixture
(`tests/helpers/task-cli-fixture.mjs`, and `tests/helpers/task-coordinated-fixture.mjs`
for v2) and the real `vestra` binary. They left no repository file changed.
`<ws>` is `<state>/workspaces/<workspaceId>`.

- **Q1 (round 2's P4):** the identity directory is a link to a real directory
  below `<ws>/cache` that holds a ChatGPT login. `task check` exits 4.
  `codex-login` is missing with `VES_TASK_NOT_CONFIGURED`, requirement
  `codex-identity`, and the not-configured recovery. No `codex login status`
  ran. After `task plan` and `task approve`, `task start` exits 5 with the same
  code, safe details, and recovery.
- **Q2 (round 2's P3):** the identity directory is a link to a directory
  outside the state root that holds a ChatGPT login. The result is the same as
  Q1, for both commands. No status check ran, and the target still holds only
  its `auth.json`.
- **Q3:** a regular file stands at the identity path. `task check`:
  `codex-login` is missing, requirement `codex-identity`. `task start` exits 5
  with `VES_TASK_FAILED`, reason `VES_TASK_INTERNAL`, and the recovery
  "Inspect `vestra task status` for the recorded reason, remediate, and retry
  or plan a new run.".
- **Q4:** a link whose target was deleted stands at the identity path. Both
  commands answer as in Q3.
- **Q5:** a missing login (fixture `codexLogin: null`). The printed command
  reads
  `New-Item -ItemType Directory -Force -Path '<ws>\codex-identity' | Out-Null; $env:CODEX_HOME='<ws>\codex-identity'; codex login -c 'cli_auth_credentials_store="file"'`.
  PowerShell 7 ran it as printed, with a `codex` function standing in for the
  CLI that fails when `CODEX_HOME` does not exist. It exited 0 and received
  `login`, `-c`, `cli_auth_credentials_store="file"`. A second `task check`
  exited 0 with `codex-login` ready. The POSIX form
  (`codexFileLoginCommand(<dir>, "linux")`) ran in Git Bash with a stub and a
  quote in the path. It created the directory, and the stub saw `CODEX_HOME`
  naming it.
- **Q6:** `<state>/workspaces` is a link to a directory outside. `workspace`
  is missing with `VES_STATE_ROOT_ESCAPE` and the recovery "Remove the link
  crossing the isolated Workspace state root.".
- **Q7:** `<ws>/sessions` is a link to `<ws>` itself. `task check` exits 4:
  `workspace` is missing with `VES_STATE_ROOT_ESCAPE`. `task plan` exits 0,
  then `task approve` exits 0, then `task start` exits 0 at `HUMAN_REVIEW`.
- **Q8:** `task check` without `--request` exits 2 with
  `VES_CLI_ARGUMENT_INVALID` (argument `--request`).
- **Q9:** a v2 `agent` request (`EXECUTIONS.agent`). The rows come in this
  order: `workspace`, `request`, `source-revision`, `task-policy`,
  `provider-modes`, `gate-allowlist`, `api-key-models`, `billing`, the two
  credential rows, `executable:claude`, `executable:codex`, `codex-login`, and
  `windows`, all ready.
- **Q10:** two Codex-only v2 requests: one with a Codex writer, one with a
  Codex reader and no writer. `task check` and `task plan --dry-run` both
  reject each as `VES_TASK_REQUEST_REJECTED` (reason
  `VES_TASK_REQUEST_EXECUTION_INVALID`).
- **Q11:** the ready fixture. The Windows provider witness logs hold exactly
  `claude --version`, `codex --version`, and `codex login status`.

### Discrimination sensor

Each mutant was applied to the working tree. Then the whole
`tests/e2e/task-check-e2e.test.mjs` suite ran (15 journeys), plus any extra
suite named in the table. The file was restored with `git checkout --`, and
`git status --short` was confirmed empty before the next mutant (this
`validation.md` change was written after the sensor). For every survivor, a
probe against the mutant confirmed that observable behavior changes. Line
numbers are at HEAD.

| Mutation | Test that should catch it | Result |
| --- | --- | --- |
| R5: run `codex login status` from a `codex-status-*` home under `<ws>/sessions`, as `task start` does (`task-check.ts:137`) | `task-check-e2e.test.mjs:279` | killed (1 of 15 failed) |
| R6: drop the Workspaces-root and Workspace-root containment (`task-workspace.ts:116-117`) | `:316` | killed (1 of 15 failed) |
| R7: the `task-policy` probe always succeeds (`task-check.ts:197`) | `:327` | killed (1 of 15 failed) |
| R9: an unreadable request is judged at the v2 Codex floor (`task-check.ts:108`, `=== 2` changed to `!== 1`) | `:341` | killed (1 of 15 failed) |
| N2: accept a linked identity directory (`task-check.ts:127`, `lstat` changed to `stat`, which follows the link) | `:299` | killed (1 of 15 failed) |
| NM1 (new): refuse only a link, not every non-directory (`task-check.ts:129`, `\|\| !facts.isDirectory()` dropped). A file at the identity path then reads as requirement `codex-login` | a file at the identity path (none exists) | **survived** |
| NM2 (new): treat a linked identity directory as absent, not refused (`task-check.ts:129-130`, `return false` in place of the throw) | `:299` (`:309`) | killed (1 of 15 failed) |
| NM3 (new): the Windows login command no longer creates the directory (`task-codex-identity.ts:155`, `New-Item ... \| Out-Null;` dropped) | `:103` (`:129`) | killed (1 of 15 failed) |
| NM4 (new): the POSIX login command no longer creates the directory (`task-codex-identity.ts:158`, `mkdir -p` and `chmod 700` dropped) | `:129` on a POSIX host; no unit test of `codexFileLoginCommand` | **survived** (on this host) |
| NM5 (new): the Windows login command no longer names the identity directory (`task-codex-identity.ts:155`, `$env:CODEX_HOME=...;` dropped). Probe: run as printed, it signs nothing into the Workspace, and a second check stays missing | an assertion on the command's `CODEX_HOME` (none exists; `:126` and `:129` match fragments) | **survived** |
| R6a (new): drop only the Workspaces-root containment (`task-workspace.ts:116`). Probe: a `<state>/workspaces` link outside makes `workspace` ready | a linked `<state>/workspaces` (none exists) | **survived** |
| MT3 (new): `task check` takes a missing `--request` as an empty path (`task-command.ts:30`, `required` dropped). Probe: it then exits 4 | an exit-2 journey; also run: `tests/contract/cli-surface.test.mjs` (53 pass) and `tests/e2e/cli-launchers-e2e.test.mjs` (17 pass) | **survived** |
| MT4 (new): run `billing` after the credential rows (`task-check.ts:179`, `:201`). Probe: the v2 rows then put `billing` after `credential:evidence-signing-passphrase` | a v2 order assertion (none exists; `:272` checks the status only) | **survived** |
| MT5 (new): start one more provider child, `claude --print`, after the version probe (`task-check.ts:94`). Probe: the Windows witness log records it | an assertion on the provider children (none exists) | **survived** |
| MT7 (new): README exit-code row 4 no longer names `task check` (`README.md:359`); also run: `tests/agent-readiness/beta-tester-docs.test.mjs` (13 pass) | a documentation assertion (none exists) | **survived** |

Seven of fifteen were killed, including every round-2 survivor that still
exists. Eight survived: NM1, NM4, NM5, R6a, MT3, MT4, MT5, and MT7. NM1 to NM5
target the code changed since round 2.

### New findings

- **N5 (low; TCK-02 against TCK-05): a file or a dangling link at the identity
  path is refused differently by `task check` and `task start`.**
  `ensureCodexIdentity` calls `mkdir(..., { recursive: true })`
  (`task-codex-identity.ts:165`) before its `lstat` check (`:166`). That
  `mkdir` fails on a file or on a link whose target is gone, and the error is
  not a public one. `task check` refuses both cases as requirement
  `codex-identity` (`task-check.ts:129-130`), which TCK-05 requires. TCK-02,
  however, asks for the refusal `task start` gives.
  - Failure scenario (Q3 and Q4, observed): a tester's identity path is a stray
    file, or a link to a deleted directory. `task check` reports
    `codex-identity` with the not-configured recovery. `task start` then
    refuses `VES_TASK_FAILED`, reason `VES_TASK_INTERNAL`, and tells the tester
    to inspect `task status`, which names nothing.
  - No journey puts a file there (NM1 survived).
  - Fix: make `ensureCodexIdentity` `lstat` before it creates anything, so
    `task start` refuses `codex-identity` as `task check` does, and add a
    journey with a file at the identity path.
- **N6 (low; TCK-05, "as `ensureWorkspaceState` proves"): `task check` refuses
  a state directory that resolves to its own owner, and `task plan` and
  `task start` accept it.** `requireContained` refuses `child === ""`
  (`task-workspace.ts:106`). `ensureWorkspaceState` accepts `value === ""`
  (`packages/platform-node/src/state-root.ts:111`).
  - Failure scenario (Q7, observed): `<ws>/sessions` is a link to `<ws>`.
    `task check` exits 4 with `workspace` missing and the recovery "Remove the
    link crossing the isolated Workspace state root.". `task plan`,
    `task approve`, and `task start` all succeed, and the run reaches
    `HUMAN_REVIEW`.
  - Fix: decide which rule is intended and apply it in both places, or state
    the difference in the spec.
- **N7 (low, proof; TCK-05, the printed login command): the command is
  asserted only by fragments.** `task-check-e2e.test.mjs:126` and `:129` match
  the `-c` flag and the directory creation.
  - Failure scenario (NM5, observed): a change that drops
    `$env:CODEX_HOME=...` passes every journey. Run as printed, the command
    signs Codex into the default Codex home, not the Workspace identity
    directory, and `task check` stays missing.
  - The POSIX branch is asserted only on POSIX hosts (NM4).
  - `codexFileLoginCommand` takes its platform as a parameter, but it has no
    unit test. `codexLoginCommand` has one for both branches
    (`tests/integration/codex-identity.test.mjs:225-228`, `:322-327`).
  - Fix: assert the whole command for both platforms in a unit test.
- **N8 (low, proof; TCK-05, "the only children"): no test names the children
  `task check` starts.**
  - Failure scenario (MT5, observed): an extra `claude --print` child passes
    all fifteen journeys. The Windows provider witness log
    (`claude.exe.witness.log`) records it.
  - At HEAD the witness logs hold exactly the three permitted children (Q11).
  - Fix: assert the witness logs on Windows, and an equivalent child log on
    POSIX.
- **N9 (low, proof; TCK-04): the v2 order is not pinned.**
  - Failure scenario (MT4, observed): `billing` moved after the credential
    rows passes every journey. `task-check-e2e.test.mjs:272` checks only its
    status.
  - Fix: assert the full row names of the v2 journey (Q9 gives the order).
- **N10 (low, proof; TCK-05 containment): the containment of
  `<state>/workspaces` (`task-workspace.ts:116`) has no test.** The new journey
  (`task-check-e2e.test.mjs:316-325`) links `<ws>` and so reaches only `:117`.
  - Failure scenario (R6a, observed): without `:116`, a `<state>/workspaces`
    link outside the state root makes `workspace` ready (Q6 shows the refusal
    at HEAD).
  - Fix: add a journey with a linked `<state>/workspaces`.
- **N11 (low, proof; TCK-03): the exit 2 of an argument error has no test.**
  - Failure scenario (MT3, observed): a handler that does not require
    `--request` turns a missing `--request` into exit 4 (Q8 shows exit 2 at
    HEAD). The task check suite, the CLI surface contract, and the launcher e2e
    all still pass.
  - Fix: add a journey without `--request`.
- **N12 (low, proof; TCK-07): no test asserts the documentation mentions.**
  - Failure scenario (MT7, observed): README exit row 4 without `task check`
    passes `tests/agent-readiness/beta-tester-docs.test.mjs`.
  - Fix: assert the mentions there.

Observation, not a requirement defect: the printed Windows command leaves
`CODEX_HOME` set in the tester's PowerShell session. The quick start's block
ends with `Remove-Item Env:CODEX_HOME` (`docs/quick-start.md:146`), and
`task start`'s own command (`codexLoginCommand`) behaves the same way.

`mutating: false` (`release-manifest.ts:154`) stays honest. The T5 change only
replaced a read (`access`) with another read (`lstat`), and the printed
command is shown, never run.

### Residual gaps judged out of reach on this host

- **The macOS value read.** The darwin backend runs only on darwin. Its fake
  records only the subcommand and the account (`tests/helpers/fake-keychain-spawn.mjs:28-36`),
  so a discriminating test needs a macOS host and a fake that records `-g`.
- **The omission of `executable:claude` and `windows` for a request that runs
  no Claude Code.** No valid request without a Claude Code node was found
  (Q10). For a rejected request, `task-check.ts:233` and `:250` judge Claude
  Code as needed, so the negative branch has no reachable case for a test.
- The Linux Secret Service and macOS branches were not exercised by this
  validation.

### Gaps and follow-up

- Fix N5 and N6, or record the chosen rule in the spec.
- Add the tests of N7 to N12. Together they kill NM1, NM4, NM5, R6a, MT3, MT4,
  MT5, and MT7.

### Human review

Not ready for merge on this evidence: the round-3 result is FAIL. Only a human
decides merge, release, or deployment.
