# T74 Sealed-Holdout Evaluator and Promotion Gate Tasks

## Atomic execution plan

| Task | Deliverable | Depends on | Focused verification | Commit boundary |
| ---- | ----------- | ---------- | -------------------- | --------------- |
| T0 | Spec, design, task plan, handoff | None | `pnpm agent:check` | Planning only |
| T1 | Application promotion rules: `canonicalizeOracle`, `evaluatePromotion` (all block codes), `buildPromotionReport`, `assertPromotionReport`, `assertReportUntampered` | T0 | `tests/unit/promotion-gate.test.mjs` | Application contract and tests |
| T2 | `schemas/promotion-report/1.schema.json` + generated type + contract tests | T1 | `pnpm test:contract` | Report schema and tests |
| T3 | `apps/vestra-cli/src/promotion-composition.ts`: distinct evaluator identity, sealed oracle + report | T1, T2 | Promotion security tests | Composition and tests |
| T4 | Security + E2E cases: isolation, contamination, threshold drift, candidate mutation, report tamper, shared identity | T3 | `tests/security`, `tests/e2e` | Safety-property tests |
| T6   | Issue the candidate grant over the evaluator's real assets and prove every attempt is denied (PROM-09, AD-018) | T5 | `pnpm gate:security`; the candidate exercises all four protected assets through `runPromotion` | `feat(promotion): give the candidate a surface and deny it by authority` |
| T5 | Case-count audit (>=25 security+e2e), `pnpm gate:security`, handoff evidence | T1-T4 | `pnpm gate:security` | Evidence update only |
| T7 | F3 remediation: evaluator-owned raw observations, exact-set admission, and evaluator-side aggregate recomputation | T6 | focused promotion unit/security/E2E tests; `pnpm gate:quick`; independent re-verification remains required | `fix(promotion): derive holdout evidence from evaluator observations` |

## Test matrix

| Layer | Minimum outcomes |
| ----- | ---------------- |
| Unit | oracle seal + drift; each block code; exact observation set; recomputed metrics; PROMOTED only when clean; report allowlist; tamper detection |
| Contract | promotion-report schema validates a valid report; rejects unknown fields, bad verdict, unregistered block code |
| Security | evaluator identity distinct from candidate; contamination/drift/mutation/insufficient-repetition/tamper each block; forged, malformed, duplicate, extra, and live-replaced candidate evidence cannot promote; signed report verifies |
| E2E | a clean candidate is PROMOTED; each block condition yields BLOCKED with the exact code; distinct evaluator observations produce distinct sealed evidence |

At least 25 security and E2E cases; no case skipped, todo-marked, or weakened.

## Traceability

| Task | Requirements |
| ---- | ------------ |
| T1 | PROM-01, PROM-02, PROM-03, PROM-04, PROM-05, PROM-07 |
| T2 | PROM-06 |
| T3 | PROM-01, PROM-06 |
| T4 | PROM-02..07 |
| T5 | PROM-08 |
| T6 | PROM-09 |
| T7 | PROM-03, PROM-06, PROM-07, PROM-08 |

## Commit rules

- Each task implemented test-first, committed after its focused verification.
  Generated types change only through the schema + generator.
- The independent T74 qualification (author != verifier) is a separate step and
  advances the chain to T75; it is not self-certified here.

## Execution evidence

| Task | Status | Commit / evidence |
| ---- | ------ | ----------------- |
| T0 | Done | `5ea3050`; spec, design, tasks, handoff |
| T1 | Done | `4907d6c`; pure promotion-gate rules, 21 unit cases |
| T2 | Done | `97a53df`; promotion-report schema, 10 contract cases |
| T3 | Done | promotion-composition (distinct evaluator identity, sealed oracle + report) |
| T4 | Done | 12 security + 13 e2e cases (>=25 security+e2e) |
| T5 | Done | 56 new cases (21 unit, 10 contract, 12 security, 13 e2e); gate:security + gate:build PASS |
| T6 | Done | PROM-09 / AD-018 remediation of T74 F1: the evaluator issues the candidate grant over its real assets and every attempt is denied; wired into `runPromotion` after an independent verifier found the surface built but unwired |
| T7 | F3 implementation and final T74 qualification independently verified; human review pending | Implementation merged at `24e3a02`; final report `docs/qualification/t74-validation.md` in PR #290; evaluator-owned observation port; candidates no longer contain results; exact duplicate/extra/malformed rejection; `evaluateCampaign` derives aggregates; 80 focused promotion tests pass (48 security/E2E); Linux `gate:quick` run 32576041915 and `gate:security` run 32575867942 pass at the exact head with zero failed, skipped, or todo cases; 14/14 mutation sensor kills; status surfaces advance to T74/T75 in the reviewed change |
