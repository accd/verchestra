# Architecture deepening, second round

## Problem

A fresh architecture review of `main` at `9eb2881` (2026-10-02, the
`improve-codebase-architecture` skill) judged the first round
(`.specs/features/architecture-deepening/`): four of its eight frictions are
gone and four are reduced. It also found nine new candidates. Two of them were
defects and are already fixed: the run's usage account (#478, #479) and the
launcher's process-group termination (#480). The owner approved a second round
on the rest on 2026-10-03.

## Vocabulary

Every artifact of this feature uses these terms exactly: module, interface,
implementation, depth, seam, adapter, leverage, locality.

## Requirements

- **ADR2-1** (scoped-path rule): The task-path grammar, the containment test,
  the protected-path test and the case rule SHALL be owned by one module, and
  every stage of the task path SHALL ask it. WHEN a target differs from a
  protected path or a scope entry only by case THEN every stage SHALL decide it
  the same way. No stage SHALL match a task path with a pattern that can
  backtrack polynomially.
- **ADR2-2** (candidate evidence writers): The files a candidate build writes
  SHALL be written by a tested module whose shapes the readers share, and the
  bytes SHALL be identical to the inline scripts' for the same inputs.
- **ADR2-3** (provider child run): The spawn, budget, framing and end rule that
  the Claude Code and Codex drivers repeat SHALL live in one module of
  `packages/drivers`.
- **ADR2-4** (worktree resolution): The worktree handle SHALL be resolved in one
  place; the scratch checkout of the verifier SHALL be owned by the worktree
  module; the gate verdict SHALL be decided once.
- **ADR2-5** (bounded child run): A child process that `platform-node` runs with
  a time and output bound SHALL be run by one routine.
- **ADR2-6** (typed Driver event): A Driver event SHALL be a declared, closed
  type; consumers SHALL not cast it, and the usage check SHALL be written once.
- **ADR2-7** (runtime store records): The runtime store SHALL return declared
  records, the lease adapter SHALL earn its place or go, and a public method with
  only test callers SHALL be justified or removed.
- **ADR2-8** (approval request ports): An approval request SHALL declare the ports
  it uses, so planning builds no refusing stub.
- **ADR2-9** (Run record readers): The Run record's readers SHALL return typed
  records instead of rows read by member name.
- **ADR2-10** (credential value limit): The credential value limit SHALL be
  defined once, and the CLI SHALL size its buffer from that definition.
- **ADR2-11** (refresh ledger entry): The timestamp refresh SHALL derive its
  ledger entry through the ledger module, as a release does.

## Constraints

The constraints of the first round hold: one concern per pull request; tests
replace, never layer; the complexity baseline only ratchets down; the census is
refreshed when a file gains or loses a serialization or hash signal; line
citations move with the code; digest-bound reports keep their digests;
migrations (12) and the runtime error catalog (19) are unchanged unless a task
says otherwise; sealed bytes do not change. A task that touches the task path,
the drivers, the runtime store or a release workflow runs the platform matrix
on its branch before merge. No variable, parameter or member is named like a
secret unless it holds one.

## Out of scope

The deferred split of the runtime store by aggregate (first round, C6) stays
deferred unless ADR2-7 finds the leverage that pays for it.
