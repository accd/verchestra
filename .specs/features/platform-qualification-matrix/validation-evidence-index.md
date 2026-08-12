# Independent verification — T75 evidence index generator

Five verification passes by the same independent verifier (author ≠ verifier).
Part X is the current round over `fe169b2`. Part Y is the fourth round over
`c5c723c`. Part Z is the third round over `53a241d`. Part A is the second round
over `ce9ff65`. Part B is the first round over `bc4a910`, whose FAIL verdict was
committed as `1fe398a` before any fix. All five are kept because the earlier ones
are committed evidence.

---

# Part X — Fifth round: verification of `fe169b2`

**Verdict: FAIL**, on one behavioural finding and three unpinned properties. Every
item on the round-4 list is verified closed, the committed fleet inputs are
byte-faithful under a check stricter than the repository performs, and the drift
test is a real regression anchor rather than a restatement. The blocker is a
single comparison: the stale-declaration rule still requires unanimity, so a
declaration the fleet has outgrown stays silent as soon as one dispatch disagrees
— the mirror of the S4 hole this commit fixed, in the adjacent branch of the same
function.

- Baselines: unit **47 pass / 0 fail / 0 skipped / 0 todo**; drift **2 pass / 0
  fail**
- Source restored byte-identically after every mutation
  (`git diff --exit-code -- scripts/t75-evidence-index.mjs` clean after each).

## X1. The ten claims

| # | Claim | Verdict | Evidence |
| - | ----- | ------- | -------- |
| 1 | S3 pinned: an expected leg returning `missing`/`digest-mismatch` is a shortfall | **True** | `tests/unit/…` "an expected leg that went missing or mismatched is a shortfall, not only one that failed", parameterised over both statuses. |
| 2 | S4 pinned: non-unanimous inconsistency | **True, in the direction it covers** | "one bad run among good ones is enough to contradict a declaration" now has the leg green in four dispatches and failed in one, and asserts the citation names the dissenting run. The **stale** direction of the same asymmetry is untouched — gap 1. |
| 3 | Both dead consistency rows pinned | **True** | "a not-qualified declaration predicts every way a leg can fall short" iterates the statuses; "a contract-qualified declaration predicts nothing the fleet can observe". |
| 4 | Undeclared leg refused | **True** | `scripts/t75-evidence-index.mjs:95-99, 278`; test present. Closes round-4 gap 3 on the same reasoning as the gate rule. |
| 5 | Duplicate legs refused | **True** | `:140-146`; test present. Closes round-4 gap 4. |
| 6 | Dead `?? new Set()` retired; declaration validated up front | **True** | `:60, 250-262, 275`; a mutation restricting validation to the fleet dimensions is killed by two tests. |
| 7 | `excused` carried on the gate-profile observation | **True, unevenly pinned** | Verified live: `{"gate":"gate:security","runId":"run-security","status":"qualified","excused":["darwin-x64=qualified"]}`. Dropping it for profiles that *also* fell short is undetected — gap 3. |
| 8 | `digestProvenance` states recomputed vs transcribed | **True** | Asserted by value, and inside `body`, so it is covered by the body digest. One improvement in X4. |
| 9 | `--out` and `--revision` with no value refused | **True** | `:357-362`; CLI test asserts exit 1 and the usage text. |
| 10 | Publication: four fleet inputs committed, drift test regenerates 52/40/1 plus the excused scope, labelled interim | **True — and I now consider C6 substantially met** | See X3. |

## X2. Gap 1 — the stale rule still requires unanimity

`scripts/t75-evidence-index.mjs:219` fires the stale-declaration contradiction only
when `dissenting.length === 0`. The inconsistency branch two lines below (`:224`)
filters per observation and fires if *any* observation is unpredicted. One
direction was made non-unanimous this round; the other was not.

`darwin-x64` is declared `environmental` — "never dequeues on the retiring Intel
fleet". Observed qualified in four dispatches and missing in a fifth:

```
darwin-x64 observed : missing,qualified,qualified,qualified,qualified
status              : environmental
contradiction       : NONE
total contradictions: 0        (so the CLI exits 0 — a clean generation)
```

Unanimous green on the same case is reported correctly, which is what makes the
asymmetry visible rather than a design choice.

This is not an exotic input. It is the single most likely future observation for
this exact case: matrix.md records `darwin-x64` as environmental precisely because
Intel capacity is intermittent, and instructs a re-dispatch "if Intel capacity
returns". The index is the mechanism that would report that it had — and it goes
quiet the moment the return is partial. The same shape applies to any
`not-qualified` platform that starts passing in most dispatches.

No false qualification results — `environmental` is never counted as a pass — so
the harm is silence, not over-claim. But the function's own contract is "Fails
closed in every direction the evidence can disagree" (`:197-201`), and this is a
direction where the evidence disagrees and nothing is recorded, counted, or
surfaced through the exit code.

## X3. The committed inputs and the drift test

**The fleet files are byte-faithful, and I checked them harder than the repository
does.** For each of the four:

```
bytes == JSON.stringify(index, null, 2) + newline : true   (what platform-matrix.yml writes)
leg order == the workflow's EXPECTED_LEGS order   : true
identityDigest verified                           : 4/4
legDigest reconstructed from the runner's record  : 4/4
```

The last line is the load-bearing one. `legDigest` covers
`{schemaVersion: 2, identity, identityDigest, outcome}` — material the fleet index
does **not** carry, because the index job strips `schemaVersion` and `outcome` when
it projects a leg. I reconstructed that record independently (`result: "pass"`
implies `reported: "success"`) and every one of the sixteen digests matched. Those
digests could not match if the identities, their digests, or the runner outcomes
had been normalised, reordered, or retyped. The `runId`s also match the four runs
matrix.md records at `9aab070` (security 31327128912, full 31327134227, build
31327140097, release 31327146281), and `complete: false` on all four is consistent
with the Intel leg never reporting.

**No secrets or machine-local content.** A scan for tokens, credentials, bearer
strings, Windows drive paths and POSIX home paths returns nothing. The only
environment-derived fields are `ref: refs/heads/main` and `runner:
Windows|Linux|macOS`, both public CI metadata.

**The drift test discriminates, and its role is narrow by construction.** It is not
a restatement: mutation V5 (narrowing the leg vocabulary to green-declared
platforms) changed the real verdict and the drift test failed on it. But it
survived five of my six mutations, which is expected of a golden test over one
input — it anchors this verdict against regression; it does not sense behaviour in
general. The unit suite has to carry discrimination, and that is where the three
survivors below sit. Worth stating plainly in the T75 report so no reader mistakes
the drift test for a proof of the generator.

**On C6: I now consider it substantially met, and I am withdrawing my earlier
objection.** My round-4 point was that the numbers could not be re-derived by
anyone. They can now: inputs, generator, and expectation are all committed, and a
gate runs them. That the artifact itself is not yet committed at the qualification
revision is correct sequencing, not an omission, and it is labelled interim in the
test, the handoff, and the commit. What remains for B3 is to replace the inputs and
the expectation with the real dispatch — which the test already says.

## X4. Independent sensor — six fresh mutations, both suites

Disjoint from the eleven reported dead. Each run against the unit suite **and** the
drift test.

| # | Mutation | Unit | Drift |
| - | -------- | ---- | ----- |
| V1 | The stale check needs at least two observations | **SURVIVED** | survived |
| V2 | `excused` dropped from the observation when the profile also fell short | **SURVIVED** | survived |
| V3 | An unpredicted observation downgrades the case status instead of leaving the declaration standing | **SURVIVED** | survived |
| V4 (control) | A leg absent from a dispatch is neither excused nor a shortfall | killed | survived |
| V5 (control) | The leg vocabulary narrowed to green-declared platforms | killed (9 tests) | **killed** |
| V6 (control) | The declaration validated only on the reconciled dimensions | killed (2 tests) | survived |

**3 killed, 3 survived.**

- **V1** is gap 1 expressed as a mutant: the stale rule is pinned only at five
  observations, so any narrowing of it goes unnoticed.
- **V3** is more than a test gap. It changes what the artifact *says*: an
  `environmental` case observed failing would be rewritten to `not-qualified`, and
  `summary.environmental` / `summary.notQualified` would move with it. Neither
  suite notices, because no fixture asserts the status of a case in the
  inconsistent branch and the real input has no inconsistent dissent. The rule
  "an observation never rewrites a reviewed declaration" is stated in the comment
  at `:197-201` and pinned only for the stale branch.
- **V2** removes the scope exactly where a reader needs it most — a profile that
  fell short *and* excused something. The round-4 gap-7 fix is pinned only for
  fully covered profiles.

## X5. Vacuity re-check

- **Fixtures cannot express two shapes**: a non-qualified case observed *qualified*
  in some dispatches and dissenting in others (gap 1 / V1), and a profile carrying
  both a shortfall and an excused leg (V2).
- **Unasserted output**: the `status` field of any case reached through the
  inconsistent branch (V3), and with it two summary tallies.
- **Not vacuous, and a real advance**: the S3 test is parameterised over both soft
  statuses; the S4 test now has genuinely mixed observations; the consistency table
  is exercised row by row; the leg and duplicate rules are pinned; the CLI is
  driven through three invocation orders and both option faults; the drift test is
  anchored to committed inputs and demonstrably fails on a behavioural change.
