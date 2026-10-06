# Coordinated-Run Pilots

**Task:** T9 of `.specs/features/strands-subscription-integration/` (SSI-84,
SSI-85)
**Revision:** `93b38c5df1943117482171866b4bea0a8320bbac`
**Recorded by:** the independent verifier of T9, on 2026-10-04, at
`c3223c6`; brought to the revision above by the second independent
verifier, on 2026-10-04
**Status:** pending (owner) on every platform. No coordinated run with a real
subscription has been recorded on Windows, macOS, or Linux. Nothing below is
inferred: a pilot counts as passed only when its run is recorded here.

This record has two parts. The first is the owner's pilots: agent, graph, and
swarm runs with real Claude Code and Codex subscriptions, which SSI-84
requires. The second is what the deterministic stand-ins proved on each
platform of the qualification matrix, which is evidence about the code, not a
pilot.

## Real-subscription pilots

| Platform | Agent | Graph | Swarm |
| --- | --- | --- | --- |
| Windows x64 | pending (owner) | pending (owner) | pending (owner) |
| macOS | pending (owner) | pending (owner) | pending (owner) |
| Linux | pending (owner) | pending (owner) | pending (owner) |

A platform or account the owner cannot run is recorded as `not configured`,
never as passed. The optional Claude Code probe that
`docs/qualification/claude-code-driver-structured-results.md` assigns to this
record is also pending (owner).

### Rules for every pilot

- Subscription authentication only: both providers set to `subscription` in
  `task-providers.json`. A run with either provider on a key is refused
  (`coordinated-run-subscription`) and is not a pilot.
- Extra usage off before the first run, and the owner's statement written by
  hand afterwards (below). Verchestra cannot read the account setting; the
  statement is the owner's.
- Never exhaust an allowance on purpose (SSI-85). A pilot that suspends on a
  quota signal is recorded as suspended, with the record the run printed, and
  is resumed only after the provider's reset, by the owner.
- Record no token, account identifier, e-mail address, personal name, or
  machine path.

### What the owner does, per platform

1. **Install the providers.** Claude Code 2.1.282 or later. Codex 0.159.3 or
   later, the floor of the structured and subscription-only Codex sessions a
   coordinated run starts. On Windows also PowerShell 7 at its pinned path
   (`C:\Program Files\PowerShell\7\pwsh.exe`), native `claude.exe` and
   `codex.exe` on `PATH`, and the other prerequisites in
   `docs/quick-start.md` ("Windows prerequisites").
2. **Turn extra usage off.** In the Claude account (Settings > Usage), turn off
   usage credits and any auto-reload. In the ChatGPT account, keep no
   purchased Codex credits: a Codex session that sees credits, a node or the
   final verifier, does not start its turn and the run is suspended as `not
   configured` (`codex-credits`). The verifier checks them since remediation
   R1 of the T9 verification (finding 1); at earlier revisions it did not, and
   an `agent` pilot, whose only Codex session is the verifier, relied on this
   step alone.
3. **Write `task-billing.json` by hand**, beside `task-providers.json` in the
   Workspace state directory, in the format of `docs/quick-start.md`
   ("Subscriptions only, with extra usage off"): one entry per provider with
   `auth` (`subscription` for Claude Code, `chatgpt` for Codex),
   `extraUsage: "disabled"`, `confirmedAt` (the UTC time the account was
   checked), and, for Codex, `planType`: one of the plan types the Codex
   protocol names (the list is in `docs/quick-start.md`), which every `start`
   and `resume` compares with the plan the Codex sign-in reports, through one
   extra Codex process that reads only the account and which of the run's
   Codex models it offers.
4. **Prepare the run.** Coordinated runs are in the published
   `0.0.0-qualification.7`: run the CLI as
   `npx --yes verchestra@0.0.0-qualification.7`, and record its `--version`
   and the package's `dist.integrity` with each result. Use a disposable
   repository holding the files the
   examples name, and replace each example's `sourceRevision` with that
   repository's `git rev-parse HEAD`. The examples name `gpt-5.5` for every Codex
   session; if your account offers another Codex model, name that one instead.
   A build that carries the model check (AD-085) refuses a model the account
   does not offer at `start`, before any effect, as `not configured`
   (`codex-model-unavailable`). `0.0.0-qualification.7` has neither the check
   nor the subscription-only model entries (AD-084): it refuses `gpt-5.5` at
   `plan`, so these examples need a build that carries both.
5. **Run each mode** with `docs/examples/task-request-agent.json`,
   `task-request-graph.json`, and `task-request-swarm.json`:

   ```text
   vestra task plan --request task-request-<mode>.json
   vestra task approve --run-id <runId> --binding-digest <sha256:…>
   vestra task start --run-id <runId>
   vestra task status --run-id <runId>
   vestra task review --run-id <runId> --outcome accepted --surface-digest <sha256:…>
   ```

   Approve only when `plan` shows `subscription.preflight` as `ready`. On a
   suspension, `vestra task status` shows the reason, provider, and reset; the
   owner resumes with `vestra task resume --run-id <runId>` after the reset,
   or cancels.
