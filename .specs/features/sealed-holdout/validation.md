# T74 Sealed-Holdout Independent Validation

## Repeat verification — 2026-08-17

### Verdict

**FAIL — T74 remains unqualified and the chain remains at "T73 complete;
T74 next".** The F1 authority boundary and F2 evidence binding are now
implemented and independently discriminated, but a new release-blocking gap
remains: the promotion gate accepts candidate-controlled campaign results
without runtime validation or evaluator-side recomputation.

This repeat verification is bound to
`36fb77fbc20c9d5cd2810196bf2007968eb7e087`, the current reachable `main`
revision. The F1/F2 remediations were authored by `accd`; this verification,
the adversarial experiment, and the eight-mutation sensor are authored by
`MiguelCorre`, preserving author != verifier. No
`docs/qualification/t74-validation.md` is added and no status surface advances.

### Passing and incomplete evidence

| Evidence | Result |
| --- | --- |
| Focused unit, contract, security, and E2E | 94 passed, 0 failed, 0 skipped, 0 todo |
| F1/F2 discrimination sensor | 8 killed, 0 survived; source restored and `git diff --exit-code` passed |
| `pnpm gate:quick` | PASS locally: 2,062 unit and 149 agent-readiness cases, zero skipped/todo |
| `pnpm gate:security` | INCOMPLETE locally: formatting, lint, complexity, typecheck, build, 2,062 unit, and 497 contract cases passed; E2E reached 164/165 before Windows returned `EBUSY` while removing a Self-Test temporary repository. Repeating the isolated file moved the same cleanup failure to another otherwise-passing case. The generated temporary directory was removed afterward. |
| Toolchain | Local Node 24.18.0 with pnpm 10.34.5; the repository pins Node 24.14.0, so these local gate runs are diagnostic and are not presented as final qualification evidence |

### F1/F2 re-verification

- **F1 PASS under AD-018.** `runPromotion()` now issues the candidate a real
  invocable grant over the oracle, criteria, evaluator state, and pre-seal
  report. The grant admits no read or mutation authority, and the denial is
  produced by the attempted operation rather than by a caller-supplied fact.
  Four mutations were killed: granting every protected asset, not invoking the
  candidate hook, hard-coding `grantedAssets` to empty, and replacing the deep
  snapshot with a shallow copy.
- **F2 PASS.** The admitted campaign evidence now changes `evidenceDigest`,
  `bodyDigest`, `payloadDigest`, and `sourceStateDigest`; the source-state digest
  binds both oracle and evidence. Four mutations were killed: a constant
  evidence digest, source state omitting evidence, source state omitting the
  oracle, and the signed body omitting `policyId`.
- **PROM-05 remains PARTIAL by explicit decision.** Contamination is still a
  supplied boolean fact. AD-018 did not promote it to an observed property.

### F3 — Blocker: candidate-controlled campaign results are trusted without validation

`apps/vestra-cli/src/promotion-composition.ts:CandidateFacts` includes
`results`, so the untrusted candidate supplies the evidence used to authorize
its own promotion. `assertInput()` only checks `Array.isArray(input.results)`.
`campaignBlocks()` then builds a `Map` whose duplicate ids use last-write-wins
and trusts `samples` and `lowerConfidenceBound` directly. It does not validate
the runtime shape, require an exact one-to-one result set, or recompute the
statistics through `evaluateCampaign()`.

The following five adversarial inputs all returned
`{"verdict":"PROMOTED","blocks":[]}` at the bound revision:

| Case | Candidate-supplied evidence |
| --- | --- |
| Forged metrics | `samples=50`, `passes=0`, `passRate=0`, `lowerConfidenceBound=1`, `verdict=FAIL` |
| Malformed bound | The same failing evidence with string `lowerConfidenceBound="1"`; JavaScript coercion clears the numeric threshold |
| Duplicate id | A failing `alpha` result followed by a passing `alpha` result; `Map` retains the latter |
| Extra failure | A passing required `alpha` plus an extra failed campaign; the extra failure is signed but ignored by the verdict |
| Live candidate mutation | `runPromotion()` starts with an honestly failed result; `candidate.attempt` replaces `candidate.results` with a forged bound before the input is built, and the final report is signed as `PROMOTED` |

This is not only defense in depth in the current composition: the values enter
through `CandidateFacts`, while the specification says the evaluator runs the
sealed evaluation and the candidate must not shape its promotion evidence. A
valid static TypeScript type does not establish runtime provenance or
consistency at this trust boundary.

Required remediation:

1. Remove campaign evidence from `CandidateFacts`; the composition root must
   obtain it from an evaluator-owned surface that the candidate cannot set.
