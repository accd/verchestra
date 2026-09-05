# Tasks

- [x] T1: inspect #405, confirm no assignee/volunteer, assign current operator,
  apply existing feature/priority/status labels and create an issue-linked branch.
- [x] T2: implement validated, snapshotted Codex process context.
- [x] T3: prove child-process context, denial and legacy behavior with tests.
- [x] T4: complete build/security gates on pinned Node 24.14.0; resolve transient
  self-test cleanup failures with bounded retries. See validation.md.
- [ ] T5: independently verify and human-review this prerequisite slice.
- [ ] T6: implement the remaining public task-delivery composition under #405.

## Implementation plan posted to #405

First slice: make CodexDriver accept an explicit process cwd/environment without
ambient inheritance, use it consistently for probe, spawn and thread/start, and
reject malformed contexts before effects. Add synthetic subprocess tests plus
legacy regression coverage. This is a prerequisite only: no new CLI command,
live provider calls or claim that #405 is complete. Remaining composition and
live pilot stay tracked by #405/#406. No new dependencies or release changes.
