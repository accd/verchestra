# T74 Sealed-Holdout Evaluator and Promotion Gate Specification

## Problem statement

The public regression corpus (T73) tells the community what a candidate must not
regress, but a candidate must not be promoted on evidence it could see or shape.
T74 adds a Sealed Holdout: an evaluator with a separate identity that seals its
oracle (the holdout campaigns, their thresholds, and repetition counts) before a
candidate is evaluated, runs the sealed evaluation, and emits a signed,
tamper-resistant promotion decision. The candidate never reads or modifies the
oracle, criteria, weights, evaluator state, or report before sealing; leakage,
threshold drift, insufficient repetition, candidate mutation, or report tamper
all block promotion.

## Goals

- Seal the holdout oracle (campaign refs, thresholds, repetition counts) under a
  `holdoutDigest` before evaluation; the candidate is bound to that digest, never
  its contents.
- Bind a promotion decision to an exact candidate digest, holdout digest, policy,
  thresholds, evidence, and a separate evaluator identity.
- Block promotion on any of: oracle contamination, threshold drift, insufficient
  repetition, candidate mutation, or report tamper.
- Sign the promotion report with an evaluator identity distinct from any
  candidate-side identity, and reject a report whose digest does not verify.
- Keep the evaluator pure at the rule layer (application) and construct the
  distinct evaluator signer only in the composition root.

## Out of scope

| Exclusion | Owner / reason |
| --- | --- |
| Candidate implementation changes during evaluation | Forbidden; the candidate is immutable once sealed |
| Threshold changes after results are known | Forbidden; thresholds are sealed into the oracle |
| Platform qualification / fleet | T75 |
| Live paid provider evaluation | Fake-first; the holdout runs deterministic fixtures |
| Building new campaigns | Reuses the T73 corpus as the holdout source |

## Requirements

### PROM-01 — Sealed oracle

WHEN a holdout is prepared THEN its oracle (campaign ids, thresholds, repetition
counts) SHALL be sealed under a `holdoutDigest` computed over the canonical
oracle, and the candidate SHALL be given only that digest; an oracle whose
canonical form does not reproduce the sealed digest fails closed.

### PROM-02 — Candidate immutability

WHEN a promotion decision is made THEN it SHALL bind the exact `candidateDigest`
sealed at the start of evaluation; a candidate digest that changed during
evaluation blocks promotion (`VES_PROMOTION_CANDIDATE_MUTATED`).

### PROM-03 — Sufficient repetition

WHEN a campaign result is admitted THEN its sample count SHALL be at least the
oracle's predeclared repetition count for that campaign; fewer samples block
promotion (`VES_PROMOTION_INSUFFICIENT_REPETITION`).

### PROM-04 — No threshold drift

WHEN results are evaluated THEN the thresholds SHALL be exactly those sealed in
the oracle; a threshold that differs from the sealed oracle is detected by the
`holdoutDigest` and blocks promotion (`VES_PROMOTION_THRESHOLD_DRIFT`).

### PROM-05 — Contamination detection

WHEN the candidate is observed to have read or influenced the oracle THEN
promotion SHALL be blocked (`VES_PROMOTION_CONTAMINATED`), regardless of the
campaign outcomes.

### PROM-06 — Tamper-resistant signed report

WHEN a promotion report is emitted THEN it SHALL bind candidate, holdout, policy,
thresholds, evidence, and the evaluator identity, be signed by an evaluator
identity distinct from the candidate, and a report whose recomputed digest does
not match its sealed digest SHALL be rejected (`VES_PROMOTION_REPORT_TAMPERED`).

### PROM-07 — Promotion only when every campaign clears its sealed threshold

WHEN, and only when, no block condition holds and every campaign's lower
confidence bound clears its sealed threshold THEN the verdict SHALL be
`PROMOTED`; otherwise `BLOCKED`.

### PROM-08 — Adequate evidence

WHEN T74 is submitted THEN at least 25 security and E2E cases SHALL pass,
`pnpm gate:security` SHALL pass, no assertion SHALL be skipped or weakened, and
independent verification plus human review SHALL remain required.

## Edge cases

- A holdout oracle re-serialized with a changed threshold produces a different
  digest and fails the seal check.
- A candidate digest recorded at seal time differs from the one at decision time.
- A campaign reporting fewer samples than the sealed repetition count.
- A contamination fact set true blocks even an all-pass result set.
- A promotion report with any field altered fails digest verification.
- The evaluator signer's key id differs from the candidate's; a shared identity
  is rejected.

## Traceability

| Requirement | Upstream | Status |
| --- | --- | --- |
| PROM-01 | VES-RLS-006 | In tasks |
| PROM-02 | VES-SEC-006 | In tasks |
| PROM-03 | VES-MDL-003 | In tasks |
| PROM-04 | VES-RLS-006 | In tasks |
| PROM-05 | VES-SEC-006 | In tasks |
| PROM-06 | VES-SKL-006 | In tasks |
| PROM-07 | VES-MDL-003 | In tasks |
| PROM-08 | Issue #15 completion | In tasks |

Coverage: 8 requirements, 8 mapped to tasks, 0 unmapped.