- **`legDigest` could be verified further than the artifact claims**: for any leg
  whose status is `qualified`, `result: "pass"` implies `reported: "success"`, so
  the sealed record is fully reconstructible — I recomputed all sixteen. The
  ambiguity is only for failing legs, where `reported` may be `failure` or
  `cancelled`. `digestProvenance` could honestly say `recomputed-for-passing-legs`.
  An improvement, not a gap.

## X6. Test integrity and gates

- No test weakened, skipped, or deleted: the unit suite grew from 39 to 47 cases
  and a 2-case drift suite was added; no `skip`, `todo`, or `only`.
- Working tree carries no change to `scripts/` or `tests/`; every mutation was
  reverted byte-identically.
- `corepack pnpm gate:quick`: **PASS** — exit code 0, final line `gate:quick PASS`;
  the agent-readiness stage reported `tests 147 / pass 147 / fail 0 / skipped 0 /
  todo 0` (145 before, plus the two new drift cases), and the unit stage containing
  the 47 evidence-index cases passed in the same run.

## X7. Gaps, most severe first

1. **The stale-declaration rule requires unanimity** (`:219`): a declaration the
   fleet has outgrown is silenced by a single dissenting dispatch, which for
   `darwin-x64` is the expected future observation. One comparison, and it is the
   only item blocking this round.
2. **The inconsistent branch's status preservation is unpinned** (V3): the case
   status and two summary tallies can change with both suites green.
3. **`excused` on the gate-profile observation is pinned only for fully covered
   profiles** (V2).
4. **The stale rule is pinned only at five observations** (V1) — the test-side
   half of gap 1.
5. **`digestProvenance` understates what is checkable**: `legDigest` is fully
   reconstructible for passing legs.
6. **The drift test is a single-input anchor, not a sensor** — correct as designed,
   but the T75 report should say so rather than let it read as a proof of the
   generator.

## X8. Shortest path to PASS, and what a reader still must not conclude

Path: make the stale branch per-observation like the inconsistent one — report when
any observation is `qualified` and the declaration is not (gap 1) — with a fixture
that has a non-qualified case green in some dispatches and dissenting in another
(gap 4); assert the case status and summary tallies on an inconsistent-branch row
(gap 2); assert `excused` on a profile that also fell short (gap 3).

When it lands, a reader of the published index still must not conclude:

- **that a `qualified` gate-profile row means the profile ran everywhere.** It
  means every declared platform expected green was green in that dispatch; the
  `excused` list on the row is the rest of the scope.
- **that a `qualified` platform row means the platform passed every stage.** It
  means every supplied dispatch that carried the leg saw it green — and only four
  of the five profiles were dispatched at this candidate.
- **that the index is signed, or that anything vouches for it.** `signingState.signed`
  is `false`; the body digest is self-computed and the artifact carries no
  signature at all.
- **that `legDigest` was checked here.** `digestProvenance` says it was transcribed
  from the fleet index, whose producer checked it.
- **that the committed evidence describes the release candidate.** `9aab070` is
  not the qualification revision; this is interim evidence and the drift test says
  so.
- **that zero contradictions would mean T75 is complete.** The one contradiction
  standing — `gate-profile/quick` — is a finding about T75, and the dimensions the
  fleet cannot answer (databases, sandboxes, drivers, installers) pass through from
  the declaration untouched and are not evidence of anything the index verified.

---

# Part Y — Fourth round: verification of `c5c723c`

**Verdict: FAIL**, and the character of the failure has changed completely. Every
structural finding from rounds 1-3 is genuinely closed, and **no input a real
fleet dispatch can produce now yields a wrong verdict**. What remains is a
test-strength and input-validation failure: four of six fresh mutations survive —
including one that reproduces my round-3 finding verbatim, on logic reported as
fixed — and two open vocabularies let supplied evidence be silently ignored or
produce a self-contradicting artifact.

- Baseline: `node --test tests/unit/t75-evidence-index.test.mjs` → **39 pass, 0
  fail, 0 skipped, 0 todo**
- Source restored byte-identically after every mutation
  (`git diff --exit-code -- scripts/t75-evidence-index.mjs` clean after each).

## Y1. The eight claims

| # | Claim | Verdict | Evidence |
| - | ----- | ------- | -------- |
| 1 | Each non-qualified status declares the observations it predicts; anything outside is contradicted by name | **True, and the over-correction you asked about is absent** | `scripts/t75-evidence-index.mjs:54-60, 224-229`; `tests/unit/…:482-520`. Verified live: an `environmental` leg green in four dispatches and failed in one is still contradicted (`declared environmental, which does not predict failed in gate:quick`), and a green leg is never a shortfall (`:166`). Two dead rows in the table — see Y3/S1-S2. |
| 2 | `consumed` no longer contains 0 when `--out` is absent | **True** | `:334-336`; `tests/unit/…:578-592`. Verified by hand across the failing round-3 shape: five files first, no `--out`, no separator → `profiles used: 5, contradictions: 0`. Round-3 gap 2 is closed. |
| 3 | Coverage computed over every declared platform case | **Code true, assertion missing** | `:153-171` iterates `platformCases`. But this changed *which cases* are considered, not *which observed statuses* count as a shortfall — and my round-3 mutation on the latter still survives verbatim. See Y3/S3. |
| 4 | Leg identity verified whatever the outcome; an identity with no digest is refused | **True** | `:76-88, 97`; `tests/unit/…:546-566`. |
| 5 | The `gate:` prefix is required; a tail match is refused | **True** | `:134`; `tests/unit/…:568-576, 594-601`. Round-3 gap 5 closed, including the mis-keying consequence. |
| 6 | Each profile records `excused` | **True, with one readability gap** | `:153-171, 261, 289-291`; `tests/unit/…:533-544`. Verified live: `excused: ["darwin-x64=absent"]`. The set lives on the profile, not on the gate-profile case row — see gap 7 below. |
| 7 | The no-expected-platform case throws | **True** | `:256-259`; `tests/unit/…:522-531`. |
| 8 | Publish is still open, and you are not claiming otherwise | **Confirmed, and I have a concrete answer** | See Y4. |

### The direction you asked me to attack

Both halves hold. A case declared `not-qualified` that fails stays silent
(`tests/unit/…:504-520`, and I reproduced it: all five profiles `qualified`, 0
contradictions), and a green leg is excused rather than counted as a shortfall
(`:166`) — confirmed indirectly by the stale-declaration test, which would report
six contradictions instead of one if green blocked coverage.

The `not-qualified` route is now the only way a declaration can relax its own
verification, and it is **honest**, because it costs a visible status change and
is fully recorded. Reproduced at the boundary — one platform declared qualified,
the other four `not-qualified`, and those four failing in every dispatch:

```
gate-profiles: quick=qualified,full=qualified,build=qualified,security=qualified,release=qualified
contradictions: 0
excused on run-quick: ["linux-x64=failed","linux-arm64=failed","darwin-arm64=failed","darwin-x64=absent"]
```

Zero contradictions, but the four failures are named in `excused`, the four rows
read `not-qualified`, and `summary.notQualified` counts them. Nothing is hidden.
That is the boundary of what reconciling against a declaration can do, and I do
not count it against you. The same applies to the live `gate-profile/quick`
finding: declaring `quick` `not-qualified` would dissolve the contradiction, but
only by publishing the same truth the contradiction was pointing at.

## Y2. Two open vocabularies (new findings)

**An undeclared leg is silently ignored, while an undeclared gate is refused.**
`profileCoverage` iterates the declared platform cases (`:157`), so a leg present
in the file but absent from the matrix is neither a shortfall nor excused, and its
observation is keyed where no case reads it. A **failing** `freebsd-x64` leg:

```
gate-profile/security: qualified   |   excused for that profile: ["darwin-x64=absent"]
leg present in profiles[].legs: true   (and influences nothing else)
```

One commit ago you closed exactly this hole on the gate side — "a gate name the
matrix does not declare is refused" (`:134`) — on the reasoning that a name
accepted here and unused later discards the run. The leg vocabulary deserves the
same rule. A real workflow index cannot carry an undeclared leg (`EXPECTED_LEGS`
is pinned and the case set is bound by the agent-readiness test), so this is
defence-in-depth — but so was the gate check.

**A duplicate leg name makes the verdict depend on array order.**
`new Map(profile.legs.map(...))` (`:154`) is last-wins, while `fleetObservations`
records every entry. The same index with `win32-x64` listed twice:

```
failed then qualified : gate-profile/security = qualified  |  platform/win32-x64 = not-qualified
qualified then failed : gate-profile/security = not-qualified
```

The first line is an artifact that contradicts itself: one row says the platform
is not qualified, another claims the profile covered it. Refusing a repeated leg
name is one line, and matches how a repeated `runId` is already refused (`:127`).

## Y3. Independent sensor — six fresh mutations

Disjoint from the ten reported dead. Baseline **39 pass, 0 fail**; restored
byte-identically after each.

