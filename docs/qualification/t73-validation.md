---
schema: verchestra-qualification-report/v1
task: T73
revision: 23e78dc6c01541919719ec2074342a60484d2bef
gates: pnpm gate:quick, pnpm gate:build
gateResults: pass, pass
gateRevision: 23e78dc6c01541919719ec2074342a60484d2bef
criteriaEvidence: 6 of 6 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 6 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/255
---

# T73 Public Regression Campaigns Validation

## Scope

T73 publishes a frozen, public regression-campaign corpus: 22 campaigns over
the doctor (T72), Self-Test durable/driver/profile (T69–T71), gate-repair
(T68c), canonical-JSON (T3), and campaign-framework surfaces, each mapping a
known regression to a requirement, owner, threshold, fixture, and evidence
location. The implementation merged through `4ebd211` (T0, spec/design/tasks),
`004f4ed` (T1, pure campaign rules), `a6141ff` (T2, summary schema), `58dce25`
(T3/T4, the frozen corpus and system summary), and the release-scope
activation. It fills `tests/public-regression` and `tests/system`, which
`test:release` was declared empty until this task.

The implementation author is the repository owner identity `Test`/`accd`.
This report and its discrimination campaign are authored by `brunomjanuario`,
who did not author any T73 implementation commit — the same author≠verifier
split AD-013 records. Accountability for the report itself is recorded by the
pull request named in `reviewedIn`, not by a self-declared independence field.

