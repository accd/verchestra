# Independent verification — T75 evidence index generator (`bc4a910`)

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
