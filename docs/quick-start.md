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

- **macOS.** It is the only platform with a qualified credential store and the
  qualified mediated Claude Code profile. Elsewhere every `task` command that
  needs a credential reports `VES_TASK_NOT_CONFIGURED`.
- **`git`** on `PATH`, and a Git repository whose root you work from.
- **Claude Code** (`claude`, version 2.1.282 or later in the 2.x line) and the
  **Codex CLI** (`codex`, version 0.115.0 or later) on `PATH`.
- An **Anthropic API key** and an **OpenAI API key**.
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

## 3. Bind the three credentials

Each value is read from standard input without echo, stored in your macOS
keychain under the service `verchestra/<workspaceId>`, and never printed.

```bash
npx verchestra secret set --name anthropic-api-key
npx verchestra secret set --name openai-api-key
npx verchestra secret set --name evidence-signing-passphrase
```

- `anthropic-api-key` is injected only into the Claude Code child process.
- `openai-api-key` is injected only into the Codex child process.
- `evidence-signing-passphrase` unlocks the Workspace evidence key, which is
  created on first use and seals the Execution Package, the approval, and the
  run capsule. Choose a long random value and keep it; without it the key
  cannot be unlocked.

Add `--keychain <path>` to any `secret` or `task` command to use a keychain
file you own instead of your default keychain.

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
- Models must be priced in the release's model price table; an unpriced model
  is refused at planning, before any cost.
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
`bindingDigest` your approval will bind. Add `--dry-run` to print the same
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

`start` proves both provider credentials, both executables, and the gate
allowlist before it changes anything. It then:

1. creates an isolated Git worktree at `sourceRevision`;
2. runs Claude Code in that worktree with no built-in tools; every write goes
   through the Verchestra bridge, and the executor re-checks scope, protected
   paths, the capability grant, and Cedar authority before it happens;
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
  is removed; an anchored task branch is kept.
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

- **macOS only.** Linux and Windows report `not configured`.
- **One implementer and one verifier.** Claude Code implements through the
  mediated MCP bridge; Codex verifies. They must differ, and they cannot be
  swapped.
- **Budgets.** Token and cost ceilings are checked when a provider reports
  usage, and Claude Code reports at the end of its session, so a single
  session can overshoot them. The duration ceiling is enforced by a timer and
  is the hard guard.
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
- **One writer per Workspace.** A running task holds the Workspace writer
  lease; a second run is refused until the first one ends. If the process of
  a run dies, `resume` or `cancel` that run to release the lease; otherwise it
  expires one hour after the run's duration ceiling.