**Revision correction.** T73's implementation last landed at `d0ea1e5`
(2026-08-07). Between that commit and this report, the T4a canonical-JSON
migration (issue #58, PR #209, merged 2026-08-09) touched the qualified
surface: `buildCampaignSummary`'s ordering switched from an ambient-locale
`localeCompare` sort to `normalizeDeclaredSet` (code-unit order), landing at
`3e9afc1`, with two new cross-locale/declaration-order tests added in the same
commit. This report binds `3e9afc1` — the exact commit where the T73 surface
last changed — not the original `d0ea1e5`, and confirms `git diff
3e9afc1..23e78dc` is empty for every T73 file (`packages/application/src/regression/`,
`tests/public-regression/`, `tests/system/regression-summary.test.mjs`,
`tests/unit/regression-campaigns.test.mjs`,
`schemas/regression-campaign-summary/`, `scripts/test-scope.mjs`), confirmed
by matching `sha256sum` on `campaigns.ts` at both revisions
(`01fe3ae3075e63acae373dea94406be44a72d79e9af1bf2d9ca508cd435249e8`). The
report's bound `revision` is `23e78dc` (the current `main` tip at review time)
rather than `3e9afc1` itself, because `gate:quick`'s `test:agent-readiness`
stage genuinely fails at `3e9afc1` on an unrelated defect —
`.specs/features/canonical-json-t4a/handoff.md` carried `status: in-progress`
(hyphen) against the schema's `in_progress` (underscore) — fixed two commits
later in the same PR (`10a34fc`). `23e78dc` postdates that fix and is,
byte-for-byte, the same T73 surface.

The T73-specific evidence is 62 focused cases: 21 unit
(`tests/unit/regression-campaigns.test.mjs`), 13 contract
(`tests/contract/regression-campaign-summary.test.mjs`), and 28 release (25
in `tests/public-regression/campaigns.test.mjs` — 2 corpus-level, 22
per-campaign, 1 summary — plus 3 in `tests/system/regression-summary.test.mjs`).
The issue's declared minimum of 20 representative delivery behaviors is
cleared by the 22-campaign corpus. All 62 focused cases pass with zero
failed, skipped, or todo cases.

## Deterministic gates

Both declared gates ran against exact revision
`23e78dc6c01541919719ec2074342a60484d2bef`.

| Command | Result | Evidence |
| ------- | ------ | -------- |
| `pnpm gate:quick` | PASS | Local run at the exact bound revision (detached-HEAD worktree): format, lint, complexity, typecheck, unit (1992 cases), and agent-readiness stages passed with zero skipped and zero todo (136/136 focused gate:quick cases). |
| `pnpm gate:build` | PASS | Externally dispatched [manual qualification run 31525323571](https://github.com/accd/verchestra/actions/runs/31525323571), job 93892092932: the workflow checked out the requested `23e78dc` revision (`CANDIDATE_REVISION` verified equal to the requested SHA before running), then passed 1992 unit, 495 contract, 572 integration, 163 E2E, 25 architecture, and 251 qualification cases (3,498 total) with zero skipped and zero todo. |

An earlier dispatch ([run 31524944277](https://github.com/accd/verchestra/actions/runs/31524944277)) bound to `3e9afc1` also passed `gate:build` cleanly (1983+485+571+163+23+251 = 3,476 cases) — `gate:build`'s stage list does not include `test:agent-readiness`, so it could not have caught the unrelated handoff typo the revision correction above describes; both runs are consistent evidence that the T73 surface itself never regressed.

## Revision binding

`git merge-base --is-ancestor 23e78dc origin/main` succeeds (`23e78dc` is the
tip of `origin/main` at review time). The bound revision contains the
complete T73 implementation plus the T4a canonical-JSON migration of
`buildCampaignSummary`'s ordering — the last change to the qualified surface.

`git diff 3e9afc1..23e78dc` is empty for every file under
`packages/application/src/regression/`, `tests/public-regression/`,
`tests/system/regression-summary.test.mjs`,
`tests/unit/regression-campaigns.test.mjs`,
`schemas/regression-campaign-summary/`, and `scripts/test-scope.mjs`. Later
`main` work therefore does not require a further equivalence argument for the
qualified surface.

## Adequacy matrix

The matrix is independently derived from
`.specs/features/regression-campaigns/spec.md`, not from the implementation
author's handoff claims.

| Criterion | Requirement | Assertion evidence |
| --------- | ----------- | ------------------- |
| CAM-01 | A closed, ordered corpus of ≥20 campaigns; a `corpusDigest` detects any addition, removal, or edit; one digest binds a candidate evaluation | `regression-campaigns.test.mjs` — "a corpus of at least twenty well-formed campaigns is valid", "a corpus below the minimum fails closed", "the canonical serialization is deterministic and change-sensitive"; `campaigns.test.mjs` — "the public corpus is a valid set of at least twenty campaigns" (22 campaigns), "the corpus digest is stable and change-sensitive". |
| CAM-02 | Every campaign carries `id`, `requirement`, `owner`, `threshold`, `fixtureRef`, `evidenceRef`; a campaign missing any field fails closed | `regression-campaigns.test.mjs` — "a duplicated campaign id fails closed" and the six-case loop over invalid id/requirement/owner/fixtureRef/threshold/sampleSize, each asserting `VES_CAMPAIGN_CORPUS_INVALID`. |
| CAM-03 | A probabilistic campaign reports `{samples, passes, passRate, lowerConfidenceBound}` from at least its declared sample size; the verdict uses the lower confidence bound, never a single run; a deterministic campaign reports `samples: 1` and an exact outcome | `regression-campaigns.test.mjs` — "a deterministic passing/failing campaign has a lower bound of one/zero", "the verdict uses the lower confidence bound, not the point estimate" (Wilson bound below threshold fails where the point estimate would pass), "a campaign that runs fewer than its declared samples fails closed"; `corpus.mjs`'s two probabilistic campaigns (`selftest-verdict-distribution`, 100 samples; `driver-review-distribution`, 50 samples) exercised live by `campaigns.test.mjs`'s per-campaign loop. |
| CAM-04 | ≥20 representative repository delivery behaviors execute against public, local, reproducible fixtures with no network, credential, or machine-local path; two runs of a deterministic campaign agree | `corpus.mjs` — 22 campaigns over doctor, Self-Test durable/convergence, driver authority, canonical-JSON, and campaign-framework surfaces, each a pure in-process fixture; `campaigns.test.mjs`'s per-campaign loop (22 cases) proves every campaign clears its threshold; determinism follows from the campaigns' pure-function fixtures (`buildDoctorReport`, `assertConvergence`, `canonicalizeJsonV2`, etc.) with no I/O. |
| CAM-05 | The machine summary validates against `regression-campaign-summary@1`; the human summary projects the same verdicts; neither carries a secret, provider payload, or path | `regression-campaign-summary.test.mjs` — 13 contract cases including 11 mutation-rejection cases; `regression-summary.test.mjs` — "the machine summary validates against regression-campaign-summary@1", "the human summary projects the same verdicts as the machine summary", "neither summary carries an absolute path or secret". |
| CAM-06 | `tests/public-regression` and `tests/system` are non-empty; `pnpm gate:build` passes; no assertion skipped or weakened; independent verification and human review remain required | `scripts/test-scope.mjs`'s `DECLARED_EMPTY.release` exception removed (T5) — an empty release scope now fails closed rather than silently passing; `gate:build` PASS above; this report itself is the independent-verification evidence, and `reviewedIn` names the human-review pull request. |

## Issue acceptance and completion checklist

| Issue #14 outcome | Evidence |
| ------------------ | -------- |
| Every known regression maps to a requirement, owner, threshold, fixture, and evidence location | Every one of the 22 `corpus.mjs` entries carries all five fields; CAM-02's fail-closed tests prove a missing field is rejected, not silently defaulted. |
| Repeated non-deterministic runs report distributions and confidence, not cherry-picked results | CAM-03's Wilson-lower-bound tests, plus the discrimination sensor's M3/M4 mutations below, which kill any attempt to substitute the point estimate for the bound. |
| At least 20 representative repository delivery tasks are public and reproducible | 22 campaigns, all local/in-process/credential-free; `campaigns.test.mjs` reproducibly clears every threshold. |
| Campaign definitions are immutable for a candidate evaluation | CAM-01's change-sensitive digest; M6 below proves the digest genuinely covers every field, not a subset. |
| Freeze the first public campaign corpus | `CAMPAIGN_DEFINITIONS` in `tests/public-regression/corpus.mjs`, 22 entries, `Object.freeze`d. |
| Publish machine and human summaries | `buildCampaignSummary` (machine, schema-validated) and `humanSummary` (`regression-summary.test.mjs`), verdict-consistent and leak-free. |
| Complete independent verification and atomic commit | This report; the chain advance below is the atomic commit. |

## Discrimination sensor

Six mutations were applied one at a time to
`packages/application/src/regression/campaigns.ts` in a disposable detached
worktree at the bound revision (`23e78dc`, confirmed byte-identical to
`3e9afc1` for this file via matching `sha256sum`). After each run the
mutation was reversed with `git checkout --`, and `git diff --exit-code`
proved the source restored before the next mutation.

| # | Property | Mutation | Result |
| - | -------- | -------- | ------ |
| M1 | CAM-01 minimum-campaigns floor | Removed the `definitions.length < MINIMUM_CAMPAIGNS` check | KILLED by "a corpus below the minimum fails closed" (1 failure). |
| M2 | CAM-02 duplicate-id detection | Removed the `seen.has(definition.id)` duplicate check | KILLED by "a duplicated campaign id fails closed" (1 failure). |
| M3 | CAM-03 lower-bound verdict, not point estimate | Changed the verdict to compare `passes / samples` (the point estimate) instead of `lowerConfidenceBound` against the threshold | KILLED by "the verdict uses the lower confidence bound, not the point estimate", "campaign campaign-wilson-below-threshold-fails clears its threshold", and "the corpus summary is PASS with every campaign accounted for" (3 failures). |
| M4 | CAM-03 Wilson-bound math | `wilsonLowerBound` returns the point estimate (`passes / samples`), discarding the confidence margin entirely | KILLED by the identical 3 tests M3 killed — proving the distribution math itself is exercised, not just the branch that reads it. |
| M5 | CAM-05 summary rate allowlist | Removed the `rate < 0 \|\| rate > 1` range check on `passRate`/`lowerConfidenceBound` | KILLED by "the summary rejects an out-of-range rate" (1 failure). |
| M6 | CAM-01 digest completeness | Dropped `threshold` from `canonicalizeCorpus`'s serialized fields, so a threshold-only edit becomes invisible to the digest | KILLED by "the canonical serialization is deterministic and change-sensitive" (1 failure). |

All six mutations were killed; none survived. M3 and M4 targeting the same
three tests from two different code paths (the verdict comparison and the
underlying bound calculation) is itself evidence that "distribution, not a
cherry-picked score" is enforced at both the branch and the arithmetic that
feeds it — a report classifying by branch coverage alone would have missed
M4.

## Non-shallow checks and reconciliations

- The two probabilistic campaigns (`selftest-verdict-distribution`, 100
  samples with 3 frozen failures; `driver-review-distribution`, 50 samples
  with 2 frozen failures) use a fixed, public failing-index sequence rather
  than a live provider call, per the repository's fake-first discipline (no
  paid call in the canonical corpus, `.specs/features/regression-campaigns/handoff.md`'s
  own follow-up note). This is a deliberate stand-in for repeated live-provider
  runs, not a claim that live sampling occurred; both campaigns still exercise
  the real Wilson-bound math (M4 above proves that math is load-bearing) against
  a real, reproducible, versioned outcome sequence — deterministic in the sense
  that the same indices fail on every machine, not in the `sampleSize: 1` sense.
- `evidenceRef` for every campaign in the frozen corpus points at
  `docs/qualification/t73-validation.md` — this report. That is not circular:
  the corpus was frozen before this report existed (`58dce25`, 2026-08-07),
  and the reference names where the campaign's adequacy is documented, which
  is this file, written independently afterward.
- The revision correction section above is deliberately verbose. The
  contract's `gateRevision` rule exists to stop gate evidence collected at one
  revision from certifying a different one; documenting exactly why the bound
  revision moved from the implementation's last commit to a later point, with
  a cryptographic (`sha256sum`) rather than narrative equivalence proof, is
  the same discipline applied to itself.

## Verdict

T73 is complete. Six of six specification criteria (CAM-01 through CAM-06)
and every issue #14 acceptance/checklist outcome have file-and-assertion
evidence. Both declared gates pass at the reachable bound revision, the
focused evidence (62 cases) exceeds the issue's 20-campaign minimum, and six
of six independent behavior mutations are killed with no survivor.

This verdict does not claim that the two probabilistic campaigns sampled a
live provider, that Verchestra has a public installer, or that it is
production-ready. T74 (the sealed-holdout evaluator and promotion gate) is
the next qualification task. Human review of this report remains mandatory in
the pull request named by `reviewedIn`.
