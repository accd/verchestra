# Quick start: deliver one governed task

This guide takes one change from a request file to a reviewed commit on a task
branch in your repository. Claude Code implements the change, Codex verifies it
independently, and you approve before it starts and review before it counts.
Verchestra never merges: the result is a branch you inspect and merge yourself.

> **Status:** `0.0.0-qualification`. The governed task path is qualified with
> deterministic stand-ins for Claude Code and Codex (see
> [Limits](#limits-of-this-qualification-build)). The supervised live pilot is
> tracked as [issue #406](https://github.com/accd/verchestra/issues/406). This
> is not a production release and not 1.0.

## What you need

- **macOS.** The full `task` journey is qualified end to end only there.
  Linux has a qualified credential store (Secret Service) and the mediated
  profile, but its full journey is not yet qualified; without a running
  Secret Service session a `task` command reports `VES_TASK_NOT_CONFIGURED`
  (requirement `credential-store`). On Windows every `task` command reports
  `VES_TASK_NOT_CONFIGURED` (requirement `platform`) before any effect.
- **`git`** on `PATH`, and a Git repository whose root you work from. `vestra
  task` runs git with a scrubbed environment: your shell's `GIT_DIR`,
  `GIT_CONFIG_*`, `GIT_EXEC_PATH`, and other `GIT_*` variables are not passed
  on, so they cannot redirect a task. Git still reads your configuration under
  your home directory or `XDG_CONFIG_HOME`, and `GIT_AUTHOR_*` and
  `GIT_COMMITTER_*` name and email variables still set the commit identity.
- **Claude Code** (`claude`, version 2.1.282 or later in the 2.x line) and the
  **Codex CLI** (`codex`, version 0.115.0 or later) on `PATH`.
- A **Claude subscription** (Pro, Max, Team, or Enterprise) and a **ChatGPT
  plan that includes Codex**. This is the default. An Anthropic API key and an
  OpenAI API key work instead; see
  [Use API keys instead](#use-api-keys-instead-optional).
- **Node** only as far as `npx` needs it. The activated release carries its own
  Node runtime.

## 1. Install

```bash
npx verchestra --version
```

The package provides two equivalent binaries, `verchestra` and `vestra`. The
first run verifies and activates the pinned release; later runs start in a few
seconds.

Always invoke it through the `verchestra` package name, as this guide does.
`vestra` is only a binary inside that package: a bare `npx vestra` outside an
install asks the registry for an unrelated package named `vestra`, which
Verchestra does not own.

## 2. Initialize the Workspace

Run this from the root of your repository. A Workspace ID is `workspace_`
followed by a version 4 or 7 UUID.

```bash
cd ~/src/my-repo
npx verchestra init --workspace-id "workspace_$(node -e 'console.log(crypto.randomUUID())')" \
  --name "My repository" --placement colocated
```

`init` writes `.verchestra/` metadata into the repository. It changes nothing
else.

## 3. Sign in the two providers and bind the signing passphrase

A Workspace authenticates both providers through your subscriptions unless you
tell it otherwise. Three one-time steps set that up. Verchestra never uses the
Claude Code or Codex session you are logged in to day to day: each provider
child gets its own isolated home, and a missing credential is reported as not
configured instead of falling back to that session.

**Claude Code.** Mint a long-lived subscription token and bind it:

```bash
claude setup-token
npx verchestra secret set --name claude-code-oauth-token
```

`claude setup-token` opens the browser sign-in and prints a token that is valid
for about a year. It does not save it. Paste the token at the hidden prompt of
`secret set`, or pipe it in (for example `pbpaste | npx verchestra secret set
--name claude-code-oauth-token`); one trailing newline is stripped. Do not put
the token in a file or a shell profile. It is stored in your macOS keychain
under the service `verchestra/<workspaceId>`, is never printed, and is injected
only into the Claude Code child process, as `CLAUDE_CODE_OAUTH_TOKEN`.

**Codex.** Sign in once into the Workspace's own Codex identity directory:

```bash
CODEX_IDENTITY="$HOME/Library/Application Support/Verchestra/state/workspaces/<workspaceId>/codex-identity"
mkdir -p "$CODEX_IDENTITY" && chmod 700 "$CODEX_IDENTITY"
CODEX_HOME="$CODEX_IDENTITY" codex login -c 'cli_auth_credentials_store="file"'
CODEX_HOME="$CODEX_IDENTITY" codex login status   # Logged in using ChatGPT
```

This is a separate login from the one in `~/.codex`, which is never read. The
Codex credential stays in that directory as a file and never enters the
keychain. Verchestra pins the directory's `config.toml` to the file store and
to the ChatGPT login, so an API-key login there counts as not signed in. If you
skip this step, `task start` reports `VES_TASK_NOT_CONFIGURED` (requirement
`codex-login`) before it changes anything and prints the login command with
the exact path.

**Evidence signing passphrase.**

```bash
npx verchestra secret set --name evidence-signing-passphrase
```

`evidence-signing-passphrase` unlocks the Workspace evidence key, which is
created on first use and seals the Execution Package, the approval, and the
run capsule. Choose a long random value and keep it; without it the key
cannot be unlocked.

Add `--keychain <path>` to any `secret` or `task` command to use a keychain
file you own instead of your default keychain.

### Use API keys instead (optional)

The credential of each provider is a machine-local setting beside the gate
allowlist. A task request cannot select it.

```text
~/Library/Application Support/Verchestra/state/workspaces/<workspaceId>/task-providers.json
```

```json
{
  "schemaVersion": 1,
  "providers": {
    "claude-code": { "auth": "api-key" },
    "codex": { "auth": "api-key" }
  }
}
```

Each provider is `subscription` or `api-key`; a provider you leave out stays on
`subscription`. Bind the key of each provider you switch:

```bash
npx verchestra secret set --name anthropic-api-key
npx verchestra secret set --name openai-api-key
```

`anthropic-api-key` is injected only into the Claude Code child process and
`openai-api-key` only into the Codex child process. A run reads only the
credentials its modes name.

## 4. Allowlist the gate commands

A task request names its gates by a `commandRef`, never by an executable. The
executables live in one machine-local file that only you write:

```text
~/Library/Application Support/Verchestra/state/workspaces/<workspaceId>/task-gates.json
```

```json
{
  "schemaVersion": 1,
  "commands": {
    "node": { "executable": "/opt/homebrew/bin/node", "protocols": ["exit-code", "test-summary"] }
  }
}
```

Use absolute paths (`command -v node` prints one). `fixedArgs` is optional and
is prepended to every invocation. A gate runs in the isolated task worktree
with a minimal environment (`PATH`, `HOME`, temporary directories, `CI=1`).

## 5. Write a task request

The request is untrusted input. It names what to change and how to judge it,
and nothing else: no identity, digest, executable path, credential, or
approval. Save it as `task-request.json` outside the repository or leave it
untracked.

```json
{
  "schemaVersion": 1,
  "sourceRevision": "0123456789abcdef0123456789abcdef01234567",
  "task": {
    "taskId": "T1",
    "requirementIds": ["VES-EXE-001"],
    "dependencyTaskIds": [],
    "component": "src",
    "changeScope": ["src", "test"],
    "protectedPaths": [".git", ".verchestra"],
    "verificationCommands": ["node --test test"],
    "doneCriteria": ["parseDuration accepts 1h30m and rejects negative values"],
    "risk": "medium",
    "expectedCommitBoundary": "feat(src): parse hour-minute durations"
  },
  "gates": [
    {
      "gateId": "gate:unit",
      "requirementIds": ["VES-EXE-001"],
      "declaredCommand": "node --test test",
      "commandRef": "node",
      "args": ["--test", "test"],
      "cwd": ".",
      "timeoutMs": 300000,
      "outputLimitBytes": 1000000,
      "resultProtocol": "test-summary",
      "minimumTests": 1
    }
  ],
  "budgets": { "maximumCostUsd": 5, "maximumTokens": 2000000, "maximumDurationMs": 1800000 },
  "driver": { "driverId": "claude-code", "model": "claude-sonnet-5" },
  "verifier": { "driverId": "codex", "model": "gpt-5.2-codex" },
  "instructions": "Extend parseDuration in src/duration.js to accept hour-minute strings such as 1h30m, and add tests in test/duration.test.js. Keep the existing API."
}
```

- `sourceRevision` is the exact commit to start from: `git rev-parse HEAD`.
- `changeScope` lists the only paths the implementer may write;
  `protectedPaths` are refused even inside the scope.
- The gates must cover every entry of `verificationCommands` exactly, and every
  requirement ID.
- Models must be listed in the release's model price table; a model that is
  not is refused at planning, before any cost. On a subscription the table is
  only the list of supported models: nothing is priced.
- An optional `onGateFailure` (`maxAttempts`, `feedbackToDriver`,
  `escalateAfter`) declares a bounded repair loop.

The canonical contract is
[`schemas/task-request/1.schema.json`](../schemas/task-request/1.schema.json).

## 6. Plan

```bash
npx verchestra task plan --request task-request.json
```

Planning compiles the repository context at `sourceRevision`, seals the
Execution Package, creates the run, and prints the approval surface: scope,
protected paths, destinations, models, budgets, gates, risk, and the
`bindingDigest` your approval will bind. It also prints `providerAuth`, the
credential mode each provider will use. Add `--dry-run` to print the same
surface while writing nothing and reading no credential.

## 7. Approve

```bash
npx verchestra task approve --run-id <runId> --binding-digest <sha256:…>
```

In a terminal you are asked to type the binding digest back. The approval is
recorded only if it matches, the package on disk is unchanged, and the
Workspace policy is the one the plan bound. For a script, the explicit,
non-default `--confirm-stdin` flag reads the digest from standard input
instead; it never happens by accident.

## 8. Start

```bash
npx verchestra task start --run-id <runId>
```

`start` proves the credential of each provider's mode, both executables, and
the gate allowlist before it changes anything. It then:

1. creates an isolated Git worktree at `sourceRevision`;
2. runs Claude Code with no built-in tools; every read and write of that
   worktree goes through the Verchestra bridge, and the executor re-checks
   scope, protected paths, the capability grant, and Cedar authority before a
   write happens. On a subscription Claude Code itself runs in an empty
   directory, so it never loads the repository's own `CLAUDE.md`, `AGENTS.md`,
   or `.claude/` settings;
3. runs your gates, commits the change atomically, and anchors it on
   `vestra/<runId>/<taskId>`;
4. runs Codex read-only over a checkout of that commit, then checks its claims
   itself: the cited test lines must exist at the commit, and reverting the
   named implementation file must make your gates fail;
5. stops in `HUMAN_REVIEW` and prints the review surface digest.

Your own checkout, index, and working tree are not touched at any point.

## 9. Status, cancel, and resume

```bash
npx verchestra task status --run-id <runId>
npx verchestra task cancel --run-id <runId>
npx verchestra task resume --run-id <runId>
```

- `status` prints the durable state, the checkpoints, the evidence
  references, and the next allowed actions.
- `cancel` stops a running `start` from another terminal (Ctrl-C in the
  running terminal does the same) and aborts the run. An uncommitted worktree
  is removed; an anchored task branch is kept. When no process is driving the
  run and its worktree cannot be removed (for example it holds history that is
  not the one verified task commit), `cancel` fails with `VES_TASK_FAILED`
  naming the reason and leaves the run as it was, instead of reporting a stop
  that left the worktree behind. A worktree that is already gone does not stop
  the cancel.
- `resume` continues an interrupted run. A run interrupted after the
  implementer finished resumes at its gates without starting the implementer
  again.

## 10. Review

```bash
npx verchestra task review --run-id <runId> --outcome accepted --surface-digest <sha256:…>
```

You type the surface digest back, as for the approval. `accepted` completes the
run and seals its run capsule. `rejected` records your decision, aborts the
run, and keeps the branch for inspection.

Before it asks for the digest, `review` checks that the package on disk is
still the one the plan bound, as `approve` does. If it is not, `review` stops
with `VES_TASK_STATE_INVALID` (reason `VES_TASK_PACKAGE_INVALID`), records
nothing, and leaves the run in `HUMAN_REVIEW`.

## 11. Inspect and merge it yourself

```bash
git log --stat <sourceRevision>..vestra/<runId>/<taskId>
git diff <sourceRevision>..vestra/<runId>/<taskId>
git merge --ff-only vestra/<runId>/<taskId>   # when you are satisfied
git branch -d vestra/<runId>/<taskId>          # when you are done with it
```

Verchestra never merges, pushes, or opens a pull request.

## Narrow authority for a Workspace (optional)

`.verchestra/policy/task-authority.json` adds Cedar `forbid` policies on top of
the built-in task policy. It can only narrow authority; a `permit` is refused.

```json
{
  "schemaVersion": 1,
  "forbid": {
    "noCriticalStart": "forbid(principal, action == Vestra::Action::\"task-start\", resource) when { context.risk == \"critical\" };"
  }
}
```

The policy view digest is part of what you approve: changing this file after
approval makes the approval stale, and the run is refused until you plan again.

## Limits of this qualification build

- **macOS end to end.** Linux is partially qualified (credential store and
  mediated profile). Windows is refused as a platform before any effect.
- **One implementer and one verifier.** Claude Code implements through the
  mediated MCP bridge; Codex verifies. They must differ, and they cannot be
  swapped.
- **Budgets.** Token and cost ceilings are checked when a provider reports
  usage, and Claude Code reports at the end of its session, so a single
  session can overshoot them. The duration ceiling is enforced by a timer and
  is the hard guard. The ceilings are the run's: the implementer and the
  verifier spend from the same ones, and the usage `status` prints under
  `checkpoints.budget`, which the run capsule seals, is the total of both.
  Usage is recorded when a provider reports it, so a run that is killed keeps
  what was reported until then, and `resume` adds to that total what the
  resumed run spends: a provider session that runs again is counted again,
  because it was spent again. What was never reported cannot be recorded: a
  provider session that is killed before it ends has reported no usage, so the
  total leaves out what that session spent. A verifier is not started when a
  ceiling was already reached. A run a ceiling stops fails with reason
  `VES_EXECUTOR_BUDGET_EXCEEDED`, whichever provider reached it, and
  `checkpoints.budget.stopReason` names the ceiling. On a subscription nothing
  is billed per token: the token and duration ceilings still apply, `status`
  shows the cost as `not billed (subscription)`, and the run capsule carries
  no cost. With one provider on a subscription and the other on an API key,
  `status` shows `billing: mixed`: the cost of the billed provider's tokens
  beside the count of tokens that were not billed. Your plan's own usage
  limits are not metered; a run that hits one fails closed and can be resumed
  or planned again.
- **Subscription isolation.** The subscription path cannot use Claude Code's
  `--bare` mode, which reads only an API key. It rebuilds that isolation from
  named switches and adds fail-closed checks, described in
  [docs/qualification/claude-code-driver-subscription.md](qualification/claude-code-driver-subscription.md).
  A machine that carries a managed Claude Code policy is refused with
  `VES_CLAUDE_MANAGED_POLICY_PRESENT`. None of this has been observed with a
  real subscription yet.
- **Provider processes.** Claude Code and Codex each run in a process group of
  their own. `cancel` and Ctrl-C stop everything a provider started, including
  a process that left that group, as described in
  [docs/qualification/claude-code-driver-process-tree.md](qualification/claude-code-driver-process-tree.md)
  and
  [docs/qualification/codex-driver-process-tree.md](qualification/codex-driver-process-tree.md).
  A provider whose session ends without a stop is ended the same way: when its
  output is not what Verchestra expects, when it exceeds its output limit, and
  when the verifier's turn completes
  ([Claude Code](qualification/claude-code-driver-provider-ends.md),
  [Codex](qualification/codex-driver-provider-ends.md)).
  A closed terminal or a `kill` of `vestra` while a provider is running also
  stops everything the provider started, and then ends `vestra` without
  aborting the run: `task resume` continues it. If a provider's processes
  could not be confirmed stopped, `vestra` says so on stderr and prints the
  command that stops them. One case is not handled: when `vestra` itself is
  killed with `SIGKILL`, nothing stops the provider, and it runs until its
  closed pipes make it exit. Stop it with `kill -KILL -- -<pid>`, where
  `<pid>` is the process id of the `claude` or `codex` process (it is also the
  id of its process group); `task status` then shows the run as not active,
  and `task resume` or `task cancel` continues or ends it. All of this is
  proven with deterministic stand-ins only.
- **Local human authority.** Approvals and reviews are decisions confirmed on
  this machine by typing a digest back. They are not a cryptographic proof of
  who you are.
- **Live pilot pending.** The journeys are qualified with deterministic
  stand-ins for Claude Code and Codex. Live-provider evidence is the separate
  [#406](https://github.com/accd/verchestra/issues/406) pilot.
- **Verification failure.** A failed verification leaves the run in
  `REPAIRING`; automated repair after verification is not implemented. Cancel
  the run, and plan a new task.
- **Interruption during implementation.** A run interrupted while Claude Code
  is still working resumes by starting a new implementer session in the same
  worktree; writes it re-issues get new receipts. Only a run interrupted after
  the implementer finished resumes without repeating its effects.
- **Task state stays inside the Workspace state directory.** `vestra task`
  keeps its run records, its evidence key, and its verification checkouts in
  `tasks`, `keys`, and `verification` beside `task-gates.json`. If one of them
  is a link that leads outside that directory, every `task` command, a dry run
  included, stops with `VES_STATE_ROOT_ESCAPE` before it writes anything
  there. Remove the link. The same code stops a command when a run's own
  directory under `tasks` or `verification`, or a directory inside it, is a
  link, wherever the link leads: nothing is read, written, or deleted through
  it. A link in the place of a single state file is refused as unreadable
  state (`VES_TASK_STATE_INVALID`) and is never replaced.
- **Run state is sealed.** Every record in a run's directory carries a digest
  of its content, and a command that finds an edited one stops with
  `VES_TASK_STATE_INVALID`. From this build on that includes the five small
  marker files (`grant.json`, `active.json`, `worktree.json`, `cancel.json`,
  `outcome.json`); a run planned by an earlier build keeps its unsealed
  markers and still resumes. `cancel` is the exception that keeps working: if
  the marker that names the driving process does not verify, `status` shows
  the run as active, `start` and `resume` report `VES_TASK_RUN_ACTIVE`, and
  `cancel` waits up to a minute for a driver to stop and then ends the run
  itself. The seal detects an edit; it is not a signature.
- **One writer per Workspace.** A running task holds the Workspace writer
  lease; a second run is refused until the first one ends. If the process of
  a run dies, `resume` or `cancel` that run to release the lease; otherwise it
  expires one hour after the run's duration ceiling.