| # | Mutation | Result | Failing test |
| - | -------- | ------ | ------------ |
| S1 | The `not-qualified` row of the consistency table keeps only `failed` | **SURVIVED** (39/39) | none |
| S2 | The `contract-qualified` row excuses every observation instead of none | **SURVIVED** | none |
| S3 | An expected-green leg returning `missing` or `digest-mismatch` is no longer a coverage shortfall | **SURVIVED** | none |
| S4 | The inconsistency check fires only when *every* observation dissents | **SURVIVED** | none |
| S5 (control) | A leg absent from a dispatch is excused for a declared-qualified case | killed (38/39) | "a gate profile that half-ran has not exercised its stages" |
| S6 (control) | `excused` entries lose the status they were excused on | killed (38/39) | "a profile records which legs its coverage claim excused" |

**2 killed, 4 survived.**

- **S3 is the round-3 finding, unpinned.** Gap 3 was reported fixed; the code did
  change, and the shipped behaviour is correct — but the identical mutation still
  passes the suite, because no fixture places an expected leg in `missing` or
  `digest-mismatch` inside a dispatch whose other legs are green. A fix that
  cannot fail is a fix that can regress silently.
- **S4 is new and the same shape.** The mixed case — an `environmental` leg green
  in four dispatches and failed in one — is handled correctly by the code (I ran
  it), but every fixture that exercises the inconsistency rule has *all*
  observations dissenting, so narrowing the rule to unanimity is undetectable.
  That is the exact scenario where a single bad run hides inside a mostly-good
  declaration.
- **S1 and S2 are dead table rows.** Three of the four `not-qualified` entries
  (`digest-mismatch`, `missing`, `incomplete`) are never exercised, and
  `incomplete` is unreachable for a platform case at all; the
  `contract-qualified` row is entirely unreachable because no fleet-answerable
  case declares that status. The `?? new Set()` fallback in `dissentIsConsistent`
  (`:60`) is likewise dead.

## Y4. Publish (your question), and digest provenance

