# Candidate cross-platform gates tasks

1. **T1 (XP-01)** — Darwin zombie-only group EPERM in `terminateProcessGroup`,
   with a deterministic integration test. Status: done.
2. **T2 (XP-02)** — fake implementer logs results before session-ending events;
   loop-reproduced before and after. Status: done.
3. **T3 (XP-03)** — shared mediation refusal helper and win32 guards in every
   mediated and bridge suite. Status: done.
4. **T4 (XP-04)** — probe host win32 refusal instead of skip. Status: done.
5. **T5 (XP-05)** — Windows-safe runtime store and worktree tool fixtures.
   Status: done.
6. **T6 (XP-06)** — local gates, then a green five-leg T76 candidate build on
   this branch; record it in `validation.md`. Status: in progress.