6. **Optional Claude Code probe** (one model call, outside any Verchestra
   run): the print-mode session described in
   `docs/qualification/claude-code-driver-structured-results.md`. Record
   whether `system/init` reports `apiKeySource: "none"` and whether the final
   `result` line carries `structured_output`.

### What to record per run

| Field | Value |
| --- | --- |
| Platform and architecture | for example `darwin arm64` |
| Verchestra revision | the 40-character commit the CLI ran from |
| Claude Code and Codex versions | `claude --version`, `codex --version` |
| Mode | `agent`, `graph`, or `swarm` |
| Plan preflight | `ready`, or the requirement shown |
| Outcome | the final state (`HUMAN_REVIEW`, then `COMPLETED` after review), or `SUSPENDED` or `FAILED` with the reason code |
| Nodes | each node's state and visit count, from `status` |
| Usage | tokens on the run's ledger, and that it reads `not billed (subscription)` |
| Suspension | reason, provider, window, and reset, when the run suspended |
| Deviations | anything that differed from the steps above |

## Deterministic stand-in qualification by platform

From the platform qualification matrix at the recorded revision: runs
37198997592 (`gate:full`), 37198999663 (`gate:build`), and 37199001702
(`gate:security`). Every leg is green with 0 skipped and 0 todo except the
Windows leg of `gate:security`, which passed its unit, contract, e2e,
architecture, and qualification stages and was then cancelled at its
60-minute limit while its security stage hung, so its fault stage never ran;
the same leg passed on run 37197307202 at `f285f2b`, whose tree differs from
the recorded revision in two Markdown files only. The coordinated
journeys use labelled fakes of Claude Code and Codex
(`tests/e2e/task-coordinated-e2e.test.mjs`,
`tests/e2e/task-subscription-e2e.test.mjs`,
`tests/e2e/task-codex-account-e2e.test.mjs`,
`tests/e2e/task-grant-renewal-e2e.test.mjs`,
`tests/fault-injection/task-coordinated-crash-faults.test.mjs`); durations are
from the `gate:full` job logs, and every one of the 20 journeys also passed in
the `gate:build` and `gate:security` legs of the same platform (the crash
journey only where the gate runs fault, and not on the Windows
`gate:security` leg above).

| Platform | Agent, graph, swarm, cancel journeys | Suspension, credits, resume, and crash journeys | Verifier account, plan type, and grant renewal journeys | Example dry runs (three modes) | Verdict |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | Executed and passed (7.3 s, 8.6 s, 6.3 s, 5.2 s) | Executed and passed (credits 5.0 s, resume 10.1 s, crash 8.8 s) | Executed and passed (verifier credits 8.3 s, verifier resume 12.3 s, plan type 7.6 s, renewal 8.6 s) | Passed | Qualified with stand-ins |
| macOS x64 | Executed and passed (14.1 s, 16.1 s, 12.9 s, 12.9 s) | Executed and passed (credits 9.7 s, resume 21.1 s, crash 31.3 s) | Executed and passed (17.4 s, 27.5 s, 14.6 s, 18.7 s) | Passed | Qualified with stand-ins |
| Linux glibc x64 | Executed and passed (6.9 s, 7.6 s, 5.8 s, 6.1 s) | Executed and passed (credits 3.6 s, resume 7.1 s, crash 8.8 s) | Executed and passed (8.1 s, 14.0 s, 6.9 s, 8.2 s) | Passed | Qualified with stand-ins |
| Linux glibc arm64 | Executed and passed (6.6 s, 6.9 s, 5.0 s, 5.6 s) | Executed and passed (credits 3.3 s, resume 6.6 s, crash 8.0 s) | Executed and passed (7.5 s, 13.4 s, 6.3 s, 7.4 s) | Passed | Qualified with stand-ins |
| Windows x64 | Executed and passed (19.1 s, 34.2 s, 29.6 s, 13.1 s) | Executed and passed (credits 10.3 s, resume 24.1 s, crash 26.9 s) | Executed and passed (23.6 s, 35.7 s, 25.9 s, 24.4 s) | Passed | Qualified with stand-ins, over the named pipe |

Quota suspension is therefore qualified with deterministic fakes on all five
legs (SSI-85), and no subscription was touched to produce any of this
evidence. The stand-ins prove the code paths, not the providers: whether a
real Codex reads outside a node's read-scope copy, and whether it accepts a
working directory that is not a Git checkout, is for the pilots above to
show. At the revision first recorded here (`c3223c6`, runs 37190404353,
37190406187, 37190408045) the coordinated journeys executed on macOS only and
returned before running on Linux and Windows.
