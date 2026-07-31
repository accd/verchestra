# Lighthouse Performance Budget Tasks

Issue: #110. Spec: `./spec.md`.

## Shape of this plan

This is a **diagnosis-gated** plan, not a linear one. Phase B cannot be written
in full until Phase A returns a classification, because the two possible
classifications have disjoint remedies. Committing to a remedy now would be the
same error the issue warns against — attributing the failure instead of
diagnosing it.

Phase A is therefore fully specified. Phase B is specified as two mutually
exclusive branches with a decision gate between them.

```
Phase A (diagnose)  ──►  GATE: classification  ──┬──► B1 deterministic: optimize
                                                 ├──► B2 instability: fix sampling
                                                 └──► B3 not reproduced: measure in CI
                                                          │
                                                          ▼
                                              Phase C (sensor + evidence)
```

## Phase A — Diagnose (blocking, no remedy permitted)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | Reproduce the Lighthouse stage locally against a production build of current `main`; capture the `.lighthouseci` artifact and record the observed performance score and full per-metric breakdown (LPB-01) | None | Artifact exists; score and metric values recorded in `validation.md` |
| T2 | Run the unchanged build `N = 10` times; record median, minimum, and spread of `categories:performance`; apply the pre-fixed decision rule from LPB-02 (LPB-02) | T1 | Ten recorded scores; classification stated with the rule that produced it |
| T3 | Attribute the score loss to specific metrics with numeric values; confirm the loss is not in `largest-contentful-paint` or `cumulative-layout-shift`, whose assertions passed (LPB-03) | T1 | Named metrics with values; contradiction with the passing assertions explicitly checked |

**Phase A exit gate.** Work stops here for review. T2's classification selects
the Phase B branch. No file in `apps/site/` may be modified during Phase A —
diagnosis must observe the system it is diagnosing, unchanged.

## Phase B — Restore (exactly one branch; both if both conditions hold)

### B1 — if classification is *deterministic* (median < 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4a | Reduce the cost of the bottleneck metric T3 named. Scope is bounded to that metric's cause — no threshold edits, no unrelated refactors (LPB-04) | T3 | Median score over 10 runs ≥ 0.95; `lighthouserc.cjs` assertions byte-identical |

### B2 — if classification is *instability* (median ≥ 0.95, minimum < 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4b | Make the budget evaluate against an aggregate of multiple runs instead of a single sample, keeping `categories:performance` at `minScore: 0.95` (LPB-05) | T3 | Repeated stage invocations produce a stable verdict; threshold line unchanged |

### B3 — if *not reproduced locally* (median ≥ 0.95, minimum ≥ 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4c | Escalate measurement to CI before choosing a remedy; gather the same distribution on the runner. Re-enter the T2 decision rule with CI data, which is authoritative | T3 | CI-side distribution recorded; classification re-derived |

### Common to every branch

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T5 | Record the Lighthouse stage's wall-clock cost and show it fits `timeout-minutes: 45` alongside the documented ~23-minute worst case (LPB-06) | T4a/T4b/T4c | Timing recorded; margin stated |

## Phase C — Prove and record

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T6 | Discrimination sensor: inject a deliberate performance regression into the built site in scratch state, confirm the assertion fails, remove it, confirm it passes, discard the mutation (LPB-07) | T5 | Both outcomes recorded; working tree clean afterward |
| T7 | Full `pnpm site:test` and `pnpm gate:quick`; write `validation.md` and the feature `handoff.md` (LPB-06) | T6 | Both gates pass; artifacts tracked |

## Gate Commands

| Level | Command |
| --- | --- |
| Site build | `pnpm site:build` |
| Lighthouse stage only | `pnpm --filter @verchestra/site test:lighthouse` |
| Full site qualification | `pnpm site:test` |
| Quick | `pnpm gate:quick` |

## Completion Rules

- `categories:performance` stays at `minScore: 0.95`. No assertion in
  `apps/site/lighthouserc.cjs` may be weakened, removed, or made conditional.
- No remedy is implemented before T2 returns a classification.
- Any sampling change must be shown to fit the existing job timeout, not merely
  assumed to.
- No new runtime dependency for the site; `@lhci/cli` is already present.
- Qualification evidence is **not** recorded under `docs/qualification/` — this
  is maintenance work on the gate, not a numbered product task in the T-chain.

## Task count and delegation

11 tasks across three phases, but the Phase B branches are exclusive: a real
run executes 7–8. That fits a single batch, so this executes inline without
sub-agents. The Verifier still runs automatically after the final task.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Done | Local production build (`pnpm site:build`) + `pnpm --filter @verchestra/site test:lighthouse` against `http://127.0.0.1:4323/verchestra/`. Single-run result: `performance: 1`, `accessibility: 1`, `best-practices: 1`, `seo: 1`. Per-metric: LCP 322.8ms, TBT 0ms, Speed Index 322.8ms, CLS 0.0253. |
| T2 | Done | 10 local runs of `lhci autorun`, ~15-16s each. All 10 scored `performance: 1`. Median = 1, min = 1, max = 1 — zero variance. LCP ranged 322.1-322.5ms, CLS 0.0253-0.0272ms across runs. **Classification: not reproduced locally** (median ≥ 0.95 AND minimum ≥ 0.95) — local hardware is far faster than the shared 2-vCPU `ubuntu-latest` runner and cannot surface CPU-bound throttling. Per LPB-02, this requires CI-side measurement before choosing a remedy (branch B3). |
| T3 | Done | Not applicable at this classification — no score loss to attribute locally; every metric hit its ceiling. Attribution moves to CI data once available. |
| T4a/b/c | **Blocked — awaiting CI data (B3)** | `ci.yml` only triggers on `push: [main]` or `pull_request: [main]` (`ci.yml:3-7`); pushing the feature branch to `origin` (user's fork, `brunomjanuario/verchestra`) alone does not run CI. User opening the PR themselves is the chosen path (2026-07-31). Waiting on the PR's `Site quality` run URL / scores to resume T2's decision rule with CI data as authoritative. |
| T5 | Pending | Blocked on T4. |
| T6 | Pending | Blocked on T4. |
| T7 | Pending | Blocked on T4. |
