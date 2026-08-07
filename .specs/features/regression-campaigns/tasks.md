# T73 Public Regression Campaigns Tasks

## Atomic execution plan

| Task | Deliverable | Depends on | Focused verification | Commit boundary |
| ---- | ----------- | ---------- | -------------------- | --------------- |
| T0 | Spec, design, task plan, handoff | None | `pnpm agent:check` | Planning only |
| T1 | Application campaign rules: `CampaignDefinition`, `assertCampaignCorpus`, `canonicalizeCorpus`, `evaluateCampaign` (Wilson lower bound), `assertCampaignSummary`, `buildCampaignSummary` | T0 | `tests/unit/regression-campaigns.test.mjs` | Application contract and tests |
| T2 | `schemas/regression-campaign-summary/1.schema.json` + regenerated `generated.ts` + contract tests | T1 | `pnpm test:contract` | Summary schema and tests |
| T3 | Frozen corpus `tests/public-regression/corpus.mjs` (≥20 campaigns + reproducible checks) + `campaigns.test.mjs` runner | T1 | `pnpm test:release` | Public corpus and runner |
| T4 | `tests/system/regression-summary.test.mjs`: end-to-end summary, schema-valid, no leak | T2, T3 | `pnpm test:release` | System summary and tests |
| T5 | Remove the stale `DECLARED_EMPTY.release` entry in `scripts/test-scope.mjs`; `pnpm gate:build` | T3, T4 | `pnpm gate:build` | Scope activation and evidence |

## Test matrix

| Layer | Minimum outcomes |
| ----- | ---------------- |
| Unit | corpus < 20 / duplicate id / missing field fail closed; Wilson lower bound; deterministic samples:1; summary allowlist + prohibited content |
| Contract | summary schema validates a valid summary; rejects unknown fields, bad verdicts, out-of-range rates |
| Release (public-regression + system) | ≥20 campaigns run against reproducible fixtures; verdicts pass thresholds; digest stable; machine + human summary agree; no leak |

At least 20 campaigns; no case skipped, todo-marked, or weakened.

## Traceability

| Task | Requirements |
| ---- | ------------ |
| T1 | CAM-01, CAM-02, CAM-03, CAM-05 |
| T2 | CAM-05 |
| T3 | CAM-01, CAM-02, CAM-04 |
| T4 | CAM-05 |
| T5 | CAM-06 |

## Commit rules

- Each task is implemented test-first and committed after its focused
  verification passes. Generated types change only through the schema + generator.
- The independent T73 qualification (author != verifier) is a separate step and
  advances the chain to T74; it is not self-certified here.

## Execution evidence

| Task | Status | Commit / evidence |
| ---- | ------ | ----------------- |
| T0 | In progress | this planning set |
