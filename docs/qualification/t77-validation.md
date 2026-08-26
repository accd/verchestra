---
schema: verchestra-qualification-report/v1
task: T77
revision: 3d363f782bad40e5c5be8252e6626216b4f60248
gates: pnpm gate:quick, pnpm gate:full, pnpm gate:build, pnpm gate:security, pnpm gate:release
gateResults: pass, pass, pass, pass, pass
gateRevision: 3d363f782bad40e5c5be8252e6626216b4f60248
criteriaEvidence: 7 of 7 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 12 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/375
---

# T77 Final Acceptance Evidence and Release Decision Machinery Validation

## Scope and revision binding

This report validates the acceptance and closure machinery for the 1.0 decision
at exact revision `3d363f782bad40e5c5be8252e6626216b4f60248`, which is reachable
from `origin/main` (`git merge-base --is-ancestor` confirmed). `gateRevision`
names the same commit because a candidate build was dispatched at that SHA and
nowhere else.

T77's subject is different from every task before it. T69 through T76 each built
a capability and proved it. T77 asks whether the *evidence* is complete, whether
the *denominator* is real, and whether the artifact that ends the milestone — a
signed promote-or-reject decision — can be asserted without the evidence it
names. So what is validated here is the acceptance enumeration, the requirement
closure, and the enforcement of `RELEASE-DECISION-CONTRACT.md`, together with a
five-platform gate closure at the bound revision.

The acceptance criteria are quoted from `.specs/features/release-decision/spec.md`.

**Authorship, stated plainly.** This report, the release-decision validator it
validates, and its tests were written by an agent session operating as the
repository owner's automation. That session authored the implementation under
review, so it is not an independent verifier, and none is claimed. The candidate
build was dispatched with the owner's authorization; every gate result below was
read back from the run's own record, not from a local execution.

**This report is not independent verification and not human review.** Both are
external to it by design — `REPORT-CONTRACT.md` deliberately carries no field for
either, because a string the author writes cannot establish that someone else
read the work. They belong to the release decision record, which requires an
operational reviewer, a security reviewer, and a deciding human, all distinct.
None of them has acted. `reviewedIn` records where the review of *this report*
can be checked; it asserts no verdict.

## Deterministic gates

Candidate build run **32967293127** built the five-target fleet at exactly
`3d363f782bad40e5c5be8252e6626216b4f60248`. It was dispatched at
`2026-08-26T12:12:06Z` and completed at `2026-08-26T12:34:25Z` with conclusion
`success`. Each of the five target legs ran all five gate profiles before sealing
its target.

Read back with:

```bash
gh run view 32967293127 --repo accd/verchestra --json status,conclusion,jobs
```

| Leg | `gate:quick` | `gate:full` | `gate:build` | `gate:security` | `gate:release` | Leg conclusion |
| --- | --- | --- | --- | --- | --- | --- |
| `win32-x64` | pass | pass | pass | pass | pass | success |
| `darwin-x64` | pass | pass | pass | pass | pass | success |
| `darwin-arm64` | pass | pass | pass | pass | pass | success |
| `linux-x64` | pass | pass | pass | pass | pass | success |
| `linux-arm64` | pass | pass | pass | pass | pass | success |

25 profile executions, zero failures. Per-leg counters, from each leg's own test
runner output:

| Profile | Tests per leg | Pass | Fail | Skipped | Todo | Cancelled |
| --- | --- | --- | --- | --- | --- | --- |
| `gate:quick` | 2,361 | 2,361 | 0 | 0 | 0 | 0 |
| `gate:full` | 3,861 | 3,861 | 0 | 0 | 0 | 0 |
| `gate:build` | 3,952 | 3,952 | 0 | 0 | 0 | 0 |
| `gate:security` | 4,674 | 4,674 | 0 | 0 | 0 | 0 |
| `gate:release` | 4,068 | 4,068 | 0 | 0 | 0 | 0 |
| **Per leg** | **18,916** | **18,916** | **0** | **0** | **0** | **0** |

**94,580 test results across the five legs, zero failures, zero skipped, zero
todo, zero cancelled.**

