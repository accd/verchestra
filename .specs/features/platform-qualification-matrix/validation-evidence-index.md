# Independent verification — T75 evidence index generator

Two verification passes by the same independent verifier (author ≠ verifier).
Part A is the current re-verification of the remediation `ce9ff65`. Part B is the
first pass over `bc4a910`, whose FAIL verdict was committed as `1fe398a` before
any fix; it is kept verbatim below because it is committed evidence.

---

# Part A — Re-verification of `ce9ff65`

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