2. Fail closed unless there is exactly one valid result for every sealed oracle
   entry and no duplicate or extra id.
3. Validate all runtime fields and recompute `passes`, `passRate`,
   `lowerConfidenceBound`, and verdict from evaluator-observed outcomes (or
   verify equivalent evaluator-authenticated evidence) rather than trusting
   reported aggregates.
4. Add unit, security, and E2E regressions for the five cases above and a
   discrimination mutation that removes the admission validation.

### Repeat sensor

Each mutation was applied alone, exercised by the smallest focused test, and
reversed immediately. Restoration was proven by `git diff --exit-code`.

| # | Property | Mutation | Result |
| --- | --- | --- | --- |
| M1 | F1 zero candidate authority | Grant read and mutation authority over every protected asset | KILLED |
| M2 | F1 production wiring | Do not invoke `candidate.attempt` from `runPromotion()` | KILLED |
| M3 | F1 observable authority | Hard-code `grantedAssets` to `[]` | KILLED |
| M4 | F1 read/write separation | Replace the structured snapshot with a shallow copy | KILLED |
| M5 | F2 evidence sensitivity | Replace `evidenceDigest` with a constant valid digest | KILLED |
| M6 | F2 source-state evidence binding | Hash only the oracle into `sourceStateDigest` | KILLED |
| M7 | F2 source-state oracle binding | Hash only the evidence into `sourceStateDigest` | KILLED |
| M8 | F2 signed-body completeness | Replace the signed `policyId` with a constant | KILLED |

### Next action

The T74 implementation author remediates F3 with behavior-focused unit,
security, and E2E evidence. A verifier who did not author that remediation then
repeats the admission attack, focused audit, qualified-runtime security gate,
and sensor. Only a PASS report named `docs/qualification/t74-validation.md` may
advance the chain to T75.

## First verification — 2026-08-11

### Verdict

**FAIL - T74 remains unqualified and the chain remains at "T73 complete;
T74 next".** Two release-blocking acceptance gaps remain even though the
implemented rule surface, focused tests, discrimination sensor, and declared
gates pass.

This validation is bound to
`cdd73b764b85732f797da68df84f3f01eabb9f5a`, the reachable `main` revision
that contains T73 qualification, the complete T74 implementation, the V2
canonical-JSON correction, and the current DSSE-backed `ArtifactSealer`.

The T74 implementation was authored by the repository owner identity
`Test`/`accd` in PR #190, with the V2 oracle correction authored by
`brunomjanuario` in `1c178c4`. This validation and its discrimination campaign
are authored by `MiguelCorre`, who authored neither implementation surface.

## Passing evidence