All five legs sealed a byte-identical gate-evidence digest,
`sha256:bf9743df82b764f2a2ac21c9613e7ba9425f1322c542f360496ef0180c59a0d0`. That
is the part worth reading twice: it is not five legs that each happened to pass,
it is five legs whose sealed counters are the same bytes, so a platform that
quietly ran a smaller set could not produce it.

The `collect` job reconciled the exact five-target closure and refused anything
else — it requires exactly one successful closure per supported target at the
requested revision. Its output binds the candidate:

- Reconciled closure digest: `sha256:0572d5d7832af2981b042861ed28cebd2870d5cc2a3bcb2be252866755989f63`
- Release identity: `release:verchestra:0.0.0-qualification:3d363f782bad`
- Component count, identical on all five targets: `194`

The five per-target release digests are recorded in
`.specs/features/release-decision/prepared-decision.md` section 2, together with
the reason the singular `candidateReleaseDigest` field takes the reconciled
digest.

`gate:release` is the profile a 1.0 decision rests on, and
`docs/audits/2026-08-verchestra-product-repository-audit.md` records that it once
passed vacuously because `tests/public-regression/` and `tests/system/` did not
exist. That closure was re-checked rather than inherited: `scripts/test-scope.mjs`
fails a scope with zero tests, and the profile contributed 4,068 passing
assertions on each of the five legs at this revision. Limitation L3 is answered.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| 1. A decision fixture violating any single condition of RD-01 is rejected naming that condition, and the otherwise identical valid fixture is accepted | `tests/agent-readiness/release-decision.test.mjs` (45 tests). One row per fail-closed condition in `RELEASE-DECISION-CONTRACT.md`; the first case asserts the unviolated fixture returns no errors, for both `promote` and `reject`. Every row also asserts every error names the decision file, so a fixture cannot pass by failing for an unrelated reason. Sensor mutations 5–9, 11, and 12 confirm the assertions are load-bearing. |
| 2. `agent:check` passes with no decision file and fails on a decision that violates the contract | `checkReleaseDecisions` is called from `checkRepository`; `node scripts/agent-check.mjs` reports `agent:check PASS` in this worktree, which contains no decision file. The repository-level cases in the same suite drive `readReleaseDecisions` over real Git history and assert the rejections. Sensor mutation 12 proves the reachability wiring is what rejects a side-ref candidate. |
| 3. Decisions are discovered by the command that discovers qualification reports, and supporting documents stay silent | `readReleaseDecisions` reads `docs/qualification/` with `RELEASE_DECISION_FILE`; the case "no decision file is not a failure" places `t76-validation.md` and `RELEASE-DECISION-CONTRACT.md` in that directory and asserts zero decisions and zero errors. The filename-pattern case asserts `release-decision-1.0.md` and `RELEASE-DECISION-CONTRACT.md` are not decisions. |
| 4. Every value marked *derived* is reproducible by the command printed beside it, and every *pending* value names the human act that supplies it | `.specs/features/release-decision/prepared-decision.md` sections 1–3. The register digest `e81e066a…` and the count `93` were read out of Git at the bound revision, not out of any file that claims them; the reconciled closure digest came from the candidate run's own uploaded index. Section 3 lists eight pending fields and the act that supplies each. |
| 5. The ranked reasons for the recorded decision each cite a tracked file and name what would lift them | `prepared-decision.md` section 5: twelve ranked rows, every one citing a path and a limitation identifier from `acceptance-matrix.md` section 4, every one naming the change that lifts it. |
| 6. The signing procedure is exact, reuses the existing custody pattern, and leaks no key material or machine-local path | `prepared-decision.md` section 4. Both commands were **executed end to end** on `win32-x64` with a throwaway key and a synthetic fixture outside the repository (section 4.4): the key is generated straight into the named environment variable and never reaches disk, only the public half is printed, and neither the key nor the resulting signature appears in any tracked file. The procedure uses `openssl` and Node builtins only, so it runs identically in Git Bash, Linux, and macOS. |
| 7. No tracked file added by this feature contains a secret-like value, a machine-local path, or a real signature or key | `agent:check`'s context-safety sweep passes. Every fixture identity in the test suite is a synthetic `*-fixture` string; the signature fixture is the base64 of the ASCII text `synthetic-signature-fixture`; no `docs/qualification/trust/` file was added or read for a signature. The signing procedure holds key material only in a named environment variable and destroys it. |

