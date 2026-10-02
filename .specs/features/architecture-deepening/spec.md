# Architecture deepening

## Problem

An architecture review of `main` (2026-10-01) found eight places where knowledge
of one concept is spread across several modules, where a module's interface is
nearly as large as its implementation, or where logic sits in the composition
root and only a macOS end-to-end test reaches it. It also found two real
defects: an idle cancel that leaves the worktree behind in a SHA-256
repository, and a driver cancel that kills one process instead of its tree.

Separately, the governed task path authenticates providers only with API keys.
The mediated Claude Code profile passes `--bare`, under which Claude Code
accepts only `ANTHROPIC_API_KEY`. An owner who uses Claude and Codex through
subscriptions cannot run a task at all.

## Vocabulary

Every artifact of this feature uses these terms exactly: module, interface,
implementation, depth, seam, adapter, leverage, locality.

## Requirements

- **ADP-A** (subscription provider authentication): WHEN a Workspace selects
  subscription authentication for a provider THEN a task SHALL run with that
  provider's subscription credential, supplied explicitly, with no ambient
  session read and no API key required. WHEN the credential is absent THEN the
  task SHALL report not configured before any effect.
- **ADP-1** (task worktree): the worktree handle encoding, the task branch name
  and the commit trailers SHALL each be defined in one module. An idle cancel
  SHALL remove the worktree in a SHA-256 repository, or the plan SHALL refuse
  that repository with an explicit code.
- **ADP-2** (Run record): one module SHALL own the layout, sealing, validation
  and typed checkpoint projections of a Run's durable state. Bytes and paths
  SHALL stay unchanged.
- **ADP-3** (driver session ledger and version probe): session bookkeeping and
  version probing SHALL be implemented once for the four drivers, with each
  driver's error codes and qualified invocation unchanged.
- **ADP-4** (driver session runner): the start, observe and close loop SHALL be
  implemented once. Cancelling a Claude Code or Codex session SHALL terminate
  its whole process tree.
- **ADP-5** (verification ports): each verification operation SHALL declare
  only the ports it uses.
- **ADP-6** (runtime store): the nine legacy methods with no production caller
  SHALL be removed with their proofs re-homed, and the effect repository SHALL
  live in its own file. No schema change.
- **ADP-7** (publication ledger): the ledger module SHALL admit and derive the
  entry for a release as it does for a refresh. Deriving from the recorded
  inputs of `.3` and `.4` SHALL reproduce the committed entries byte for byte.
- **ADP-8** (credential policy): the value policy, timeouts and provisioning
  interface SHALL live beside the credential store, with the digest-bound
  qualification reports unchanged.

## Constraints

- No assertion, gate or qualification pin is weakened.
- Tests are replaced, not layered: an old test is deleted only after a test at
  the deepened interface covers the same case.
- Trailer messages and seals stay byte-identical.
- PR CI runs on Ubuntu only, so every change to the task path, the drivers or
  the runtime store is also proven on the platform matrix before merge.

## Out of scope

- Sealing the five plain per-Run markers.
- Splitting the runtime store by aggregate.
- Windows support for the mediated bridge.