**On scheduling: right call, but two cheap things are missing.** Not committing an
interim index bound to a non-candidate revision is correct, and leaving the
committed artifact to B3 is the right ownership. But as it stands nobody can
re-derive the headline. The four real fleet indexes at `9aab070` are not in the
repository, so "52 cases, 40 qualified, 1 contradiction" cannot be checked by a
reader, reproduced by a successor, or drift-tested by a gate — which is precisely
the condition the output-path comment says it is escaping ("a number retyped out
of a terminal"). Two additions would make the eventual commit mean something:

1. Commit the fleet indexes the published index was built from, next to it. They
   are small, immutable, and already bound to the candidate revision.
2. Add a drift test in the precedent's style (`tests/unit/proof-artifact.test.mjs`)
   that regenerates the committed index from the committed inputs and fails on
   disagreement. Without it, the committed artifact and the generator can diverge
   with nothing noticing — the same argument that made `excused` worth recording.

**On gap 9 (verified vs transcribed digests): my round-3 acceptance covers the
transcription, not the silence about it.** Not recomputing `legDigest` is right —
the fleet index genuinely lacks the material (`platform-matrix.yml:308-314` drops
`schemaVersion` and `outcome`). But the artifact now presents two identically
shaped fields with different epistemic status: `identityDigest` was re-derived
here, `legDigest` was copied from a file. A downstream verifier cannot tell how
far the checking went. One field or one sentence closes it. Low severity, and it
should not hold up the round on its own.

## Y5. Vacuity re-check

- **Fixtures still cannot express two live shapes**: an expected leg in `missing`
  or `digest-mismatch` inside an otherwise-green dispatch (S3), and a
  non-qualified case whose observations disagree with each other (S4). Both are
  where this round's new logic actually lives.
- **Dead code**: the `contract-qualified` consistency row, three of four
  `not-qualified` entries, the `?? new Set()` fallback (`:60`).
- **Not vacuous, and a real advance**: the CLI is now driven through three
  invocation orders including the one that used to lose a file; the environmental
  and not-qualified directions are both pinned; `excused` is compared by value;
  the no-expected-platform floor throws; identity verification is pinned for a
  failed leg and for a missing digest.
- **One CLI wart**: `--out` with no value reaches `writeFile(undefined)` and exits
  through an internal `getValidatedPath` stack trace after doing all the work. It
  fails loudly and writes nothing, so it is cosmetic.

## Y6. Test integrity and gates

- No test weakened, skipped, or deleted: the suite grew from 30 to 39 cases; no
  `skip`, `todo`, or `only`; every earlier assertion survives or is strengthened.
- Working tree carries no change to `scripts/` or `tests/`; every mutation was
  reverted byte-identically, and the two `evidence-index.json` files generated
  while exercising the CLI were removed.
- `corepack pnpm gate:quick`: **PASS** — exit code 0, final line `gate:quick PASS`;
  the agent-readiness stage reported `tests 145 / pass 145 / fail 0 / skipped 0 /
  todo 0`, and the unit stage containing the 39 evidence-index cases passed in the
  same run.

## Y7. Gaps, most severe first

1. **The round-3 coverage fix is unpinned** (S3): an expected-green leg returning
   `missing` or `digest-mismatch` counting as covered still survives the suite.
   The behaviour is right; nothing holds it there.
2. **The inconsistency rule is only pinned for unanimous dissent** (S4): one bad
   run inside a mostly-consistent declaration can be silenced undetected.
3. **The leg vocabulary is open** where the gate vocabulary is closed: an
   undeclared leg — including a failing one — is accepted, recorded, and
   influences nothing.
4. **A duplicate leg name yields an order-dependent, self-contradicting artifact**;
   a repeated `runId` is already refused, a repeated leg is not.
5. **Two consistency-table rows are dead** (S1, S2), along with the
   `dissentIsConsistent` fallback.
6. **Publish remains open**, and the inputs to the live run are not committed, so
   the published numbers cannot be re-derived or drift-tested by anyone.
7. **`excused` is on the profile, not the gate-profile row**: a reader of
   `gate-profile/security = qualified` must join to `profiles[]` by `runId` to
   learn the scope; the observation entry itself carries no hint.
8. **Digest provenance is unstated** (gap 9): recomputed and transcribed digests
   are indistinguishable in the artifact.
9. **`--out` with no value crashes with an internal stack trace** rather than the
   usage error the other argument faults produce.

## Y8. Shortest path to PASS

Four assertions and two lines of validation:

1. A fixture with an expected leg in `missing` and one in `digest-mismatch` inside
   an otherwise-green dispatch, asserting the profile is incomplete (gap 1).
2. A fixture where a non-qualified case is observed qualified in some dispatches
   and inconsistently in another, asserting the contradiction still fires (gap 2).
3. Refuse a leg the matrix does not declare, and refuse a repeated leg name
   (gaps 3-4) — two lines, mirroring the gate and `runId` rules.
4. Either exercise or delete the dead consistency rows (gap 5).

Gaps 6-9 are honest carry-overs and should not block the round on their own,
though committing the fleet indexes alongside the published index (gap 6) is the
one that decides whether the published artifact can ever be verified.

---

# Part Z — Third round: verification of `53a241d`

**Verdict: FAIL.** Narrower again, and the trajectory is real: round 1 found a
concatenation where a reconciliation was claimed, round 2 found a second
fleet-answerable dimension left unreconciled, and this round finds no structural
absence at all. It fails on a soundness hole inside the new coverage rule, one
outright bug that silently discards a supplied fleet index, and a sensor in which
five of seven fresh mutations survive.

Checked at HEAD `336be19` (the tip moved during this pass; `336be19` is docs-only
over `53a241d` — `git diff --stat 53a241d 336be19` touches two `.md` files, so
every code finding below applies to both).

- Baseline: `node --test tests/unit/t75-evidence-index.test.mjs` → **30 pass, 0
  fail, 0 skipped, 0 todo**
- Source restored byte-identically after every mutation
  (`git diff --exit-code -- scripts/t75-evidence-index.mjs` clean after each).

## Z1. The nine claims

| # | Claim | Verdict | Evidence |
| - | ----- | ------- | -------- |
| 1 | `gate-profile` reconciled; one observation table; gate vocabulary is the declaration's own case set | **True** | `scripts/t75-evidence-index.mjs:53, 108-112, 128-151`; `tests/unit/…:194-219`. Verified independently: one dispatch → the other four profiles `not-qualified` with the "no supplied fleet evidence" contradiction. An undeclared gate is refused (`:111-112`). One defect in the vocabulary path — see Z4/P3. |
| 2 | A dispatch covers its profile only if every leg the declaration **expects green** came back green | **Rationale sound, implementation unsound** | The reasoning about `environmental` is right; the implementation makes the declaration under verification decide how strictly it is verified, with no floor and no contradiction when a non-expected leg comes back red. See Z2 — this is gap 1. |
| 3 | Foreign-candidate leg refused; `identityDigest` recomputed; `legDigest` still transcribed | **True; transcription acceptable** | `:61-67, 74-77`; `tests/unit/…:101-122`. On `legDigest`: the fleet index genuinely lacks the material to recompute it — the workflow digests `{schemaVersion, identity, identityDigest, outcome}` and the index job drops `schemaVersion` and `outcome` when projecting a leg (`platform-matrix.yml:308-314`) — and the producer already recomputes it, surfacing disagreement as `digest-mismatch`, which this generator treats as dissent. Not a real gap. One caveat in Z5. |
| 4 | `complete` recomputed; a self-disagreeing index refused | **True** | `:114-118`; `tests/unit/…:124-134`. |
| 5 | Citing `runId`; `declaredStatus` on agreeing rows; vocabulary closed on every dimension | **True** | `:135, 181, 188`; `tests/unit/…:267-285, 298-310`. |
| 6 | CLI tests for both exit codes | **True, and they found a real bug** | `tests/unit/…:426-457`; verified by hand: `exit=0` clean, `exit=1` contradicting. But the fixture always passes `--out`, and that is precisely why gap 2 is invisible to it. |
| 7 | `--` tolerated | **True** | `:276`; exercised by the CLI tests, which invoke through the separator. |
| 8 | Output un-gitignored, moved to the feature directory, and the index built at the qualification revision **is committed** | **Half true — the second half is not true of the tree** | Un-gitignored and relocated: yes (`:36-39`, `.gitignore` row removed). Committed: **no**. `git ls-files` shows no `evidence-index.json` anywhere, and `docs/qualification/t75-validation.md` does not exist. The handoff itself scopes this correctly as remaining work under B3; the claim as put to me overstates it. C6 stays open. |
| 9 | R11 (DSSE predicate table) is **not** done | **False — it is done** | `.specs/features/dsse-attestation/migration.md:111` now carries a ninth row, "T75 qualification evidence index … `…/attestation/qualification-evidence-index/v1`", plus the scope sentence at `:126-127`. Added by `336be19`, which landed after the message describing this round. R11 is closed. |

### On the live `9aab070` finding

Treating `gate-profile/quick` as a true contradiction is **correct** and papers
over nothing: matrix.md:401-406 lists `security/full/build/release` at that
candidate and matrix.md:75 puts `quick` elsewhere, so the declaration is
unsubstantiated at the candidate and the index is right to refuse it.

One thing the headline number does hide, and it belongs in the report rather than
in a verifier's note: the same run silently converts four `darwin-x64` absences
into non-events through the expected-green rule, and nothing in the artifact
records that the exclusion happened. A reader of `gate-profile/security =
qualified` cannot tell from the row that it means "covered on the four legs the
declaration expects", not "ran everywhere". The observation entry carries
`{gate, runId, status}` and never names the expected set it was judged against.

## Z2. Gap 1 — the coverage rule lets the declaration decide how hard it is checked

`expectedLegs` is derived from the platform cases the same declaration marks
`qualified` (`:204-208`), and a dispatch is covered when every expected leg is
green (`:143-148`). Two consequences, both demonstrated against shipped code:

**A leg downgraded in the declaration stops being able to contradict anything.**
Declaring `linux-arm64` `environmental` and then supplying a fleet in which
`linux-arm64` **failed in every one of the five dispatches**:

```
P1 gate-profiles: quick=qualified,full=qualified,build=qualified,security=qualified,release=qualified
P1 linux-arm64 row: environmental | contradiction: NONE | observed: {"gate":"gate:quick","runId":"run-quick","status":"failed"}
P1 total contradictions: 0
```

The failure is in the artifact — the `observed` entry says `failed` — but nothing
counts it, nothing names it, and the CLI exits 0. The stale-declaration
contradiction (`:172-176`) only fires when **every** observation is qualified, so
`environmental` + `failed` is the one combination that produces silence. Yet
`environmental` means "not qualified for a reason **outside the product**"
(`matrix.json` statuses); a leg that dequeued and failed refutes that specific
reason. The rule "an observation never upgrades a declaration" has no counterpart
in the other direction.

**There is no floor.** With every platform case declared `environmental`, the
expected set is empty and an all-red fleet covers every profile:

```
P2 gate-profiles with an all-red fleet: quick=qualified,full=qualified,build=qualified,security=qualified,release=qualified
P2 contradictions: 0
```

The author applied exactly this defensive instinct one function earlier —
`complete` carries a `legs.length > 0 &&` floor (`:116`) — and not here.

**No existing test blocks either.** `tests/agent-readiness/t75-matrix-declaration.test.mjs`
pins the platform *case set* against the workflow, pins `darwin-x64` as
`environmental`, and requires a >40-character note on any non-qualified case. It
does not require any platform case to be `qualified`. So both edits above pass the
full gate.

The fix is small and does not disturb the rationale: excuse a leg only when the
observation matches the declared reason (`environmental` is discharged by
`missing`, not by `failed`/`digest-mismatch`), and refuse an empty expected set.

## Z3. Gap 2 — the CLI silently discards a supplied fleet index

`:271-276`. When `--out` is absent, `outAt === -1`, so
`consumed = new Set([revisionAt, revisionAt + 1, outAt, outAt + 1])` contains
`-1` **and `0`** — and `args[0]` is dropped from the file list. Two indexes
supplied with the flag after the files:

```
files before --revision, no --out : profiles actually used: run-security        (37/52, 4 contradictions)
documented order                  : profiles actually used: run-full,run-security (38/52, 3 contradictions)
```

`run-full` vanishes. The run still exits 1 and still writes a plausible index, so
the loss looks like a finding rather than a bug. This is silently discarded
evidence in the artifact whose stated purpose is to prevent exactly that. The CLI
tests never see it because they always pass `--out` (`tests/unit/…:438`) — a
fixture that cannot express the failing case, the same class as rounds 1 and 2.

## Z4. Independent sensor — seven fresh mutations

Disjoint from the fifteen reported as already dead. Baseline **30 pass, 0 fail**;
restored byte-identically after each.

| # | Mutation | Result | Failing test |
| - | -------- | ------ | ------------ |
| Q1 | A leg's revision and identity digest are verified only when it claims to pass | **SURVIVED** (30/30) | none |
| Q2 | Verification skipped for a leg that carries an identity but no `identityDigest` — bypassing the revision check too | **SURVIVED** | none |
| Q3 | The conditional gate-prefix strip becomes unconditional | **SURVIVED** | none |
| Q4 | A leg that came back `missing` or `digest-mismatch` still counts towards its profile's coverage; only `failed` withholds it | **SURVIVED** | none |
| Q5 | The `legs.length > 0` floor on recomputed completeness is dropped | **SURVIVED** | none |
| Q6 (control) | A profile missing one expected leg still counts as covering it | killed (29/30) | "a gate profile that half-ran has not exercised its stages" |
| Q7 (control) | `--out` parsed and ignored again | killed (28/30) | both CLI tests |

**2 killed, 5 survived.** Q4 is the most serious: the new coverage rule is only
enforced against `failed`, and no fixture ever places an expected leg in `missing`
or `digest-mismatch` inside an otherwise-complete dispatch. Q1 and Q2 sit directly
on this round's other new code: the leg verification can be narrowed to green legs,
or bypassed entirely for a leg that omits its digest, with nothing noticing — and
Q2's shape (`if (leg.identity && leg.identityDigest)`) is the exact defensive
edit a later contributor would plausibly make.

Q3 confirms the `startsWith(GATE_PREFIX)` branch at `:110` is dead code, and it is
inconsistent with the unconditional `slice` at `:145`. The consequence in shipped
code (P3):

```
P3 profile gate recorded: security | gate-profile/security => not-qualified
   | declared qualified, but no supplied fleet evidence covers this case
P3 observations landed under gate-profile: [["quick",0],["full",0],["build",0],["security",0],["release",0]]
```

A fleet index naming a declared profile without the `gate:` prefix passes
validation, is then keyed as `gate-profile/urity`, and its real evidence is
discarded while a false contradiction is reported. It fails closed, but by
discarding evidence and inventing a finding.

## Z5. Vacuity re-check

- **Fixtures still cannot express two live shapes**: an expected leg in `missing`
  or `digest-mismatch` inside an otherwise complete dispatch (Q4), and a CLI
  invocation without `--out` (Z3). Both are exactly where the round's two worst
  findings live.
- **Untested branches**: the gate-prefix conditional (Q3), the empty-legs profile
  (Q5), a leg with an identity but no digest (Q2), and a non-green leg's identity
  verification (Q1).
- **Not vacuous, and a genuine improvement**: the CLI is now exercised for both
  exit codes and its written file is parsed back; `observed` entries are compared
  by full value including the citing run; `declaredStatus` is asserted on every
  row; the closed vocabulary is checked on three dimensions including a non-fleet
  one; the digest test recomputes from published bytes.
- **One artifact-level caveat** (low): `identityDigest` is re-verified and
  `legDigest` is transcribed, and the index does not say which is which, so a
  downstream reader cannot tell how far the digests were checked.

## Z6. Test integrity and gates

- No test weakened, skipped, or deleted: the suite grew from 21 to 30 cases; no
  `skip`, `todo`, or `only`; every earlier assertion survives or is strengthened.
- Working tree contains no change to `scripts/` or `tests/`; every mutation was
  reverted byte-identically. Two generated `evidence-index.json` files produced
  while exercising the CLI were removed; `git status` is clean apart from this
  report.
- `corepack pnpm gate:quick`: **PASS** — exit code 0, final line `gate:quick PASS`;
  the agent-readiness stage reported `tests 145 / pass 145 / fail 0 / skipped 0 /
  todo 0`, and the unit stage containing the 30 evidence-index cases passed in the
  same run.

## Z7. Gaps, most severe first

1. **The coverage rule is governed by the declaration it verifies.** A leg
   downgraded to `environmental` can fail in every dispatch with zero
   contradictions and no effect on profile coverage; an all-`environmental`
   platform dimension makes an all-red fleet fully covering. No floor, no
   red-under-environmental contradiction, and no declaration test forbids either.
2. **The CLI drops `args[0]` whenever `--out` is omitted**, silently building the
   index from fewer runs than were supplied.
3. **Coverage is only enforced against `failed`** (Q4): an expected leg returning
   `missing` or `digest-mismatch` counting as covered survives the suite.
4. **The new leg verification is thinly pinned** (Q1, Q2): it can be narrowed to
   green legs or bypassed for a leg without a digest, undetected.
5. **The gate-prefix branch is dead and inconsistent** (Q3, P3): a declared but
   unprefixed gate is accepted, mis-keyed, its evidence discarded and a false
   contradiction reported.
6. **C6 (publish) is still open**: no `evidence-index.json` is committed anywhere
   and `t75-validation.md` does not exist. The path is now tracked and the ignore
   rule is gone, so the remaining step is small and is correctly scheduled in the
   handoff — but nothing is published today, and no gate ensures a committed index
   would stay in step with its generator.
7. **The gate-profile row does not state its own scope**: `qualified` means
   "covered on the expected legs", and neither the row nor its observations names
   which legs were excluded.
8. **The empty-legs profile is untested** (Q5).
9. **Verified and transcribed digests are indistinguishable in the artifact**
   (low; `legDigest` transcription itself is acceptable).

R11 is **closed**, not open: the DSSE predicate table carries the index at
`migration.md:111`.

## Z8. Shortest path to PASS

1. Discharge an `environmental`/`not-qualified` platform case only when the
   observation matches the declared reason, and record a contradiction when such a
   leg is observed `failed` or `digest-mismatch`; refuse an empty expected set
   (gap 1).
2. Fix the `--out` argument parsing and add a CLI case that omits `--out` (gap 2).
3. Add a fixture with an expected leg in `missing`/`digest-mismatch` inside an
   otherwise complete dispatch (gap 3), a non-green leg with a bad identity, and a
   leg carrying an identity without a digest (gap 4).
4. Make the gate-prefix handling one rule, and test the unprefixed input (gap 5).
5. Record the expected-leg set in the gate-profile observation so `qualified`
   states its own scope (gap 7).
6. Commit the index generated at the qualification revision beside the T75 report,
   with the fleet indexes it was built from, so it can be re-derived (gap 6).

---

# Part A — Second round: re-verification of `ce9ff65`

**Verdict: FAIL.** Substantially narrower than Part B: seven of the nine Part B
gaps are genuinely closed, and the reconciliation is real. It fails on two
findings, both of the class the remediation existed to remove — a second
fleet-answerable dimension is still concatenated, and the mechanism that enforces
the new contradiction rule has no test at all.

Evidence-or-zero, no benefit of the doubt, no claim accepted from the commit
message. Read-only on Git history; the source was temporarily mutated for the
sensor and restored byte-identically after every run
(`git diff --exit-code -- scripts/t75-evidence-index.mjs` clean after each, and at
the end).

- Verified commit: `ce9ff65` on `feat/t75-evidence-index-generator`
- Baseline: `node --test tests/unit/t75-evidence-index.test.mjs` → **21 pass, 0
  fail, 0 skipped, 0 todo**
- Requirement source unchanged: `matrix.md` section 8 and section 1 criterion 3

## A1. The nine claims, checked independently

| # | Claim | Verdict | Evidence |
| - | ----- | ------- | -------- |
| 1 | Reconciliation replaces concatenation; a platform case is qualified only if every covering profile observed it qualified; silence is not a pass; an observation never upgrades a declaration; both values plus the citing run are kept; contradictions drive a non-zero exit | **Partly true** | True for the **platform** dimension: `scripts/t75-evidence-index.mjs:106-127, 129-143`, pinned by `tests/unit/t75-evidence-index.test.mjs:88-153`. Verified independently: a red fleet yields four `not-qualified` rows with `declaredStatus: qualified` and 4 contradictions. **Not true for the `gate-profile` dimension**, which the fleet can also answer — see gap R1. The non-zero exit works (`exit=1` observed) but has zero test coverage — see R2. |
| 2 | `revision: null` refused with a distinct message | **True** | `:79-82` refuses any `index.revision !== revision` and names the null case "binds no single revision"; `tests/unit/t75-evidence-index.test.mjs:66-74`. The Part B escape at the old line 38 is gone. |
| 3 | Every supplied index is revision-checked | **True** | The check runs inside `fleetIndexes.map` (`:74-82`); pinned by the second-index case at `tests/unit/t75-evidence-index.test.mjs:76-82`. |
| 4 | Legs carry platform, arch, runtime, revision, identityDigest, legDigest | **True, with an unverified field** | `:54-70`; asserted field-by-field at `tests/unit/t75-evidence-index.test.mjs:212-221` and, for a leg that never ran, as explicit nulls at `:236-245`. But the leg's own `revision` is copied without being checked against the candidate (R3), and the digests are recorded without recomputation (R8). |
| 5 | Same-gate re-dispatch stays distinct; a duplicate runId is refused | **True** | `:83-86`; `tests/unit/t75-evidence-index.test.mjs:248-269`. |
| 6 | Declared and leg statuses are closed vocabularies | **Partly true** | Both sets exist and are enforced (`:40-41, 55, 130`). Leg statuses are closed for every leg. The declared-status check is only *tested* through the platform dimension, so restricting it to that dimension is undetectable (R5). The `gate` value is not closed at all (R6). |
| 7 | `canonicalizeJsonV2` with `canonicalizationVersion: 2`, registered, pinned by a downstream-verifier recomputation | **True** | `:32, 160, 183`; the recompute test rebuilds the body from the published fields and recomputes rather than trusting the written value (`tests/unit/t75-evidence-index.test.mjs:302-315`); new register row in `docs/canonical-json-compatibility.md`. The import style matches the repository precedent (`scripts/generate-proof-artifact.mjs:20`). |
| 8 | AD-014's scope boundary names the evidence index | **True** | `.specs/STATE.md:105` now reads "and the T75 qualification evidence index", with the matrix.md condition quoted. Part B gap G6 is closed. Minor follow-through: the DSSE migration plan's per-artifact predicate table (`.specs/features/dsse-attestation/migration.md:98-103`) still does not list it (R11). |
| 9 | `pnpm t75:evidence-index` wires publication | **Partly true — the criterion is not met** | The script exists (`package.json`) and works: a clean generation exits 0, a contradicting generation exits 1 (observed). But an entry point is not a publication — see R7 and the assessment in A2. |

### Re-checked against matrix.md section 8

| # | Criterion | Part B | Now |
| - | --------- | ------ | --- |
| C1 | One entry per (dimension, case, platform, gate profile) **actually exercised**, naming the run id and the leg (matrix.md:321-322) | No | **Partly.** Platform cases now carry `observed: [{gate, runId, status}]` and reconcile against it. `gate-profile` cases carry `observed: []` and are never checked against the profiles supplied (R1). |
| C2 | Per leg: platform, arch, runtime, candidate revision, the digest (:323-325) | No | **Yes** (`:54-70`), subject to R3/R8. |
| C3 | Explicit not-qualified / not-configured entries for every case (:326-330) | Yes | **Yes**, and now stronger: an evidence note is mandatory (`:135-136`) and a declaration the fleet contradicts is downgraded rather than republished. |
| C4 | A signature over the canonical index bytes (:331) | No, openly | **No, openly and now scheduled** — `signingState.signed = false` with the reason, plus AD-014 scope (C5). |
| C5 | Unsigned-first requires the AD-014 scope entry (:333-340) | No | **Yes** (`.specs/STATE.md:105`). |
| C6 | Publish; the named precedent is wired and drift-guarded (:342-346) | No | **Still no** (R7). |
| C3′ | Criterion 3 binds platform, arch, runtime, fixture, candidate, evidence digests (:32) | Partial regression | **Mostly yes**: platform, arch, runtime, candidate and both digests per leg. Fixture is still absent, and the digests are transcribed rather than re-verified (R8). |

### R1 demonstrated — a fleet-answerable dimension is still concatenated

Every `gate-profile` case in `matrix.json` declares its evidence as, verbatim,
`"fleet dispatch"`, and every fleet index names its own `gate`. The fleet can
therefore answer this dimension exactly as it answers the platform dimension.
It is not reconciled: `FLEET_DIMENSION` is the single string `"platform"`
(`scripts/t75-evidence-index.mjs:47`), and `reconcile` returns the declaration
untouched for every other dimension (`:140`).

Generated through the real CLI with one `gate:security` index supplied:

```
profiles supplied: gate:security
  gate-profile/quick    => qualified | observed: [] | contradiction: none
  gate-profile/full     => qualified | observed: [] | contradiction: none
  gate-profile/build    => qualified | observed: [] | contradiction: none
  gate-profile/security => qualified | observed: [] | contradiction: none
  gate-profile/release  => qualified | observed: [] | contradiction: none
summary: {"cases":52,"qualified":41,…,"contradictions":0}
```

Four of the five profiles are published as qualified on the strength of "fleet
dispatch" with no dispatch observed, and the artifact reports zero contradictions.
This is the Part B defect in a second dimension, and the generator's own rule —
"silence is not a pass" (`:110-116`) — is the rule it breaks.

It is not hypothetical. matrix.md:401-406 records the four profiles dispatched at
the qualification candidate `9aab070` as `security`, `full`, `build`, `release`;
matrix.md:75 records `quick` as dispatched at a different revision (an earlier
plumbing run). The remediation's own end-to-end verification over those four
indexes reports **0 contradictions**, yet `gate-profile/quick` is asserted
qualified at that candidate with nothing observing it. matrix.md:73-80 asks for
exactly the opposite: "record all four run ids in the evidence index".

### R3, R8, R9, R6 demonstrated (shipped code, no mutation)

```
P2 leg identity.revision = ffff… accepted; recorded verbatim; case still qualified; contradictions: 0
P3 identityDigest that does not match its identity: recorded verbatim, never recomputed
P4 fleet index claiming complete:true while carrying a failed leg: complete recorded as true
P5 gate "gate:not-a-profile" accepted
```

P2 matters most of the four: the justification for refusing `revision: null` is
that a supplied file may carry its producer's own rejection, and the same
reasoning applies to a leg whose identity names a different candidate. The
index-level check covers only the aggregate the workflow derived
(`.github/workflows/platform-matrix.yml:317-324`), never the per-leg value the
generator then republishes as bound evidence.

## A2. Is an npm script "publish"? And was withholding the generated bytes right?

**The reasoning is right; the conclusion drawn from it is not.**

Not committing a revision-specific artifact into the tree is correct, and it
matches the repository's own instinct — an index generated at one candidate would
be stale at the next commit, and a committed stale index is worse than none. So I
do not think the output belongs in Git as a tracked file.

But the alternative to committing bytes is not producing none. As merged, running
the generator leaves a gitignored file in a working directory and nothing else:
no CI job runs it, nothing uploads it, no gate would notice if it broke against a
real fleet index, and the author of the T75 report (task B3) must run it by hand
and retype the numbers with nothing to cite. Two publication paths already exist
and neither was taken:

- `.github/workflows/platform-matrix.yml` already has an `index` job that uploads
  its evidence with 90-day retention (`:333-339`); the reconciled index is the
  natural companion artifact at the same revision.
- matrix.md:342-346 names a precedent that publishes *into the repository at a
  fixed location* and is guarded by a regenerating drift test — for a
  revision-specific artifact the equivalent is an appendix under
  `docs/qualification/`, generated once at the qualification revision and cited by
  `t75-validation.md`.

So C6 remains open, though less severely than in Part B: the mechanism exists and
runs, but nothing publishes and nothing regenerates.

## A3. Independent sensor — eight fresh mutations

Chosen to be disjoint from the sixteen the author reports killing. Each applied to
`scripts/t75-evidence-index.mjs`, run with
`node --test tests/unit/t75-evidence-index.test.mjs`, then restored
byte-identically (`restored-clean=true` after every run).

Baseline before mutation: **21 pass, 0 fail**.

| # | Mutation | Result | Failing test |
| - | -------- | ------ | ------------ |
| N1 | The citing `runId` is dropped from the recorded `observed` entries (contradiction text left intact) | **SURVIVED** (21/21) | none |
| N2 | `contradictions` counted as rows whose status changed, so the stale-declaration contradiction never reaches the summary or the exit code | **SURVIVED** | none |
| N3 | The CLI stops setting a non-zero exit code on contradictions | **SURVIVED** | none |
| N4 | First observation wins; later profiles for the same leg ignored | killed (19/21) | "a single failed leg is enough to withhold qualification"; "a re-dispatch of the same profile is kept as separate evidence" |
| N5 | A leg that reported gets the **candidate** revision stamped on it instead of the revision it reported | **SURVIVED** | none |
| N6 | `declaredStatus` dropped from rows where it agrees with the reconciled status | **SURVIVED** | none |
| N7 | The declared-status vocabulary is closed only for the platform dimension | **SURVIVED** | none |
| N8 | The mandatory evidence note is required only for the platform dimension | killed (20/21) | "a declared case with no evidence note is refused by name" |

**2 killed, 6 survived.** The suite is far stronger than Part B's — every Part B
survivor now dies — but the new properties it introduced are themselves thinly
pinned. N2 and N3 are the pair that matters: together they mean the entire
"contradictions are enforced" mechanism can stop working in one direction with a
fully green suite, because no test exercises the CLI and no test asserts
`summary.contradictions` for the upgrade-direction contradiction.

## A4. Vacuity re-check against the new code

- **The CLI is still completely untested.** `scripts/t75-evidence-index.mjs:205-224`
  — argument parsing, the file write, the summary line, and `process.exitCode = 1`
  — is exercised by no test (N3 survived). It behaves correctly today, verified by
  hand (`exit=0` clean, `exit=1` with a contradiction), but that behaviour is the
  enforcement half of the headline claim and nothing holds it in place.
- **`observed` entry shape is unasserted.** Only its length is checked
  (`tests/unit/t75-evidence-index.test.mjs:261`) and, for a non-fleet dimension,
  its emptiness (`:162`). N1 survived.
- **`declaredStatus` is asserted only where it disagrees** (`:104`). N6 survived.
- **The declared-vocabulary fixture cannot discriminate**: it mutates
  `dimensions[0]`, which *is* the platform dimension (`:193-195`), so it cannot
  tell "closed everywhere" from "closed for platform". N7 survived.
- **Not vacuous, and worth keeping:** the red-fleet fixture now expresses all four
  leg statuses the workflow can emit; the missing-leg row asserts explicit nulls
  rather than absence; the digest test recomputes from published bytes instead of
  reading the field beside it; the evidence-note requirement is checked on a
  non-platform dimension (N8 died).

## A5. Test integrity and gates

- No test was weakened, skipped, or deleted: the suite grew from 8 to 21 cases; no
  `skip`, `todo`, or `only` appears; every previous assertion survives in
  strengthened form.
- Every mutation was reverted byte-identically; the working tree contains no change
  to `scripts/` or `tests/`.
- `corepack pnpm gate:quick`: **PASS** — exit code 0, final line `gate:quick PASS`;
  the agent-readiness stage reported `tests 145 / pass 145 / fail 0 / skipped 0 /
  todo 0`, and the unit stage containing the 21 evidence-index cases passed in the
  same run.

## A6. Gaps, most severe first

1. **R1 — the `gate-profile` dimension is still concatenated.** A dimension whose
   declared evidence is literally "fleet dispatch" is never checked against the
   dispatches supplied; a single-profile generation publishes all five profiles as
   qualified with zero contradictions, and the author's own `9aab070` run has this
   hole for `quick`. Same defect class as the one being remediated.
2. **R2 — the contradiction mechanism's enforcement is untested.** N2 and N3 both
   survive: the stale-declaration contradiction can stop being counted, and the CLI
   can stop failing, without a single test noticing.
3. **R3 — a leg's own `revision` is never checked against the candidate.** A leg
   naming a different candidate is republished as bound evidence (P2), and
   overwriting it with the candidate is undetectable (N5).
4. **R4 — the provenance the artifact claims to keep is unpinned.** The citing
   `runId` inside `observed` (N1) and `declaredStatus` on agreeing rows (N6) can
   both vanish silently.
5. **R5 — the declared-status vocabulary is only pinned on the platform
   dimension** (N7), so an unknown status elsewhere would again be counted as
   nothing.
6. **R6 — `gate` is an open string.** `gate:not-a-profile` is accepted although the
   profile set is closed in `scripts/gate-stages.mjs` and bound to the matrix by
   `tests/agent-readiness/t75-matrix-declaration.test.mjs`. Closing it is most of
   the fix for R1.
7. **R7 — publication is still unmet.** An npm script is an entry point; nothing
   runs it in CI, nothing uploads or attaches the bytes, nothing regenerates it.
8. **R8 — recorded digests are transcribed, not re-verified**, although `identity`
   is present to recompute `identityDigest` exactly as the workflow does
   (`platform-matrix.yml:303-307`).
9. **R9 — `complete` is trusted verbatim**: an index claiming `complete: true`
   while carrying a failed leg is recorded as complete (leg reconciliation still
   fails closed, so the impact is a misleading field, not a false qualification).
10. **R10 — the documented argument style breaks.** AGENTS.md passes flags as
    `corepack pnpm <script> -- --flag`; `pnpm t75:evidence-index -- --revision …`
    fails with `ENOENT … open '--'` because every non-flag token is taken as a
    fleet index path.
11. **R11 — the DSSE migration plan's per-artifact predicate table** still omits
    the evidence index that AD-014 now scopes.

## A7. Shortest path to PASS

1. Close the gate vocabulary and reconcile `gate-profile` against the supplied
   profiles with the same fail-closed rule already written for platform (R1, R6) —
   the observation source is `profiles[].gate`, which is already in hand.
2. Test the CLI: a clean generation exits 0, a contradicting generation exits 1,
   and the written file round-trips (R2, and it closes the last vacuity).
3. Assert `summary.contradictions` in the stale-declaration case (R2/N2), the
   `observed` entry shape (R4/N1), `declaredStatus` on an agreeing row (R4/N6), and
   an unknown declared status in a non-platform dimension (R5/N7).
4. Refuse a leg whose `identity.revision` is not the candidate (R3/N5).
5. Publish: a CI step at the qualification revision that uploads the index beside
   the fleet evidence, or a generated appendix cited by `t75-validation.md` (R7).

---

# Part B — First verification (verdict FAIL), recorded verbatim from `1fe398a`

*Kept unchanged as committed evidence. It concerns `bc4a910`; findings G1-G7 below
are superseded by Part A only where Part A says so.*

**Verdict: FAIL.**

Author ≠ verifier. Evidence-or-zero: nothing below is claimed without a command
output or a file-and-line citation. Read-only on Git history; the source file was
temporarily mutated for the discrimination sensor and restored byte-identically
after every mutation (`git diff --exit-code -- scripts/t75-evidence-index.mjs`
clean, checked after each run and at the end).

- Branch: `feat/t75-evidence-index-generator`
- Verified commit: `bc4a910` (`scripts/t75-evidence-index.mjs`,
  `tests/unit/t75-evidence-index.test.mjs`, `.gitignore`, feature `handoff.md`)
- Requirement source: `.specs/features/platform-qualification-matrix/matrix.md`
  section 8, plus acceptance criterion 3 in section 1. Criteria were derived from
  that document, not from the commit message.

The verdict is not primarily about the missing signature. It is that the index
does not reconcile the declared matrix with the observed fleet evidence, and that
six of nine independently designed mutations survive the test suite.

## 1. Criteria derived from matrix.md section 8

Section 8 states the required content verbatim under "Required content, derived
from criterion 3 and this document", and adds a sequencing constraint and a
precedent. Section 1 criterion 3 supplies the binding list.

| # | Criterion (source) | Satisfied? | Evidence |
| - | ------------------ | ---------- | -------- |
| C1 | "One entry per (dimension, case, platform, gate profile) actually exercised, naming the matrix run id and the leg" (matrix.md:321-322) | **No** | `scripts/t75-evidence-index.mjs:42-52` builds two disjoint lists: `profiles[]` = (gate, runId, legs) with no dimension or case; `dimensions[]` = (dimension, case, status, evidence) with no platform or profile. No record is a (dimension, case, platform, profile) tuple, and nothing correlates the two lists. Demonstrated below. |
| C2 | "Per leg: platform, arch, runtime version, candidate revision, the `platform-validation.json` digest" (matrix.md:323-325) | **No (partial)** | `scripts/t75-evidence-index.mjs:46` projects each leg to `{ leg, status, legDigest }` only. The fleet index supplies `identity` (`revision`, `gate`, `platform`, `arch`, `runtime`, `runner`) and `identityDigest` per leg (`.github/workflows/platform-matrix.yml:153-161, 308-314`); both are dropped. Runtime version is absent from the produced index entirely; platform/arch survive only inside the opaque leg label the workflow pins from `EXPECTED_LEGS` (`platform-matrix.yml:273`), which is a declared label, not the observed identity. Candidate revision is index-level only. |
| C3 | "Explicit `not qualified` / `not configured` entries for every case section 6 and section 7 identify … an index that silently lists only what passed is the failure mode this whole document exists to prevent" (matrix.md:326-330) | **Yes** | `scripts/t75-evidence-index.mjs:49-52` copies every declared case with its status and evidence; `matrix.json` declares the seven fixture-only engines `contract-qualified`, `pi` `contract-qualified` (D2), the two unreachable isolation grades `not-qualified`, and `darwin-x64` `environmental`. `tests/unit/t75-evidence-index.test.mjs:50-59` pins that the recorded case set equals the declared case set and that `contractQualified`/`environmental` are non-zero. The declaration itself is bound to canonical sources by `tests/agent-readiness/t75-matrix-declaration.test.mjs`. Caveat: these statuses are copies of a human-authored claim and are never reconciled with observation — see C1 and gap G1. |
| C4 | "A signature over the canonical index bytes" (matrix.md:331) | **No — declared open, not declared satisfied** | `scripts/t75-evidence-index.mjs:85-89` emits `signingState.signed = false` with a stated reason; `tests/unit/t75-evidence-index.test.mjs:96-97` pins both. See the assessment in section 2. |
| C5 | Sequencing constraint: build after the DSSE migration, **or** build unsigned first and sign in the same change that migrates the envelope — "The AD-014 scope list does not currently include an evidence index; adding it there is part of whichever order is chosen" (matrix.md:333-340) | **No** | The unsigned-first branch was taken, but `.specs/STATE.md:105` still reads "AD-014 governs the 8 `ArtifactSealer` artifact kinds only" and enumerates them without an evidence index; `grep -n "evidence index\|evidenceIndex" .specs/STATE.md` returns nothing. `.specs/features/dsse-attestation/migration.md` likewise does not list it. The half of the option that schedules the signature was not done. |
| C6 | The checklist verb is **publish**; the named precedent "writes canonical JSON plus rendered Markdown, and is guarded by a drift test that regenerates on every gate run and fails if the committed bytes disagree" (matrix.md:342-346) | **No** | Output is gitignored (`.gitignore:23`); there is no npm script (contrast `package.json:14` `"proof:generate"`), no CI step (repo-wide search for `t75-evidence-index` hits only `.gitignore`, the handoff, the script, and its unit test), no committed bytes, no drift test (contrast `tests/unit/proof-artifact.test.mjs:28-35`), and no rendered Markdown. Nothing publishes an index. |
| C3′ | Acceptance criterion 3: "Reports bind platform, architecture, runtime, fixture, candidate, and evidence digests" (matrix.md:32) | **Partial, and a regression at the publication layer** | Candidate: bound (`t75-evidence-index.mjs:32-40`). Platform/architecture: label only (C2). Runtime: absent. Fixture: absent. Evidence digests: `legDigest` only, `identityDigest` dropped. matrix.md:418 records that the fleet's own M-2 index "is the first artifact that actually satisfies acceptance criterion 3" — the generator that is meant to publish the record strips the fields that satisfied it. |

### C1 demonstrated: declaration and observation are never reconciled

Run against the shipped code, no mutation, using a fleet index in which every leg
failed or disagreed with its own digests:

```
B fleet legs: failed,failed,failed,digest-mismatch
B platform dimension says: win32-x64=qualified, linux-x64=qualified,
                           linux-arm64=qualified, darwin-arm64=qualified,
                           darwin-x64=environmental
B summary: {"cases":52,"qualified":41,"contractQualified":8,"notQualified":2,
            "environmental":1}
```

An all-red fleet yields an index whose summary reports 41 qualified cases and
whose platform dimension reports four qualified platforms. The failures are
present, in a different list, and nothing contradicts the claim. The module header
(`scripts/t75-evidence-index.mjs:5-19`) calls this a join; it is a concatenation.
This is the same failure the matrix exists to prevent, in a new form: not green by
omission, but green by non-reconciliation.

### The revision binding has an explicit null escape

`scripts/t75-evidence-index.mjs:38` guards with
`if (index.revision !== null && index.revision !== revision)`. The fleet index
emits `revision: null` in exactly two situations: no leg reported at all, and
**legs reporting more than one candidate revision**
(`.github/workflows/platform-matrix.yml:317-324`). In the second case the workflow
throws (`platform-matrix.yml:331`) — but the file was already written at line 329
and the upload step is `if: always()` (line 334), so the artifact exists. The
generator accepts it and stamps the candidate revision onto the index:

```
A accepted unbound fleet index: run-mixed | revision recorded: aaaa…aaaa
```

The headline test "a fleet index bound to a different candidate is refused"
(`tests/unit/t75-evidence-index.test.mjs:37-44`) exercises only the non-null path.
The one artifact the producer itself declares invalid is the one the consumer
admits.

## 2. Is the unsigned index an honest partial delivery, or a criterion quietly declared satisfied?

**Honest on its face, incomplete against the spec's own terms — and it therefore
sits closer to "gap left visible but unscheduled" than to "gap closed".**

In favour of honest partial delivery, and these are real:

- The unsigned state is in the artifact, not only in prose:
  `signingState = { signed: false, reason … }` (`t75-evidence-index.mjs:85-89`).
- It is machine-enforced: `tests/unit/t75-evidence-index.test.mjs:96-97` asserts
  `signed === false` and matches the reason, so flipping it to `true` fails the
  suite (confirmed: the author's own "signed flipped true" mutant, and my V2-class
  checks, behave consistently).
- matrix.md:333-340 explicitly authorizes an unsigned collected index first.
- The refusal to sign with the repository's committed TEST-ONLY key is correct and
  matches the repository rule that a missing provider is `not configured`, never a
  pass.
- The feature handoff records signing as REMAINING rather than done.

Against, and this is why it does not fully land:

- The spec's unsigned-first option has two halves. The second half — adding the
  evidence index to the AD-014 scope list so the signature arrives with the DSSE
  migration — was not done (C5). As merged, no tracked artifact will pick the
  signature up. A visible gap with nothing scheduled to close it decays into a
  closed checklist item.
- Combined with C6, the delivered object is not an index at all: nothing runs the
  generator, its output is gitignored, and no bytes exist to sign. "Unsigned index"
  overstates it; what exists is an unwired function that can produce one.
- The digest that a signature would cover is `sha256(JSON.stringify(body))`
  (`t75-evidence-index.mjs:73`) with no declared canonicalization contract or
  version, while section 8 asks for a signature "over the canonical index bytes"
  and the repository maintains a canonical-encoding register
  (`docs/canonical-json-compatibility.md`, `canonicalizeJsonV2`, issue #58) that
  this new trust-path digest neither uses nor appears in.

So: not a criterion silently declared satisfied — but not the acceptable partial
delivery the spec describes either, because the scheduling half and the publishing
half are both missing.

## 3. Independent discrimination sensor

Nine behaviour-level mutations, designed independently of the six in the commit
message, each applied to `scripts/t75-evidence-index.mjs`, tested with
`node --test tests/unit/t75-evidence-index.test.mjs`, then restored byte-identically
(`restored-clean=true` after every run; final `git diff --exit-code` clean).

Baseline before mutation: **8 pass, 0 fail**.

| # | Mutation (a defect that could plausibly occur) | Result | Failing test |
| - | ---------------------------------------------- | ------ | ------------ |
| V1 | A leg's `legDigest` silently dropped from the projection | **SURVIVED** (8/8 pass) | none |
| V2 | `complete` forced `true` regardless of the fleet | killed (7/8) | "each dispatched profile is recorded with its run and its per-leg outcome" |
| V3 | Profiles deduplicated by gate, so a second dispatch of the same gate disappears | **SURVIVED** (8/8) | none |
| V4 | The `evidence` citation dropped from every case | **SURVIVED** (8/8) | none |
| V5 | Only the FIRST fleet index checked for revision binding; later ones trusted | **SURVIVED** (8/8) | none |
| V6 | A leg reported `failed` or `digest-mismatch` recorded as `qualified` | **SURVIVED** (8/8) | none |
| V7 | An unrecognised case status passed through (`not-qualified` → `unqualified`) so it is counted as nothing | killed (7/8) | "the summary is counted from the rows, so it cannot drift from them" |
| V8 | Legs that never reported dropped instead of recorded | killed (7/8) | "each dispatched profile is recorded with its run and its per-leg outcome" |
| V9 | The `revision !== null` escape widened to also admit `undefined`/`""` | **SURVIVED** (8/8) | none |

**3 killed, 6 survived.** The suite discriminates the three properties the commit
message names, and little else. V6 is the most serious: the workflow can emit four
leg statuses (`qualified`, `failed`, `missing`, `digest-mismatch`,
`platform-matrix.yml:299-314`) and no test fixture ever contains a red one
(`tests/unit/t75-evidence-index.test.mjs:20-22` uses only `qualified` and
`missing`), so no test can distinguish a generator that reports fleet failures from
one that suppresses them.

## 4. Vacuity and wiring check

- **Untested output field.** `legDigest: leg.legDigest ?? null`
  (`t75-evidence-index.mjs:46`) is produced and never asserted anywhere; the `??`
  fallback branch is reached by the fixture's `darwin-x64` leg
  (`tests/unit/t75-evidence-index.test.mjs:21-22`) but its value is never checked.
  V1 survived.
- **Antecedent never satisfied.** The `index.revision !== null` branch
  (`t75-evidence-index.mjs:38`) has no fixture with a null/absent revision. V9
  survived. This is the null-escape defect above.
- **Fixture cannot discriminate.** No fleet fixture contains a `failed` or
  `digest-mismatch` leg (see V6), and no fixture contains two dispatches of the same
  gate (see V3), so those code paths are untested by construction.
- **Uncited field.** `evidence` is copied at line 51 and asserted nowhere. V4
  survived.
- **Non-test caller.** `buildEvidenceIndex` has exactly one production caller: the
  module's own CLI block (`t75-evidence-index.mjs:93-108`). For an ordinary script a
  CLI entry point would be acceptable. It is not acceptable here, because the
  criterion's verb is *publish* and the precedent section 8 names is wired both ways
  — `package.json:14` exposes `proof:generate`, and `tests/unit/proof-artifact.test.mjs`
  regenerates on every gate run and fails on drift. This generator is invoked by no
  workflow, no gate, and no package script, and its output is gitignored, so it can
  rot without any gate noticing and no index is published anywhere.
- **Digest round trip** works but is untested: reconstructing `body` from the
  emitted file and recomputing gives the recorded `bodyDigest` (verified by direct
  execution), yet no test reads the emitted file or re-verifies the digest, and the
  index declares no canonicalization version for a future verifier to follow.

## 5. Test integrity and gates

- No existing test was modified, weakened, or skipped:
  `git diff --stat bc4a910^ bc4a910 -- tests/` shows one file changed, 105
  insertions, 0 deletions. No `skip`, `todo`, or `only` appears in the new test.
- The commit's non-test changes are confined to the new script, `.gitignore`, and
  the feature handoff.
- `corepack pnpm gate:quick`: **PASS** — exit code 0, final line `gate:quick PASS`;
  the agent-readiness stage reported `tests 145 / pass 145 / fail 0 / skipped 0 /
  todo 0`, and the unit stage (which contains
  `tests/unit/t75-evidence-index.test.mjs`) passed in the same run.
- `node --test tests/unit/t75-evidence-index.test.mjs` standalone: 8 pass, 0 fail,
  0 skipped, 0 todo.

## 6. Gaps, most severe first

1. **G1 — The index never reconciles the declaration with the observation.** An
   all-failed fleet still produces "41 qualified" and four qualified platforms
   (section 1, C1). Until a failed or missing leg contradicts the platform
   dimension's declared status, the index republishes a human-authored claim beside
   unrelated evidence and calls it a record.
2. **G2 — The suite does not discriminate the behaviour it claims.** Six of nine
   independent mutations survive, including a failed leg being upgraded to
   qualified, `legDigest` dropped, `evidence` dropped, profiles deduplicated, and
   revision binding applied to only the first fleet index.
3. **G3 — The revision binding admits the artifact its own producer rejects.**
   `revision: null` — emitted when legs disagree about the candidate — is accepted
   and stamped with the candidate revision.
4. **G4 — Criterion 3 regresses at the publication layer.** Per-leg runtime version
   and `identityDigest` are dropped; platform and arch survive only as a declared
   label. The fleet index already satisfied criterion 3 (matrix.md:418); the index
   built from it does not.
5. **G5 — Nothing is published.** Gitignored output, no npm script, no CI step, no
   committed bytes, no drift test, no rendered Markdown. The checklist verb is
   unfulfilled even for the unsigned half.
6. **G6 — The unsigned-first option was taken without its scheduling half.** The
   evidence index is still absent from the AD-014 scope list (`.specs/STATE.md:105`)
   and from the DSSE migration plan, which matrix.md:333-340 makes part of choosing
   that order.
7. **G7 — A new trust-path digest outside the canonical-JSON register.**
   `sha256(JSON.stringify(body))` with no canonicalization version declared in the
   record and no entry in `docs/canonical-json-compatibility.md`.

## 7. What is genuinely good, and should survive remediation

- Refusing to sign with the committed TEST-ONLY key, and saying so in the artifact
  rather than only in prose, is the right call and is test-pinned.
- Counting the summary from the projected rows rather than asserting it beside them
  is a real anti-drift property, and it killed V7.
- Every declared case reaches the index, including the not-qualified and
  environmental ones (C3), with the declaration bound to canonical sources by
  `tests/agent-readiness/t75-matrix-declaration.test.mjs`.
- Refusing a malformed revision and a mismatched non-null fleet revision are both
  real, tested guards.

## 8. Smallest remediation that would change the verdict

1. Reconcile: cross-check every fleet leg against the platform dimension's declared
   status and fail, or record a contradiction, when the observation disagrees (G1),
   with fixtures containing `failed` and `digest-mismatch` legs (G2, V6).
2. Refuse `revision: null` explicitly, or record it as an unbound profile that
   cannot contribute qualification (G3).
3. Carry per-leg `platform`, `arch`, `runtime`, and `identityDigest` into the index
   and assert them (G4, V1).
4. Assert `legDigest` and `evidence` presence, and add a same-gate double-dispatch
   fixture (G2, V1/V3/V4), plus a multi-index revision-binding case (V5).
5. Wire it: a package script, a CI step that runs it at the qualification revision,
   and either committed bytes with a drift test or an uploaded artifact (G5).
6. Add the evidence index to the AD-014 scope list and the DSSE migration plan, and
   declare a canonicalization version on the digest (G6, G7).
