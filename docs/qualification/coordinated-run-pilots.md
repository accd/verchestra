# Coordinated-Run Pilots

**Task:** T9 of `.specs/features/strands-subscription-integration/` (SSI-84,
SSI-85)
**Revision:** `c3223c6d3d8585a35f577136ce7f7d61ddb378cc`
**Recorded by:** the independent verifier of T9, on 2026-10-04
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
   extra Codex process that reads only the account.
4. **Prepare the run.** Coordinated runs are in no published release yet, so
   run the CLI from a source checkout at the recorded revision, as
   `node <checkout>/apps/vestra-cli/bin/vestra.mjs` in place of
   `npx verchestra`. Use a disposable repository holding the files the
   examples name, and replace each example's `sourceRevision` with that
   repository's `git rev-parse HEAD`.
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
37190404353 (`gate:full`), 37190406187 (`gate:build`), and 37190408045
(`gate:security`), every leg green with 0 skipped and 0 todo. The coordinated
journeys use labelled fakes of Claude Code and Codex
(`tests/e2e/task-coordinated-e2e.test.mjs`,
`tests/e2e/task-subscription-e2e.test.mjs`,
`tests/fault-injection/task-coordinated-crash-faults.test.mjs`); durations are
from the `gate:full` job logs.

| Platform | Agent, graph, swarm, cancel journeys | Suspension, credits, resume, and crash journeys | Example dry runs (three modes) | Verdict |
| --- | --- | --- | --- | --- |
| macOS arm64 | Executed and passed (5.0 s, 5.1 s, 4.0 s, 3.4 s) | Executed and passed (credits 2.9 s, resume 6.4 s, crash 7.2 s) | Passed | Qualified with stand-ins |
| macOS x64 | Executed and passed (14.2 s, 15.5 s, 11.2 s, 10.6 s) | Executed and passed (credits 7.4 s, resume 18.0 s, crash 19.1 s) | Passed | Qualified with stand-ins |
| Linux glibc x64 | Not exercised: each journey returns before it runs (under 2 ms) | Not exercised (under 2 ms) | Passed | Not qualified for coordinated runs |
| Linux glibc arm64 | Not exercised (under 3 ms) | Not exercised (under 1 ms) | Passed | Not qualified for coordinated runs |
| Windows x64 | Not exercised (under 3 ms) | Not exercised (under 4 ms) | Passed | Not qualified for coordinated runs; the single-session task journey over the named pipe passed (`tests/e2e/task-windows-e2e.test.mjs:139`, 15.7 to 19.9 s across the three gates) |

Quota suspension is therefore qualified with deterministic fakes on macOS only
(SSI-85), and no subscription was touched to produce any of this evidence.
