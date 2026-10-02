# Claude Code Driver Requalification: Process-Tree Termination

**Task:** ADP-4 (T4d) of `.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, a
platform matrix run on the branch, and the owner's first supervised run
**Installed Claude Code observed:** none for this change. Nothing here ran a
real Claude Code process, and no model was invoked. What changed is how
Verchestra starts and stops the child process, not what it asks of it.
**Supersedes:** nothing. `docs/qualification/claude-code-driver.md` (T03
profile), `docs/qualification/claude-code-driver-mediated.md` (`mediated-mcp`),
and `docs/qualification/claude-code-driver-subscription.md`
(`mediated-mcp-subscription`) remain the evidence for each profile's
invocation. The arguments, environment, working directory, isolation
directory, and stream checks of all three profiles are unchanged.

## Why the driver is requalified

Stopping a session used to signal one process: the `claude` process the driver
started. Two things followed.

- Anything that process had started kept running after a cancel. In the
  mediated profiles that includes the MCP bridge relay.
- A descendant that inherited the provider's output kept that pipe open. The
  driver waits for the pipe to close before a session ends, so the session,
  and with it `vestra task cancel`, waited for as long as the descendant
  lived.

Requirement ADP-4 says that cancelling a Claude Code session terminates its
whole process tree.

## What changed

- **Process group.** On macOS and Linux the driver starts `claude` with
  `detached`, so the child leads a process group and a session of its own.
  On Windows the spawn is unchanged; Windows has no process groups.
- **Fallback terminator.** A composition that injects no terminator used to
  signal the one process with `SIGTERM`. It now sends `SIGTERM` to the
  provider's group (to the one process on Windows). A fallback that finds
  nothing left to stop no longer rejects.
- **One termination per child.** A stream that keeps failing asks to stop the
  child once for every line still in the pipe. The driver now starts one
  termination per child on that path and awaits it.
- **Injected terminator.** `ClaudeCodeDriverDependencies.terminateTree` is
  unchanged in shape. The `vestra task` composition used to inject a `SIGKILL`
  of the one process. It now injects the tree terminator of
  `packages/platform-node/src/process-tree-terminator.ts`
  (`terminateProcessTree`): it records the provider's descendants from the
  process table, sends `SIGKILL` to the provider's group, confirms that the
  group is gone, and then kills every recorded descendant, which reaches one
  that left the group with `setsid()`. The driver package still imports
  nothing from `platform-node`.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` runs against the labeled deterministic fake
`spikes/claude-code-driver/test/fake-claude.mjs` in its `fork` mode. In that
mode the fake announces a session, starts one idle process that stays in its
process group and inherits its output, starts one idle process that leaves the
group with `setsid()`, names all three processes, and never answers.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-process-tree.test.mjs`. The
terminator in these cases is the one the task composition injects. On macOS
and Linux:

- Before anything is stopped, the provider leads a process group that is not
  the caller's, the first descendant is in that group, and the second is not.
- A cancel ends the run and leaves none of the three processes alive. The run
  ending is itself evidence: with only the provider killed, the descendant
  that holds its output would keep the run waiting.
- An aborted start signal does the same, and the session closes as cancelled.
- With no terminator injected, a cancel still stops the provider and the
  descendant in its group. The descendant that left the group survives the
  fallback. That is what the fallback cannot reach and why the task
  composition always injects the tree terminator.

On Windows the same three cases assert what holds there: a stopped session
ends, its terminal event says cancelled, and the provider process is gone.
The mediated profiles are still refused on Windows before any process starts.

Also covered:

- `tests/integration/process-tree-termination.test.mjs` runs the terminator
  itself against a three-process tree: a group signal alone leaves the
  `setsid()` escapee alive, and `terminateProcessTree` leaves nothing alive.
- `tests/e2e/task-cli-e2e.test.mjs` runs the journey through the `vestra`
  binary on macOS: the fake implementer forks the same two processes under the
  subscription profile, and `vestra task cancel` ends the run as `ABORTED`
  with all three gone.
- `tests/integration/driver-process-tree.test.mjs` covers what the two drivers
  share (which terminator a driver uses, and a fallback that stops a group and
  resolves when nothing is left to stop) and, for Claude Code, that a stream
  which keeps failing starts one termination of its child.
- `tests/integration/task-process-tree.test.mjs` shows that the task
  composition's terminator resolves for a live provider, for a tree that is
  already gone, and for a kill the runtime refuses.
- `tests/architecture/provider-process-tree-termination.test.mjs` fails when
  the driver stops starting its provider in its own group, when the task
  composition builds a provider driver without the tree terminator, or when a
  task source signals a process itself.
- The suites of the three profiles pass unmodified against the new spawn,
  including the cases that cancel a mediated session and require its isolation
  directory to be removed.

## What an operator can notice

- `vestra task cancel` and Ctrl-C stop everything Claude Code started, and a
  cancel no longer waits for a process Claude Code left behind.
- Claude Code no longer receives the terminal's own signals. Ctrl-C reaches
  `vestra`, which aborts the run and kills the tree.
- If the `vestra` process itself is killed with `SIGKILL`, or its terminal
  goes away, nothing stops Claude Code. It runs until its closed pipes make it
  exit. Before this change a terminal hang-up reached it directly.

## What was not observed

None of the following was observed. Each is a statement about a real Claude
Code process that the fake cannot make.

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A print-mode session works when `claude` leads its own session and has no controlling terminal | The fake reads no terminal |
| The processes a real session starts (the bridge relay, anything else) are all gone after `vestra task cancel` | The fake starts two idle processes of its own choosing |
| A real session exits by itself once `vestra` is gone and its pipes are closed | The fake's `fork` mode never exits by itself |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A descendant that left the group is found only through the chain of parents
  that links it to the provider when the stop begins. One whose parent had
  already exited has been re-parented and is not found.
- The process table is read with `ps`. Where it cannot be read, only the group
  signal applies and an escapee survives.
- The task composition's terminator never rejects, because the driver calls it
  from an abort listener. A tree that could not be confirmed gone is therefore
  not reported: the session still ends, and it ends as cancelled.
- A process identifier recorded before the kill can be reused by an unrelated
  process of the same user before the recorded descendant is killed. The
  window is the time the group kill takes.
- Windows has no process groups. The terminator kills the tree there through
  `taskkill /T /F`. The mediated profiles and the `vestra task` path stay
  refused on Windows, so the tree terminator is reachable there only through
  a composition of the T03 profile.
- This is process control, not an OS sandbox.
