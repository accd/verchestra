# T74 Sealed-Holdout Evaluator and Promotion Gate Tasks

## Atomic execution plan

| Task | Deliverable | Depends on | Focused verification | Commit boundary |
| ---- | ----------- | ---------- | -------------------- | --------------- |
| T0 | Spec, design, task plan, handoff | None | `pnpm agent:check` | Planning only |
| T1 | Application promotion rules: `canonicalizeOracle`, `evaluatePromotion` (all block codes), `buildPromotionReport`, `assertPromotionReport`, `assertReportUntampered` | T0 | `tests/unit/promotion-gate.test.mjs` | Application contract and tests |
| T2 | `schemas/promotion-report/1.schema.json` + generated type + contract tests | T1 | `pnpm test:contract` | Report schema and tests |
| T3 | `apps/vestra-cli/src/promotion-composition.ts`: distinct evaluator identity, sealed oracle + report | T1, T2 | Promotion security tests | Composition and tests |
| T4 | Security + E2E cases: isolation, contamination, threshold drift, candidate mutation, report tamper, shared identity | T3 | `tests/security`, `tests/e2e` | Safety-property tests |
| T5 | Case-count audit (>=25 security+e2e), `pnpm gate:security`, handoff evidence | T1-T4 | `pnpm gate:security` | Evidence update only |

## Test matrix

| Layer | Minimum outcomes |
| ----- | ---------------- |
| Unit | oracle seal + drift; each block code; PROMOTED only when clean; report allowlist; tamper detection |
| Contract | promotion-report schema validates a valid report; rejects unknown fields, bad verdict, unregistered block code |
| Security | evaluator identity distinct from candidate; contamination/drift/mutation/insufficient-repetition/tamper each block; signed report verifies, a tampered artifact does not |
| E2E | a clean candidate is PROMOTED; each block condition yields BLOCKED with the exact code |

At least 25 security and E2E cases; no case skipped, todo-marked, or weakened.

## Traceability

| Task | Requirements |
| ---- | ------------ |
| T1 | PROM-01, PROM-02, PROM-03, PROM-04, PROM-05, PROM-07 |
| T2 | PROM-06 |
| T3 | PROM-01, PROM-06 |
| T4 | PROM-02..07 |
| T5 | PROM-08 |

## Commit rules

- Each task implemented test-first, committed after its focused verification.
  Generated types change only through the schema + generator.
- The independent T74 qualification (author != verifier) is a separate step and
  advances the chain to T75; it is not self-certified here.

## Execution evidence

| Task | Status | Commit / evidence |
| ---- | ------ | ----------------- |
| T0 | In progress | this planning set |
