---
schema: verchestra-feature-handoff/v1
feature: regression-campaigns
issue: 14
status: complete
branch: feat/t73-regression-campaigns
baseRevision: a24f008cfada9c51d19ba8ac1183dbe66c4eb857
lastCompletedTask: T5
nextTask: none; T73 is independently qualified and the chain advances to T74
lastGate: gate:quick and externally dispatched gate:build PASS at 23e78dc; 6 of 6 mutations killed
updatedAt: 2026-08-11T18:59:00Z
---

# Scope

Implement T73 (#14): a frozen, public regression-campaign corpus that makes the
delivery behaviors a candidate must not regress inspectable and re-runnable,
with distribution + confidence reporting and immutable definitions. Fills the
`test:release` scope, which was declared empty until T73. Spec, design, and
tasks are in this feature directory.

# Authority and external effects

The owner authorized advancing the beta chain autonomously and merging the
feature. The implementation is complete and merged to `main`. The qualification
chain is now advanced: T73 was qualified by a separate verifier (author !=
verifier, brunomjanuario), who wrote `docs/qualification/t73-validation.md`
and migrated the status surfaces to "T73 complete; T74 next".

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

None. Independent qualification is complete: `docs/qualification/t73-validation.md`
re-derived the CAM-01..06 adequacy matrix, ran a six-mutation discrimination
sensor on the pure campaign rules (0 survivors), and migrated every derived
status surface to "T73 complete; T74 next" in the same commit. Full report:
`.specs/features/regression-campaigns/validation.md`. The report bound
revision `23e78dc` rather than this feature's own last commit (`d0ea1e5`),
because the T4a canonical-JSON migration (issue #58) touched
`buildCampaignSummary`'s ordering after `d0ea1e5` landed — see the report's
"Revision correction" section for the full reasoning and the byte-identity
proof between the two candidate revisions.

# Blockers

None for T73. Chain-level: T76 is blocked on the owner's DSSE/in-toto and
context-tokenizer decisions (AD-008); T77 is the 1.0 decision. The beta cannot
be reached without owner input.

# Follow-ups

The probabilistic campaigns use frozen outcome sequences that stand in for
repeated live-provider runs (no paid call in the canonical corpus). When a
qualified live-evaluation harness exists, those fixtures can be replaced with
real sampled distributions without changing the framework or the schema.
