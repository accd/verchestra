---
schema: verchestra-feature-handoff/v1
feature: regression-campaigns
issue: 14
status: verification
branch: feat/t73-regression-campaigns
baseRevision: a24f008cfada9c51d19ba8ac1183dbe66c4eb857
lastCompletedTask: T5
nextTask: independent T73 qualification report and chain advance to T74
lastGate: gate:quick PASS; gate:build and gate:release confirming the corpus
updatedAt: 2026-08-07T09:00:38Z
---

# Scope

Implement T73 (#14): a frozen, public regression-campaign corpus that makes the
delivery behaviors a candidate must not regress inspectable and re-runnable,
with distribution + confidence reporting and immutable definitions. Fills the
`test:release` scope, which was declared empty until T73. Spec, design, and
tasks are in this feature directory.

# Authority and external effects

The owner authorized advancing the beta chain autonomously and merging the
feature. The implementation is complete and merges to `main`. The qualification
chain is NOT advanced here: T73 is qualified by a separate verifier (author !=
verifier), who writes `docs/qualification/t73-validation.md` and migrates the
status surfaces to "T73 complete; T74 next".

# Completed evidence

- T1: pure application rules `packages/application/src/regression/campaigns.ts` —
  `assertCampaignCorpus` (>=20, no dup, well-formed), `canonicalizeCorpus`
  (immutability), `evaluateCampaign` (Wilson 95% lower bound vs threshold, never
  a single run), and the summary allowlist. 19 unit cases.
- T2: `schemas/regression-campaign-summary/1.schema.json` + generated type + 12
  contract cases.
- T3/T4: `tests/public-regression/corpus.mjs` — 22 reproducible campaigns over
  the doctor, self-test durable/driver, canonical-JSON, gate-repair, and
  campaign-framework surfaces, including two probabilistic campaigns with frozen
  distributions; the runner asserts each clears its lower bound and the corpus
  digest is stable. `tests/system` builds the machine + human summary, validates
  the machine summary against `regression-campaign-summary@1`, and proves no
  leak. `test:release` 28 cases.
- T5: removed the now-purposeless `DECLARED_EMPTY` release exception in
  `scripts/test-scope.mjs` (T73 filled it) and updated its two unit tests.
- `pnpm gate:quick` PASS; `pnpm gate:build` and `pnpm gate:release` (which runs
  `test:release`) confirm the whole surface.

# Next action

None for the implementation. The remaining step is the independent T73
qualification (author != verifier): re-derive the CAM-01..06 adequacy matrix,
run a discrimination sensor on the pure campaign rules, write
`docs/qualification/t73-validation.md`, and migrate the status surfaces to
"T73 complete; T74 next" (the same migration T71 used).

# Blockers

None for T73. Chain-level: T76 is blocked on the owner's DSSE/in-toto and
context-tokenizer decisions (AD-008); T77 is the 1.0 decision. The beta cannot
be reached without owner input.

# Follow-ups

The probabilistic campaigns use frozen outcome sequences that stand in for
repeated live-provider runs (no paid call in the canonical corpus). When a
qualified live-evaluation harness exists, those fixtures can be replaced with
real sampled distributions without changing the framework or the schema.
