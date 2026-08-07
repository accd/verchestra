# T73 Public Regression Campaigns Specification

## Problem statement

Verchestra's qualification evidence lives in per-task reports, but there is no
single, frozen, public corpus that lets the community re-run the delivery
behaviors a candidate must not regress and inspect the distribution of outcomes.
T73 publishes an immutable campaign corpus: each campaign binds a known
regression to a requirement, owner, threshold, fixture, and evidence location,
runs against a real reproducible fixture, and — for probabilistic behavior —
reports a distribution and confidence rather than a single cherry-picked score.
The corpus fills the `test:release` scope, which is declared empty until T73.

## Goals

- Define an immutable, digest-sealed campaign corpus of at least 20 campaigns
  covering the contract, routing, context, policy, Probe, workspace, Handoff,
  recovery, support, Self-Test, cost, and latency surfaces.
- Map every campaign to a requirement id, an owner, a threshold, a fixture
  reference, and an evidence location.
- Run each campaign against a real, reproducible fixture; probabilistic
  campaigns run repeatedly and report a distribution (sample size, pass rate,
  and a confidence bound), never a single sampled result.
- Emit machine (JSON, schema-validated) and human campaign summaries.
- Fill `tests/public-regression` and `tests/system` so `test:release` and
  `gate:build` stop being declared-empty.
- Prove the corpus is immutable for a candidate: a definition change is detected
  by a sealed corpus digest.

## Out of scope

| Exclusion | Owner / reason |
| --- | --- |
| Promotion decisions (accept/reject a candidate) | T74 sealed-holdout gate |
| Platform fleet completion | T75 |
| Hidden release oracles or private scoring | Forbidden; the corpus is public |
| Live paid provider calls | Campaigns use deterministic local fixtures |
| New product behavior | Campaigns observe existing qualified surfaces only |

## Requirements

### CAM-01 — Immutable campaign corpus

WHEN the campaign corpus is loaded THEN it SHALL be a closed, ordered set of at
least 20 campaign definitions, and a `corpusDigest` computed over the canonical
definitions SHALL detect any addition, removal, or edit; a candidate evaluation
binds one `corpusDigest`.

### CAM-02 — Complete regression mapping

WHEN a campaign is defined THEN it SHALL carry a stable `id`, a `requirement`
id, an `owner`, a numeric `threshold`, a `fixtureRef`, and an `evidenceRef`; a
campaign missing any field fails closed.

### CAM-03 — Distributions, not cherry-picked scores

WHEN a probabilistic campaign runs THEN it SHALL execute at least the declared
sample size and report `{ samples, passes, passRate, lowerConfidenceBound }`;
the verdict SHALL use the lower confidence bound against the threshold, never a
single run. A deterministic campaign reports `samples: 1` and an exact outcome.

### CAM-04 — Reproducible representative tasks

WHEN the corpus runs THEN at least 20 representative repository delivery
behaviors SHALL execute against public, local, reproducible fixtures with no
network, credential, or machine-local path, and two runs of a deterministic
campaign SHALL agree.

### CAM-05 — Public machine and human summaries

WHEN the corpus is summarized THEN a machine summary SHALL validate against the
`regression-campaign-summary` schema (per-campaign id, requirement, verdict,
distribution) and a human summary SHALL project the same verdicts; neither SHALL
contain a secret, raw provider payload, or machine-local path.

### CAM-06 — Scope adequacy

WHEN T73 is submitted THEN `tests/public-regression` and `tests/system` SHALL be
non-empty, `pnpm gate:build` SHALL pass, no assertion SHALL be skipped or
weakened, and independent verification plus human review SHALL remain required.

## Edge cases

- A corpus with fewer than 20 campaigns fails closed.
- A duplicated campaign id fails closed.
- A probabilistic campaign whose lower confidence bound is below its threshold
  fails, even if the point estimate passes.
- A campaign summary value carrying a path or secret is rejected before publish.
- The corpus digest changes if any definition field changes.

## Traceability

| Requirement | Upstream | Status |
| --- | --- | --- |
| CAM-01 | VES-RLS-006 | In tasks |
| CAM-02 | VES-TST-003 | In tasks |
| CAM-03 | VES-MDL-003 | In tasks |
| CAM-04 | VES-TST-004–008 | In tasks |
| CAM-05 | VES-SKL-006 | In tasks |
| CAM-06 | Issue #14 completion | In tasks |

Coverage: 6 requirements, 6 mapped to tasks, 0 unmapped.
