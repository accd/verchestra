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

- **macOS.** The full single-session `task` journey is qualified end to end
  only there. Linux has a qualified credential store (Secret Service) and the
  mediated profile, but its single-session journey is not yet qualified;
  without a running Secret Service session a `task` command reports
  `VES_TASK_NOT_CONFIGURED` (requirement `credential-store`). On Windows one
  single-session journey, from plan to accepted review, runs on the hosted
  Windows runner with deterministic stand-ins (the bridge uses a named pipe
  there); no run with a real Claude Code or Codex on Windows has been
  recorded yet. See [Windows prerequisites](#windows-prerequisites). The
  [coordinated](#coordinated-runs-agent-graph-and-swarm) journeys run with
  stand-ins on all three platforms.
- **`git`** on `PATH`, and a Git repository whose root you work from. `vestra
  task` runs git with a scrubbed environment: your shell's `GIT_DIR`,
  `GIT_CONFIG_*`, `GIT_EXEC_PATH`, and other `GIT_*` variables are not passed
  on, so they cannot redirect a task. Git still reads your configuration under
  your home directory or `XDG_CONFIG_HOME`, and `GIT_AUTHOR_*` and
  `GIT_COMMITTER_*` name and email variables still set the commit identity.
- **Claude Code** (`claude`, version 2.1.282 or later in the 2.x line) and the
  **Codex CLI** (`codex`, version 0.115.0 or later; 0.159.3 or later for a
  [coordinated run](#coordinated-runs-agent-graph-and-swarm)) on `PATH`.
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
  `protectedPaths` are refused even inside the scope. A protected path is
  refused in any letter case and however it is spelled (`src/vendor/`
  protects `src/vendor`), because the default macOS volume does not tell
  `SRC/Vendor` from `src/vendor`. A scope entry admits what it names in the
  letter case it is written: `src/` names `src`, `.` names the whole
  worktree, and `SRC/a` is outside a scope of `src`.
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
surface while writing nothing and reading no credential. A coordinated request
prints its topology and subscription preconditions as well; see
[Coordinated runs](#coordinated-runs-agent-graph-and-swarm).

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

`start` first checks that the Git worktrees the run needs fit the path length
Git accepts on this platform: the run's own worktree and its verification
checkouts, measured on the real path of your Workspace state directory. A
state directory too deep for them stops `start`, and `resume`, with
`VES_TASK_NOT_CONFIGURED` (requirement `state-path-length`) before the run is
read or changed. The check runs on every platform; Git's limit for a worktree
directory is 215 bytes on Windows, 979 on macOS, and 4051 on Linux, so in
practice only Windows reaches it (see
[Windows prerequisites](#windows-prerequisites)).

`start` then proves the credential of each provider's mode, both executables,
and the gate allowlist before it changes anything. It then:

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
  again. A coordinated run that was suspended, or that stopped while a node
  was running, has its own rules; see
  [Suspension and resume](#suspension-and-resume).

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

## Coordinated runs: agent, graph, and swarm

A coordinated run replaces the single implementer with several Claude Code and
Codex sessions, called nodes, inside the same governed task. You still approve
one sealed plan, the executor still checks every write against the scope,
protected paths, the capability grant, and Cedar authority, your gates still
run, Codex still verifies the commit independently, and you still review it.
No node's answer counts as verification.

> **Status:** coordinated runs are qualified with deterministic stand-ins for
> Claude Code, Codex, and each platform's credential store on macOS, Linux,
> and Windows: on each platform's hosted runner every mode runs from a plan to
> `HUMAN_REVIEW`, and cancel, suspension, resume, and a killed run are
> exercised. No run with a real subscription has been recorded yet on any
> platform. They are not in a published release yet: until a release that
> includes them is published, run these commands from a source checkout
> (`node <checkout>/apps/vestra-cli/bin/vestra.mjs` in place of
> `npx verchestra`). On Windows a run also needs the
> [Windows prerequisites](#windows-prerequisites).

### Three modes

- **`agent`** runs one node. It runs on Verchestra's own single-node engine
  and never loads the Strands Agents SDK.
- **`graph`** runs nodes in the order of their edges, with no cycle. A node can
  take earlier nodes' results as `inputs`.
- **`swarm`** starts at one node, and each node hands the work to one of the
  nodes it declares in `handoffs`, or ends the swarm.

`graph` and `swarm` are ordered by the Strands Agents SDK, at the version
Verchestra pins and loaded only for those runs; there is nothing to install
separately. The SDK only orders the nodes: it never calls a model, reads a
credential, or runs a tool. Every node is a Claude Code or Codex session that
Verchestra starts and governs.

A **writer** is a Claude Code node with a non-empty `writeScope`; every other
node only reads, and a Codex node never writes. Two writers never run at the
same time, and a graph must order every two writers by a path.

### Write a coordinated request

A coordinated request is a Task Request with `"schemaVersion": 2`. It has the
same `task`, `gates`, `budgets`, `verifier`, and `instructions` as a
single-session request, no top-level `driver`, and an `execution` member that
describes the nodes. The repository ships one complete example per mode, all
for the change the request in step 5 makes:

- [`docs/examples/task-request-agent.json`](examples/task-request-agent.json):
  one Claude Code writer.
- [`docs/examples/task-request-graph.json`](examples/task-request-graph.json):
  a Codex node plans, a Claude Code node writes the change with the plan as
  input, and a Codex node reviews it.
- [`docs/examples/task-request-swarm.json`](examples/task-request-swarm.json):
  a Claude Code writer and a Codex reviewer hand the work to each other until
  the reviewer ends it.

Replace `sourceRevision` with `git rev-parse HEAD` before you plan. Each node
names its `nodeId` (lowercase, up to 32 characters), its `driver` and model,
a `description`, its `instructions`, a `readScope` and a `writeScope` inside
the task's `changeScope` (a write scope may not cover a protected path), and
its `inputs`. The request cannot name an authentication method, a credential,
a billing mode, an executable, or an endpoint. The canonical contract is
[`schemas/task-request/2.schema.json`](../schemas/task-request/2.schema.json).

### Limits

`execution.limits` bounds the run. A limit you leave out takes its default; a
limit you declare may be lower, or higher up to its ceiling, and is part of
what you approve. A value above its ceiling is refused at planning with
`VES_TASK_REQUEST_REJECTED` (reason `VES_TASK_REQUEST_EXECUTION_INVALID`).

| Limit | Default | Ceiling | Bounds |
| --- | --- | --- | --- |
| `concurrency` | 1 | 4 | Nodes that run at once; only readers ever run together |
| `maxNodes` | 64 | 256 | Nodes of a graph |
| `maxEdges` | 128 | 512 | Edges of a graph |
| `maxSwarmAgents` | 8 | 16 | Nodes of a swarm |
| `maxHandoffs` | 32 | 128 | Handoffs in a swarm; one more pending fails the run (`VES_COORDINATION_HANDOFF_LIMIT`) |
| `nodeResultBytes` | 65536 (64 KiB) | 262144 (256 KiB) | One node's structured result |
| `runResultBytes` | 262144 (256 KiB) | 1048576 (1 MiB) | All node results of the run, every visit counted |

A result over its bound is refused before it is stored and fails its node
(`VES_COORDINATION_RESULT_TOO_LARGE`). The task's `budgets` bound all nodes
and the verifier together: tokens and active time add up across nodes and
across resumes, and time spent suspended is not counted.

### Subscriptions only, with extra usage off

A coordinated run uses your subscriptions and nothing else. Both providers
must authenticate by subscription, as set up in step 3: a run with either
provider on an API key is refused with `VES_TASK_NOT_CONFIGURED` (requirement
`coordinated-run-subscription`). Each session proves its method again when it
starts: Claude Code must report no API key source, and Codex, in a node and in
the final verifier alike, must report a ChatGPT login.

Verchestra cannot read whether a provider account may spend beyond the plan,
so it asks you to state it, after you have turned that spending off:

1. **In your Claude account**, open the usage settings (Settings > Usage) and
   turn off usage credits and any auto-reload, so Claude Code stops when the
   plan's allowance is used instead of continuing on paid usage.
2. **In your ChatGPT account**, do not keep purchased Codex credits. A Codex
   session whose account reports a credit balance, or unlimited credits, does
   not start its turn, whether it is a node or the final verifier: the run is
   suspended (in `IMPLEMENTING` at a node, in `VERIFYING` at the verifier) and
   `start` reports `VES_TASK_NOT_CONFIGURED` (requirement `codex-credits`).
   Remove the credits, then resume.
3. **Write your statement** by hand, beside `task-providers.json`:

```text
~/Library/Application Support/Verchestra/state/workspaces/<workspaceId>/task-billing.json
```

```json
{
  "schemaVersion": 1,
  "providers": {
    "claude-code": { "auth": "subscription", "extraUsage": "disabled", "confirmedAt": "2026-10-04T09:00:00Z" },
    "codex": { "auth": "chatgpt", "planType": "plus", "extraUsage": "disabled", "confirmedAt": "2026-10-04T09:00:00Z" }
  }
}
```

The file holds exactly these members and nothing else: no token, account ID,
e-mail address, name, or path.

- `auth` is the method the provider's sessions prove: `subscription` for
  Claude Code and `chatgpt` for Codex.
- `extraUsage` is `disabled`, your statement that the account cannot spend
  beyond its plan.
- `confirmedAt` is the UTC time you checked the account, written as
  `YYYY-MM-DDTHH:MM:SSZ`. It cannot be in the future or before the start of
  the provider's current billing terms as this build records them
  (2026-06-16 for Claude Code, 2026-10-03 for Codex). A build that records new
  terms asks you to check and confirm again.
- `planType`, for Codex only, is your ChatGPT plan as the Codex protocol
  names it, one of `free`, `go`, `plus`, `pro`, `prolite`, `promax`, `team`,
  `self_serve_business_prolite`, `self_serve_business_usage_based`,
  `business`, `ent26`, `enterprise_cbp_automation`,
  `enterprise_cbp_usage_based`, `enterprise`, `edu`, `edu_plus`, or `edu_pro`.
  Any other value is refused. At every `start` and `resume` Verchestra
  compares it with the plan type your Codex login reports; write the statement
  again when your plan changes.

Verchestra never writes this file, and a request can never supply it. It has
no expiry. Both providers need an entry, because every coordinated run has a
Claude Code writer and the Codex verifier. `start` and `resume` read it before
any credential, transition, or worktree; a missing, unreadable, or
non-matching statement is `VES_TASK_NOT_CONFIGURED` (requirement
`extra-usage-confirmation`), and the terminal shows the file's exact path and
the entries it needs.

To compare the plan type, every `start` and `resume` of a coordinated run
launches one extra Codex process, from the Workspace's Codex sign-in, after
that sign-in is checked and before the run's first step. It asks only for the
account: it lists no model and starts no thread or turn, so it spends nothing
of your allowance, and nothing of the account but its plan type is kept.

What `start` and `resume` of a coordinated run may refuse, before the run's
first step, and what you do about it:

| Requirement | What to do |
| --- | --- |
| `coordinated-run-subscription` | Set both providers to `subscription` in `task-providers.json`, or remove the file (step 3). |
| `extra-usage-confirmation` | Turn extra usage off in both accounts, then write or correct `task-billing.json` as above. The terminal names what is missing or wrong; for a plan type, it names the plan your Codex login reports and the one the file names. |
| `codex-login` | Sign Codex in with ChatGPT for this Workspace, with the command the terminal prints (step 3). |
| `codex-version` | Update the Codex CLI to 0.159.3 or later, the first build whose protocol reports the account. |
| `codex-account` | Codex did not report the account of its sign-in, in time or at all, or reported one that is not a ChatGPT login. Check `codex login status` with the Workspace's `CODEX_HOME`, sign in again if needed, and retry. |
| `codex-credits` | Remove the purchased credits from the ChatGPT account, then resume. This one is reported after the run is suspended, by the session that saw the credits. |

### Plan, start, and status

The commands are the same as for a single-session run. For a coordinated
request:

- `plan` prints, beside `execution` (the whole descriptor your approval binds,
  every limit explicit), a `coordination` member: the mode, a swarm's start,
  and each node with its passport (`<driver>:<model>`), its role (`writer` or
  `reader`), and the nodes its work goes to next. It also prints
  `subscription`: the method each provider must prove, the statement file, and
  `preflight`, which is `ready` or the requirement `start` would refuse now.
  Planning refuses nothing for it; `start` and `resume` check again.
- `start` runs the nodes inside one executor run, then your gates, the
  verifier, and review, as in steps 8 to 10. Its result also carries the run's
  `coordination`, as `status` shows it.
- `status` prints `coordination`: each node's state (`pending`, `started`,
  `completed`, `failed`, `partial`, or `uncertain`), its number of visits, and
  the digest of its latest result, and `uncertain`, the nodes a resume cannot
  run again on its own. A suspended run also shows `suspension`.

The text output and `--output json` print the same members with the same
values; the text form shows a nested member as compact JSON.

### Suspension and resume

When a provider reports that your plan's allowance is used up, the run is
suspended instead of failing. No further node starts, the nodes still running
are stopped, and their provider processes end. Completed node results, tool
receipts, the node record, the usage so far, and the worktree are all kept.
The run stays `IMPLEMENTING` and releases the Workspace writer lease. When it
is the final verifier's Codex allowance that is used up, the run is suspended
the same way after its task commit: it stays `VERIFYING`, keeps the commit on
its branch `vestra/<runId>/<taskId>`, and a resume runs the verifier again. `start`
exits 1 with `status: SUSPENDED` and a `suspension` that names the reason
(`VES_DRIVER_QUOTA_EXHAUSTED`), the provider, the time, and, when the provider
reported them, its limit window (`scope`, for example `five_hour`) and the
time it resets (`resetsAt`). Its `next` is the command that continues the run.

Verchestra never continues a suspended run on its own. It does not retry at
the reset time and never switches account, provider, model, or authentication
method. When your allowance is back, resume it yourself:

```bash
npx verchestra task resume --run-id <runId>
```

Before any node or verifier starts, `resume` checks the subscription
preconditions, your statement, and your Codex plan type again, that the
approval is still valid under the Workspace policy in force, and that what the
run left is exactly as it left it: the worktree for a run suspended at a node,
the task commit and its branch for a run suspended at the verifier. An
approval lasts seven days; one that expired while the run was suspended is
refused, and you plan the task again. A worktree that changed is refused with
reason `VES_EXECUTOR_WORKTREE_DRIFT`, and a task commit or branch that moved
with reason `VES_TASK_COMMIT_DRIFT`. A refusal changes nothing, so you can
put things right and resume again, or cancel. The resumed run reuses every
completed node's result without starting it again, and runs again a node that
stopped before it changed anything.

**A node that may have changed the worktree.** A node that had started and
has no recorded end (for example, the process driving the run was killed), or
a writer stopped after one of its writes landed (`partial`), may have left
effects. `resume` refuses it with `VES_TASK_FAILED` (reason
`VES_TASK_NODE_UNCERTAIN`) and prints the node and the command that runs it
again. `status` shows the same node under `coordination.uncertain` with the
digest of its record, and that command as the next action. Inspect the run's
worktree first (`git worktree list` names it). To run that node again on the
worktree as it is now, type its digest back:

```bash
npx verchestra task resume --run-id <runId> --reconcile <sha256:…>
```

A digest that names no such node is refused with reason
`VES_TASK_RECONCILE_UNMATCHED`. A resume reconciles one node; if two nodes are
uncertain, no resume can pass, and `status` offers only `vestra task cancel`.
`cancel` of a suspended run removes its worktree and ends it `ABORTED`.

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

## Windows prerequisites

On Windows the bridge between Claude Code and Verchestra is a named pipe that
only your user can open, owned by a fixed PowerShell 7 helper. Before a run
takes its first step, and before it reads any credential, `vestra task` checks
each prerequisite and, if one is missing, stops with `VES_TASK_NOT_CONFIGURED`
and names it:

| Requirement | What to do |
| --- | --- |
| `powershell-7` | Install PowerShell 7 at its default location, `C:\Program Files\PowerShell\7\pwsh.exe`. Verchestra never looks it up on `PATH`. |
| `powershell-logging-off` | Turn off PowerShell 7 script-block logging and transcription for your account; they would record the helper's traffic. |
| `owner-only-acl` | Verchestra could not prove that its per-run directory is readable by your user alone. Run from a local, NTFS-formatted profile. |
| `claude-managed-policy` | A Claude Code managed policy is present (`C:\Program Files\ClaudeCode\`, or `HKLM` or `HKCU` `SOFTWARE\Policies\ClaudeCode`). The governed task path does not run under a managed policy, whether Claude Code signs in with your subscription or an API key. |
| `state-path-length` | Your Verchestra state directory (`%LOCALAPPDATA%\Verchestra\state`) is too deep for the worktree paths Git accepts on Windows. With the default location this happens only for user names longer than about 50 characters. There is no setting to move the state directory yet, so this stops the run. |

Claude Code and Codex must be their native `claude.exe` and `codex.exe`
builds on `PATH`; the `.cmd` shims an npm install creates are refused as not
configured. Inside its own worktrees Verchestra runs Git with
`core.longpaths=true`; your own Git configuration is not changed.

## Limits of this qualification build

- **macOS end to end.** The single-session journeys run end to end with
  stand-ins on macOS, and one of them, from plan to accepted review over the
  named pipe, on the hosted Windows runner; on Linux the single-session path
  is qualified in parts only (credential store and mediated profile). The
  coordinated journeys run with stand-ins on macOS, Linux, and Windows. A
  real-provider run on Windows or Linux is still to be recorded.
- **One implementer and one verifier.** Claude Code implements through the
  mediated MCP bridge; Codex verifies. They must differ, and they cannot be
  swapped. A coordinated request runs several Claude Code and Codex nodes in
  the implementer's place, on subscriptions only, with the same single
  verifier; see [Coordinated runs](#coordinated-runs-agent-graph-and-swarm).
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
  state (`VES_TASK_STATE_INVALID`) and is never replaced. A verification
  checks the task commit out below `verification/<id>/r` (the review
  checkout) and `verification/<id>/m` (the mutation checkouts), where `<id>` is
  the first 16 hex digits of the SHA-256 digest of the run ID, and removes
  them when it ends. Earlier builds used `verification/<runId>/review` and
  `verification/<runId>/mutations`; the shorter paths keep the checkouts
  within Git's path limit on Windows, and they apply on every platform.
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