| Evidence | Result |
| --- | --- |
| Focused unit, contract, security, and E2E | 58 passed, 0 failed, 0 skipped, 0 todo |
| Security + E2E issue minimum | 12 security + 13 E2E = 25 cases, meeting the numeric floor |
| `pnpm gate:quick` | PASS locally at the bound revision |
| `pnpm gate:security` | PASS in [run 31528394240](https://github.com/accd/verchestra/actions/runs/31528394240) at the exact bound revision: 1,992 unit, 495 contract, 163 E2E, 25 architecture, 251 qualification, 1,021 security, and 283 fault cases (4,230 total), with zero failed, skipped, or todo |
| Discrimination sensor | 7 killed, 0 survived; source restored and 48 unit/security/E2E cases passed afterward |

Passing tests establish that the implemented rules behave as their current
fixtures describe. They do not establish the two missing acceptance
boundaries below.

## Ranked findings

### F1 - Blocker: evaluator process, storage, and policy isolation is not implemented or testable

Issue #15 requires a separate evaluator identity, process, storage, and policy,
and its completion checklist requires proof of evaluator/candidate process and
storage isolation. The implementation provides only identity separation:

- `apps/vestra-cli/src/promotion-composition.ts:CandidateFacts` models the
  candidate as inert facts in the evaluator's own process.
- `runPromotion()` receives the oracle and candidate facts in the same function
  and constructs no process, storage, or policy boundary.
- The security/E2E fixtures never execute a candidate process or attempt an
  unauthorized oracle/store read or write. They can prove a different key id,
  but cannot discriminate a missing process or storage boundary.

The statement that the candidate receives only a digest is therefore a model
assumption, not an observed isolation property. A candidate with no executable
or authority surface cannot attempt the forbidden access that the acceptance
criterion requires the evaluator to resist.

Required remediation:

1. Introduce an evaluator boundary with explicit candidate/evaluator process,
   storage, and policy authority separation, or record an owner-approved scope
   change to issue #15 and the canonical specification before implementation.
2. Add security/fault cases in which a candidate attempts to read or mutate the
   oracle, criteria, evaluator state, and pre-seal report, and prove every
   attempt is denied without relying on a caller-supplied assertion.
3. Preserve the distinct signing identity tests; identity separation is
   necessary but not sufficient.

### F2 - Blocker: the signed promotion decision does not bind campaign evidence

PROM-06 and issue #15 require the promotion decision to bind the exact
candidate, campaign, policy, threshold, evidence, and evaluator identity. The
current report binds candidate, sealed oracle, policy, evaluator identity,
verdict, and block codes, but not the admitted campaign results:

- `PromotionReportPayload` and `promotion-report@1` contain no evidence or
  result digest.
- `canonicalBody()` therefore excludes samples, passes, pass rate, lower
  confidence bound, and result identity.
- `promotion-composition.ts` supplies `sourceStateDigest` as a hash of the
  oracle only, not the evaluated results.

A direct comparison at the bound revision used the same candidate and oracle
with two different passing evidence sets: `(passes=100, lowerBound=0.99)` and
`(passes=90, lowerBound=0.81)`. Both were promoted and produced identical
reports, `bodyDigest`, sealed `payloadDigest`, and `sourceStateDigest`:

`{"bothPromoted":true,"sameReport":true,"samePayloadDigest":true,"sameSourceStateDigest":true}`

The signed artifact therefore cannot distinguish which campaign evidence
authorized promotion.

Required remediation:

1. Canonicalize the admitted campaign evidence and bind its digest into the
   promotion report and sealed artifact.
2. Change `promotion-report@1` through its schema and generator, never by
   editing the generated type directly.
3. Add unit, contract, security, and E2E assertions proving that any change to
   samples, passes, confidence bound, verdict, campaign identity, or evidence
   order changes or invalidates the bound evidence digest.
4. Add a discrimination mutation that removes the evidence binding and is
   killed by those assertions.

## Adequacy matrix

| Requirement | Result | Evidence / gap |
| --- | --- | --- |
| PROM-01 sealed oracle | PASS | Unit drift/tamper cases, security seal sensitivity, and M1 |
| PROM-02 candidate immutability | PASS | Unit/security/E2E mutation cases and M2 |
| PROM-03 sufficient repetition | PASS | Unit/security/E2E insufficient and missing-result cases and M5 |
| PROM-04 no threshold drift | PASS | Changed threshold invalidates the oracle seal; M1 |
| PROM-05 contamination blocks | PARTIAL | The rule blocks a supplied `contaminated: true` fact and M4 proves the branch; F1 shows no observed isolation/detection boundary |
| PROM-06 signed report binds exact evidence | FAIL | Report tamper checks and M6 cover fields that exist; F2 proves campaign evidence is absent |
| PROM-07 promote only when clean | PASS | Clean, exact-threshold, failed-campaign, accumulated-block cases and M7 |
| PROM-08 adequate evidence and review | FAIL | Numeric case floor and gates pass, but independent verification found F1/F2; human review remains pending |

## Discrimination sensor

Each mutation was applied alone in a disposable detached worktree at the bound
revision. After every run the source was restored; `git diff --exit-code`
proved restoration and the clean 48-case unit/security/E2E run passed.

| # | Mutation | Result |
| --- | --- | --- |
| M1 | Remove the sealed-oracle digest comparison | KILLED by the tampered-oracle and threshold-drift unit cases |
| M2 | Remove the candidate digest mutation block | KILLED by five unit/security/E2E assertions |
| M3 | Remove the shared evaluator/candidate identity block | KILLED by three unit/security/E2E assertions |
| M4 | Remove the contamination block | KILLED by seven unit/security/E2E assertions |
| M5 | Stop enforcing the sealed repetition count | KILLED by three unit/security/E2E assertions |
| M6 | Stop recomputing the promotion report body digest | KILLED by the unit and security report-tamper assertions |
| M7 | Return `PROMOTED` even when the block set is non-empty | KILLED by 17 unit/security/E2E assertions, including report verdict consistency |

All seven implemented rule properties are load-bearing. The sensor cannot turn
an absent process/storage boundary or absent evidence field into coverage; those
are specification gaps, not surviving mutations of existing behavior.

## Next action

The implementation authors remediate F1 and F2. A verifier who did not author
that remediation then repeats the focused audit, the security gate, and a
discrimination sensor. Only a PASS report named
`docs/qualification/t74-validation.md` may advance the chain to T75.
