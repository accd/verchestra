# Release decision rounds tasks

1. **T1 (#18)**: round-aware validator and tests. `scripts/agent-readiness.mjs`
   gains the `.round-<n>` file name, `checkDecisionRound`, the succession
   checks, `isAncestor` in `revisionTrust`, and the effective decision with
   history. `tests/agent-readiness/release-decision.test.mjs` gains one test
   or table row per rule, the signature-coverage proof, and the committed-hold
   proof; the duplicate test is renamed with its assertion kept. Census
   refreshed. Commit `0537e67`. Status: done.
2. **T2 (#18)**: `RELEASE-DECISION-CONTRACT.md` states rounds (rule, round
   frontmatter, fail-closed rows, what is not enforced, historical sentence
   marked). Commit `2f4287b`. Status: done.
3. **T3**: feature spec, tasks, validation and handoff, and the proposed AD in
   `.specs/STATE.md`. Status: done.
4. **T4**: discrimination sensor and gates; record results in
   `validation.md`. Status: done.
