---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening-2
issue: null
status: complete
branch: main
baseRevision: 86c2ab0de82068e92a8fcdb3dfc4e28c9c582581
lastCompletedTask: T11
nextTask: "No further action for this round. Every task merged except T6 part 2 (moving the framed Driver protocol out of the drivers package entry), closed as #505: the move makes SonarCloud treat its 375 lines as new code and fail on issues it already had. Deleting the protocol (it has no production caller) or cleaning it as part of the move is an owner decision."
lastGate: "Platform matrix PASS on five targets before every task merged; required checks and SonarCloud PASS on #485-#507"
updatedAt: 2026-10-03T17:00:00Z
---

# Scope

The second round of architecture deepening, approved by the owner on
2026-10-03, on the candidates of the 2026-10-02 review of `main` at `9eb2881`
and the residues of the first round. See `spec.md` and `tasks.md`.

# Completed Evidence

Every task's evidence is in its `validation-t<n>.md`. Merged, each after the
platform matrix passed on all five targets where `spec.md` requires it:

| Task                                                   | Pull requests             | Decisions      |
| ------------------------------------------------------ | ------------------------- | -------------- |
| T1 scoped-path rule                                    | #485 (security fix), #486 | AD-057, AD-058 |
| T2 candidate evidence writers                          | #488, #489                | AD-059         |
| T3 provider child run                                  | #498, #500 (input race)   | AD-060, AD-065 |
| T4 worktree resolution, scratch checkout, gate verdict | #506                      | AD-066         |
| T5 bounded child run                                   | #507                      | AD-067         |
| T6 typed Driver event                                  | #504                      | AD-063         |
| T7 runtime store records                               | #501, #502, #503          | AD-062         |
| T8 approval request ports                              | #487                      | —              |
| T9 typed Run record readers                            | #499                      | AD-061         |
| T10 credential value limit                             | #496                      | —              |
| T11 refresh ledger entry                               | #497                      | —              |

Defects found and fixed along the way: a protected-path bypass through a case
variant or a trailing separator (#485); two host-process crashes in the
provider child run, a non-object line and a failed spawn (#498); a completed
Claude Code session failed by an input that closed after its result (#500,
present since before the round); and two publisher gaps, the gate evidence
digest and a target its bundle does not carry (#489). A timing assumption in a
test of the usage account was corrected (#491).

# Next Exact Action

None for this round. Owner decisions recorded, not started:

- T6 part 2: delete the framed Driver protocol with its two suites (no
  production caller), or clean it (three bare sorts, a cognitive complexity of
  32, 24 duplicated lines) as part of moving it out of the package entry.
- The runtime store's `backupTo` is qualified and unused while the catalog
  tells a user to recover from a verified backup: compose a backup command, or
  accept it as qualified but unused.
- Whether to price OpenCode's reasoning and cache tokens.

# Blockers

None.