## The twelve acceptance journeys

`docs/qualification/acceptance-matrix.md` is the canonical enumeration and is not
duplicated here. It was compiled at `42f2f18410e58885597f3b55b2cc43e58d860a80`,
which `git merge-base --is-ancestor` confirms is an ancestor of the bound
revision; two commits separate them (`b3ec741`, `3d363f7`).

What this report adds is the binding: every suite the matrix cites exists at the
bound revision, and every one of them ran inside the five-leg gate closure above.
`tests/e2e/` holds exactly nineteen suites at this revision, which is the number
the matrix's reverse map claims, so no suite is unclaimed and none is cited that
does not exist. All twenty-five cited suites were confirmed present with
`git cat-file -e 3d363f78:<path>`.

| Id | Outcome | Proof suites (matrix §2) | Status at this revision |
| --- | --- | --- | --- |
| J01 | Install and activate on a clean machine | `vestra-launcher-activation`, `tuf-update-client`, `tuf-source-adapters` | Proven deterministically; live on 2 of 5 targets (L7) |
| J02 | Update, roll back, uninstall | `installer-lifecycle-matrix` | Proven deterministically; no live rollback recorded |
| J03 | Initialize a Workspace and bind backends | `safe-init-e2e`, `cli-launchers-e2e`, `machine-bootstrap-e2e`, `workspace-reconcile-e2e` | Proven |
| J04 | Deliver one task to human-reviewed completion | `task-executor-e2e`, `gate-commit-negative`, `verification-human-review` | Proven |
| J05 | Hand work to another machine or operator | `handoff-journey` | Proven |
| J06 | Continue under a different AI backend | `cross-backend-delivery-journey` | Proven |
| J07 | Move an Execution Package across key roots | `key-lifecycle-portability` | Proven; one e2e case, breadth from the T68a chain |
| J08 | Prove an installation works from a sealed bundle | `self-test-cli-e2e`, `build/sealed-launcher-closure` | Proven, with one recorded defect (#370, L5) |
| J09 | Diagnose a machine with deep doctor | `doctor-cli-e2e` | Proven — and cannot report `PASS`, by protocol (L2) |
| J10 | Recover a machine, send diagnostics safely | `recovery-bundle-e2e`, `support-bundle-e2e` | Proven deterministically; no live restore recorded |
| J11 | Build, promote, publish a verified release | `promotion-gate-e2e`, `build/t76-release-publication`, `build/tuf-publication` | Proven deterministically; performed live once |
| J12 | Verify release evidence from outside | `security/t75-evidence-attestation`, `security/trust-key-separation`, `security/dsse-interoperability` | Proven; custody is single-operator (L8) |

Every suite in this table ran under `gate:full`, `gate:build`, or `gate:security`
on all five legs. The honest qualifications in the Status column are the matrix's
own, carried forward rather than softened, and each is a limitation in the list
below.

## Requirement closure

The reviewed denominator is `docs/requirements-register.json`, not the "98" in
issue #18's body. The register declares 93 requirements and an empty `openGaps`,
and the tracer fails closed both on a referenced requirement missing from the
register and on a register entry nothing references, so neither inflation nor
omission survives a gate.

`node scripts/requirements-trace.mjs`, run against a pristine export of
`3d363f782bad40e5c5be8252e6626216b4f60248` on `win32-x64`, Node `v24.14.0`, exit
status `0`:

```
registered: 93
referenced: 93
declared gaps: 0
traceability CONSISTENT
T77 closure MET
```

The register at that revision hashes to
`e81e066ad0c1bf30f90e150f57502ea17f036edbb3cecf1e7c5a437adbd54907`
(`git cat-file -p 3d363f78:docs/requirements-register.json | sha256sum`), which
is the value a decision's `requirementsRegister` must equal, and the value the
new validator reads out of Git rather than out of the decision claiming it.

**93 of 93 requirements evidenced.** The honest limit of that statement is stated
in `acceptance-matrix.md` section 3 and is not repaired here: exactly one of the
93, `VES-VFY-001`, cites a `tests/e2e/` file by literal citation, so the
requirement-to-journey mapping is a reading a human can check rather than a
mechanical derivation. Closing that means citing requirement ids from the
end-to-end suites, which is a source change.

## Discrimination sensors

Twelve mutations were applied at this revision. Each was introduced, run against
the smallest pinned suite, restored, verified byte-identical, and the suite re-run
to green. Tracked files were restored with `git checkout --`; the two files
carrying this change's own new work were restored from a byte-verified copy taken
before the campaign, never with `git checkout --`, and their sha256 was compared
after every restore.

Every one was killed.

| # | Defect introduced | Pinned suite | Killing assertion |
| --- | --- | --- | --- |
| 1 | A register entry added for a requirement that nothing in the repository references | `tests/agent-readiness/requirements-register.test.mjs` | 3 of 5 tests fail. "every referenced requirement is registered and every registered requirement is referenced" — `unreferenced` actual `['VES-AAA-000']`, expected `[]`; tracer prints `registered: 94` against `referenced: 93`, `traceability INCONSISTENT`, `T77 closure NOT MET`, exit 1 |
| 2 | The first register entry duplicated | Same suite | "every referenced requirement is registered and every registered requirement is referenced" — `duplicates` actual `['VES-BST-001']`, expected `[]`; closure drops to NOT MET |
| 3 | `VES-WSP-007` removed from the register while the reports that cite it stay | Same suite | Same test — `unregistered` actual `['VES-WSP-007']`, expected `[]`. `registered: 92` against `referenced: 93` |
| 4 | `hasEvidence` weakened so that any mention of a requirement counts as evidence for it | Same suite | Exactly one test fails: "an unevidenced requirement outside the declared gaps is reported" — actual `[]`, expected `['VES-BST-001']`. This is the case written to prove the register would report an unproven requirement, and it is the only thing standing between "cited somewhere" and "evidenced" |
| 5 | The decision gate check widened from `gate:release` alone to any declared gate | `tests/agent-readiness/release-decision.test.mjs` | 2 tests fail. "a broader gate set that merely includes the release gate" — expected `gate:quick is not the release decision gate`, `got []`: `pnpm gate:quick, pnpm gate:release` would have been accepted silently |
| 6 | The register digest trusted as declared instead of read from Git at the candidate revision | Same suite | 4 tests fail, all `got []`: a wrong digest, a wrong denominator, a register that moved after the decision was written, and a candidate revision with no register at all would all have passed |
| 7 | The three-distinct-identities check reduced to a condition that always holds | Same suite | 3 tests fail — an operational reviewer, a security reviewer, or one person holding both roles, each equal to the deciding human, `got []` |
| 8 | `requirementsClosed` loosened from the closed form to "two numbers somewhere" | Same suite | "requirement counts relabelled to read as complete" — `5 open, 93 total` is no longer rejected as malformed and is instead read as `only 5 of 93 requirements are evidenced`, which is a different claim than the one the contract closes |
| 9 | `qualificationReports` entries no longer checked against the reports on disk | Same suite | "a qualification report the chain does not have" — expected `no qualification report satisfies the contract for: T77`, `got []` |
| 10 | `t76-validation.md` rebound to a well-formed revision this repository does not contain | `node scripts/agent-check.mjs` | `agent:check docs/qualification: T76: revision 4f0e5c9a1b7d is not a commit in this repository`, exit 1 — and `agent:check llms.txt disagrees with repository status`, because dropping T76 moves the derived chain |
| 11 | The at-most-one-decision-per-version guard removed | `tests/agent-readiness/release-decision.test.mjs` | "a version may have at most one decision file" — expected a duplicate report, `got ["release-decision-1.0.1.md: decision claims version 1.0.0"]`: the second file is refused for its name, not for deciding a version that already has a decision |
| 12 | Reachability and existence facts no longer supplied to decision validation | Same suite | "a candidate revision reachable only through a side ref is refused" — expected the reachability rejection, got only register mismatches: a candidate on an unmerged branch would bind a decision |

**12 killed, 0 survived.** Mutations 5–9, 11, and 12 touch the same file and were
applied one at a time, each with its own restore-and-green cycle; after each, the
restored file's sha256 was compared to the pre-campaign copy and the suite re-run
green before the next mutation.

## Non-shallow checks

- The closure denominator is not a number in this report. The register's digest
  and its requirement count are read from Git at the candidate revision, so a
  decision that retypes either is rejected by a fact the decision author does not
  control. Mutation 6 proves that is what rejects it.
- The reachability check runs against **real Git history**, not a stub: the test
  builds a repository, commits an implementation on `main`, commits a second on a
  side branch, and asserts the side-branch candidate is refused while the `main`
  candidate is accepted. A validator that merely parsed the SHA would pass the
  first half and fail the second.
- `revisionTrust` was extracted so that report reachability and decision
  reachability read the same Git facts through one helper. Two implementations of
  "is this commit trusted" is exactly how the report filename pattern and the
  report route pattern drifted apart once before, which the module's own comment
  records.
- The traceability sweep is live, and it caught this report twice. The test
  fixtures first used `VES-`-shaped register ids; `pnpm test:agent-readiness`
  failed, because `scripts/requirements-trace.mjs` scans `tests/` and had
  correctly picked them up as requirements no register declares. Then mutation 1
  was first run with a synthetic id in an invented `VES-ZZZ-` family, and writing
  that id into this table made the tracer read the report itself as referencing
  an unregistered requirement — the self-citation hazard `acceptance-matrix.md`
  section 3 warns about, arriving on schedule. The mutation was re-run with
  `VES-AAA-000`, the id the tracer already declares as a format fixture and
  excludes from references, and its recorded outcome above is from that re-run on
  a clean baseline. This paragraph names no id with a numeric suffix outside that
  declared fixture, for exactly the same reason. In every case the fixture moved
  and the tracer did not.
- The gate results in this report were read back from the run's own record with
  `gh run view`, per leg, after the run completed. No gate result here was
  executed locally and none was copied from an earlier revision.
- The canonicalization census caught the new digest and was refreshed rather than
  worked around: `pnpm census:refresh` moved `scripts/agent-readiness.mjs` from
  `digest: 0` to `digest: 2`, its only change. **Recorded for a reviewer:** that
  file sits on the census's reviewed `presentation-or-fixture` exception, whose
  fixed reason reads "not a trust or persistent identity", and the digest added
  here is used to decide whether a release decision's declared register digest
  matches reality. It hashes raw bytes read from Git and canonicalizes no JSON, so
  it creates no persistent identity — but whether the file should now carry
  `raw-byte-digest` instead is a change to a reviewed exception list, and is left
  to the owner rather than made here.
- No baseline was raised to make this change fit. `node scripts/complexity.mjs check`
  passes with 179 baselined hotspot keys and nothing above the target of 10
  unaccounted; the one function that exceeded 10 during development was split
  rather than added to the baseline.

## What the chain counter says, and what it does not

Adding this report moves the derived qualification counter to its terminal state:
`agent:context`, `llms.txt`, and the public site now read *T77 complete; the
declared chain is fully verified*.

That sentence means one thing: every task the roadmap declares has a validation
report that satisfies `REPORT-CONTRACT.md`. It does **not** mean 1.0 is promoted,
and `ROADMAP.md`'s release conditions have always kept the two apart — version
`1.0.0` is promoted only when the acceptance requirements are mapped to evidence,
the gates pass, no required fault survives independent verification, **and human
operational and security reviewers sign the decision.** The last of those has not
happened. The package version stays `0.0.0-qualification`.

The artifact that closes the milestone is `docs/qualification/release-decision-1.0.0.md`,
which does not exist and is deliberately not created here: an unsigned decision
file would assert a decision nobody made, and the validator this report validates
would refuse it. What exists instead is
`.specs/features/release-decision/prepared-decision.md`, where every
machine-derivable value is computed and every human field is marked pending.

## Limitations bearing on a 1.0 decision

Grouped as `acceptance-matrix.md` section 4 groups them. Nothing is added, and
nothing is quietly promoted or demoted.

**Blocking — a decision cannot record PASS while these hold.** L1, no independent
verifier and none obtainable by configuration. L2, `doctor` can never report
`PASS` because `releaseDigest` is protocol-null, and no tracked file states the
consequence. L3, `gate:release` was historically vacuous — **answered at this
revision** by 4,068 passing assertions on each of five legs and by
`scripts/test-scope.mjs` failing a zero-test scope.

**Qualifying — disclose, do not block.** L4 seven of eight database engines are
contract-qualified. L5 the published package carries the `self-test` defect #370.
L6 the four TUF source modes lack cross-adapter equivalence. L7 live activation
covered two of five targets. L8 single-operator custody of keys and endpoint. L9
vector search is qualified on two platforms. L10 two isolation grades are
unqualified. L11 the sealed-holdout gate shares a process with the candidate. L12
probabilistic campaigns use frozen sequences. L13 `releaseDigest` is
protocol-null, so `--version` renders a source-build suffix from a sealed
package. L14 independent verification runs in the same process.

**Resolved — cite, do not carry forward.** L15 macOS x64 is qualified, not
environmentally excused — and this revision's candidate run confirms it: the
`macos-15-intel` leg dequeued and passed all five profiles. L16 T75 evidence
signing is evidenced; its handoff is stale.

**Traceability defects.** L17 feature handoff statuses contradict the
qualification reports. L18 the `#58` canonical-JSON record is internally
inconsistent. **L19 is stale in the opposite direction and is corrected here:**
the matrix records that `apps/site/src/data/product.ts` still declares
`installable: false`, but at the bound revision it reads `installable: true`,
set by `42f2f18` ("stop denying the package") — the same commit the matrix was
compiled at. What is stale is
`.specs/features/npx-launcher/handoff.md:296-303`, which still describes the old
value. None of L17–L19 is a promotion blocker; a decision that cites those
handoffs uncritically will contradict itself, which is why they are named here
rather than inherited.

**Not found in the repository, and therefore not asserted.** No tracked file
states a user-adoption or single-adopter limitation, and there is no open macOS
x64 coverage gap. The matrix says so; this report does not invent either.

## What is not claimed

- **No independent verifier**, and no human review. See the authorship statement.
- **No 1.0 promotion.** The version is `0.0.0-qualification` and the release
  decision has not been made.
- **The signature dimension of the decision contract is not enforced.** The
  validator checks that `signature` and `publicKeyRef` are present and are not
  template placeholders. It does not resolve the key or verify the signature,
  because verifying it requires ratifying which bytes are signed — a decision for
  the owner. The gap is recorded in the specification, the tasks file, and the
  code comment, and is tracked as T7 in
  `.specs/features/release-decision/tasks.md`.
- **The live evidence is not re-executed.** J01, J08, J11, and J12's live rows
  cite T75, T76, and the npx-launcher validation. Re-running them means repeating
  the operator procedure, not re-running a suite.
- **`candidateReleaseDigest` is not settled.** A five-target candidate has five
  release digests; the contract's field is singular. The reconciled closure digest
  is recorded as the value and the contract question is raised, not answered.

## Verdict

**PASS on what this task validates, and no promotion.**

Proven at `3d363f782bad40e5c5be8252e6626216b4f60248`: five gate profiles green on
all five supported targets in candidate run 32967293127, with byte-identical
sealed gate evidence and 94,580 passing test results carrying zero skipped and
zero todo; requirement closure `T77 closure MET` at 93 of 93 against a register
whose digest is read from Git; all twenty-five suites the acceptance matrix cites
present at the bound revision and executed inside that closure; the previously
unenforced `RELEASE-DECISION-CONTRACT.md` now enforced by `pnpm agent:check`
across every fail-closed condition it declares, with 45 behavior tests and twelve
discrimination mutations killed with zero survivors; 7 of 7 acceptance criteria
proven.

Not proven, and not claimed: that a 1.0 release should be promoted. That question
belongs to a signed decision naming an operational reviewer, a security reviewer,
and an accountable human, none of whom has acted, and the first of whom
`docs/merge-governance.md` records as unobtainable by any configuration today.
The prepared decision, its computed evidence, and the ranked case for recording a
hold are in `.specs/features/release-decision/prepared-decision.md`.
