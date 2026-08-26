# Acceptance Matrix

T77 (#18) has to answer one question with evidence: *does what a user and an
operator actually do work, and is every acceptance requirement mapped to an
assertion someone other than the author can re-run?* This file is the canonical
enumeration that question needs. It is a prerequisite for
`docs/qualification/release-decision-1.0.0.md`, not a substitute for it, and it
decides nothing.

Following `REPORT-CONTRACT.md`'s example, this file is explicit about what it
cannot establish. It carries no qualification-report frontmatter because it is
not a qualification report: it does not advance the chain, and `agent:check`
does not count it. Like `REPORT-CONTRACT.md` and `RELEASE-DECISION-CONTRACT.md`
it lives beside the reports and is repository-canonical only.

**Authorship.** Compiled by an agent session operating as the repository
owner's automation, at `42f2f18410e58885597f3b55b2cc43e58d860a80`. No
independent verifier reviewed it, and none is claimed. Every counter below was
produced by executing the named command in this checkout on `win32-x64`,
Node `v24.14.0`, on 2026-08-26; anything not executed says so in its own row.

---

## 1. The acceptance denominator is 93, not 98

Issue #18's body says "98/98 acceptance criteria". No artifact in this
repository has ever contained 98 requirements, and the 98 is not a number this
matrix can adopt.

The reviewed denominator is `docs/requirements-register.json`, which declares
**93** requirements and an empty `openGaps`. The register exists precisely so
that the denominator is a reviewed artifact rather than a number retyped from
an issue body — `scripts/requirements-trace.mjs:9-11` says so in the source
that computes it:

> `98 of 98 proven` is not a checkable claim until the denominator is a
> reviewed artifact rather than a number in an issue body.

`RELEASE-DECISION-CONTRACT.md:52` binds the same rule to the promotion
decision — a decision whose `requirementsRegister` digest does not match the
register at `candidateRevision` fails closed, "The denominator must be the
reviewed register, not a number retyped into the decision" — and its
frontmatter template already reads `requirementsClosed: 93 of 93 requirements
evidenced` (`RELEASE-DECISION-CONTRACT.md:23`).

Two commits establish the register, both on 2026-08-25:

| Commit | Subject | What it did |
| --- | --- | --- |
| `07c5433` | `feat(qualification): make the T77 requirement denominator checkable` | Created the register and the tracer, fixing the denominator at the requirements the repository actually references. |
| `fe462e0` | `test(qualification): evidence the five open requirement gaps (#18)` | Drained the last five declared gaps, so `openGaps` is empty and `T77 closure` can be `MET`. |

**This is not a discrepancy being hidden; closing it is the register's purpose.**
The 98 was a forward-looking estimate written before any enumeration existed.
The register is what an enumeration produced, and it is checkable: the tracer
fails closed on a referenced requirement missing from the register *and* on a
register entry nothing references, so neither inflation nor omission survives a
gate.

### Tracer output, verbatim

`node scripts/requirements-trace.mjs`, run at
`42f2f18410e58885597f3b55b2cc43e58d860a80`, exit status `0`:

```
registered: 93
referenced: 93
declared gaps: 0
traceability CONSISTENT
T77 closure MET
```

This satisfies precondition 3 of `RELEASE-DECISION-CONTRACT.md:94`.
Preconditions 1 and 2 are met by evidence recorded elsewhere:
`corepack pnpm agent:context` derives `T76 complete; T77 next` at this
revision, and `docs/qualification/t76-validation.md` records the dispatched
candidate build (run 32927839487) and its collected five-target closure.
Preconditions 4 and 5 remain open — 4 because no 1.0 candidate revision has
been named, and 5 for the reason recorded in section 4 as L1.

---

## 2. The twelve acceptance journeys

No enumeration of acceptance journeys existed before this file. The phrase
appears in `.specs/features/milestone-2-completion/analysis.md:34` and
`tasks.md:15` only as a deliverable to be built.

**How these twelve were derived.** Every file in `tests/e2e/` was read and
grouped by the end-to-end outcome it drives, rather than by the package it
exercises; the two operator journeys that T75 and T76 proved live are added
from `tests/build/` and `tests/security/`. Nothing was invented: each journey
names an executable that exists in this checkout. The reverse map in section
2.13 proves the grouping is total — every one of the nineteen `tests/e2e/`
suites is claimed by exactly one journey, so no suite was silently dropped to
make the list come out at twelve.

Three consolidations are worth naming, because each merges what could
defensibly have been two rows:

- **J03** merges workspace initialization with machine bootstrap. Both are "set
  up this project on this machine", and both assert the same property — Git
  stays byte-identical.
- **J04** merges task execution, the gate, and human review. Splitting them
  would describe three halves of one delivery, and the suites hand off to each
  other.
- **J08** merges the packaged smoke profile with the deeper profiles. They are
  one user question — "does this installation work?" — asked at two depths, and
  both proofs are listed separately inside the journey.

### Summary

| Id | Outcome, in user terms | Status |
| --- | --- | --- |
| J01 | I install Verchestra on a clean machine with one command and get a verified, activated release. | Proven, deterministic and live on 2 platforms |
| J02 | I move an installed machine to a new release, back to the old one, and can remove it without losing my data. | Proven deterministically; no live rollback recorded |
| J03 | I turn my repository into a Workspace, previewing every change first, and bind the AI backends on this machine. | Proven |
| J04 | I hand a task to a driver and it cannot reach "done" without passing a gate and a human review. | Proven |
| J05 | I hand in-flight work to another machine without handing over my machine's authority. | Proven |
| J06 | Work I started under one AI backend finishes under a different one, unchanged. | Proven |
| J07 | A sealed Execution Package survives a move between machines with different local keys. | Proven |
| J08 | I can prove my installation actually works, without a repository checkout. | Proven, with one recorded defect (#370) |
| J09 | I ask what is wrong with this machine and get an actionable, path-free report. | Proven — and cannot report `PASS`, by protocol |
| J10 | I restore a machine from an encrypted bundle, and send diagnostics without leaking my paths. | Proven deterministically; no live restore recorded |
| J11 | I turn a revision into a signed, reproducible release a stranger can verify from a public endpoint. | Proven deterministically; performed live once |
| J12 | A third party verifies the evidence behind a release without any access to this repository. | Proven; custody is single-operator |

### 2.1 J01 — Install and activate on a clean machine

**Outcome.** Someone with Node and a network connection runs one command and
ends up with a cryptographically verified, activated Verchestra release.

**Executed by.** `npx -y verchestra --version`, `npx -y verchestra --help`.

| Proof | Counters |
| --- | --- |
| `tests/e2e/vestra-launcher-activation.test.mjs` — resolve, verify, activate, hand off; a tampered component byte stops the bootstrap before anything is activated | 5 tests, 5 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/tuf-update-client.test.mjs` — delegated component targets, sequential root rotation, consistent snapshots, staged bytes matching every TUF-bound component | 15 tests, 15 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/tuf-source-adapters.test.mjs` — traversal, junction, symlink, redirect, and length-bound refusals in the filesystem and HTTPS adapters | 16 tests, 16 pass, 0 fail, 0 skipped, 0 todo |
| Live, `linux-x64` and `win32-x64`, from the published registry package | `.specs/features/npx-launcher/validation.md` "T4 evidence"; `docs/qualification/t76-validation.md` "Clean-machine registry smoke" |

**Honest qualification.** Live activation was executed on two of the five
supported targets. `darwin-arm64`, `darwin-x64`, and `linux-arm64` carry
deterministic five-profile gate coverage at the candidate revision
(`t76-validation.md`, candidate run 32927839487) but no live activation record.

### 2.2 J02 — Update, roll back, and uninstall an installed release

**Outcome.** An operator moves a machine forward to a new release, back to the
previous one, and can remove Verchestra entirely without touching user data.

**Executed by.** The installer lifecycle: install → activate → rollback →
uninstall (purge), per declared launcher host.

| Proof | Counters |
| --- | --- |
| `tests/e2e/installer-lifecycle-matrix.test.mjs` — the matrix covers exactly the declared host set; a purge after a rollback removes every managed release and no user data; a rollback to a purged release is refused and the root stays usable; an undeclared host is refused as an activation target | 17 tests, 17 pass, 0 fail, 0 skipped, 0 todo |
| `.specs/features/platform-qualification-matrix/matrix.json` — `installer` dimension, 4 cases, all `qualified` | Declared, reviewed |

**Honest qualification.** No update or rollback has been executed against the
live published endpoint. T76 published one release; the rollback evidence there
is the publication-side rollback index sealed from the prior candidate
(`af8bcf044cf8`), not a client that moved between two published releases. A
live update/rollback is **not executed in this pass**.

### 2.3 J03 — Initialize a Workspace and bind this machine's backends

**Outcome.** A developer turns an existing Git repository into a Workspace,
seeing every proposed change before it is applied, and binds whichever AI
backends are installed locally without changing anything in Git.

**Executed by.** `vestra init --dry-run`, `vestra init`, machine bootstrap.

| Proof | Counters |
| --- | --- |
| `tests/e2e/safe-init-e2e.test.mjs` — standalone init exposes exactly the canonical tracked candidates; centralized init leaves an ignored nested source repository byte-identical; a second init has no Git diff | 4 tests, 4 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/cli-launchers-e2e.test.mjs` — init dry-run uses the production composition and leaves a real Git workspace byte-identical; one reviewed preview applies and repeats as a no-op | 16 tests, 16 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/machine-bootstrap-e2e.test.mjs` — Claude plus Codex bootstrap changes only external machine state; the same clone bootstraps on OpenCode Qwen-only state with no shared artifact change | 3 tests, 3 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/workspace-reconcile-e2e.test.mjs` — SQLite-backed sync survives restart and repeats with no mutation; authorized monorepo topology reconciliation is atomic | 3 tests, 3 pass, 0 fail, 0 skipped, 0 todo |

### 2.4 J04 — Deliver one task to human-reviewed completion

**Outcome.** A driver executes a task in an isolated worktree; the gate decides
whether it may commit; verification runs; and only an authenticated human
review can mark the work complete. This is the journey the product's central
claim rests on.

**Executed by.** Task execution → gate → commit → verification → human review.

| Proof | Counters |
| --- | --- |
| `tests/e2e/task-executor-e2e.test.mjs` — an authorized Driver and mediated Tool reach `AWAITING_GATE` in a real isolated worktree; a stale Approval at the Tool boundary performs no write and removes the worktree; post-execution inspection catches a Driver bypass outside task scope | 4 tests, 4 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/gate-commit-negative.test.mjs` — pre- and post-gate diff drift block the commit; an invalid commit receipt cannot mark the task committed; stale gate authority, Approval expiry, expired writer coordination, and a gate plan digest mismatch each block before effects | 23 tests, 23 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/verification-human-review.test.mjs` — PASS verification enters `HUMAN_REVIEW` but never `COMPLETED`; a non-human reviewer cannot authorize completion; a caller-declared PASS cannot replace an authenticated verification report | 13 tests, 13 pass, 0 fail, 0 skipped, 0 todo |

### 2.5 J05 — Hand work to another machine or operator

**Outcome.** An operator hands in-flight delivery work to a successor without
transferring machine authority; the successor resumes under its own local
approval, and the source's approval is invalidated.

**Executed by.** Handoff prepare → publish → accept → continue.

| Proof | Counters |
| --- | --- |
| `tests/e2e/handoff-journey.test.mjs` — the receiver backend profile is local and absent from the portable artifact; acceptance invalidates the source Approval and continuation requires a new local one; every stage's retry converges on one record | 10 tests, 10 pass, 0 fail, 0 skipped, 0 todo |

### 2.6 J06 — Continue the same delivery under a different AI backend

**Outcome.** Work started under one backend reaches completed human review
under a different backend, with the integrations still pointing at the exact
same package.

| Proof | Counters |
| --- | --- |
| `tests/e2e/cross-backend-delivery-journey.test.mjs` — a Claude package reaches completed Human Review under OpenCode Qwen; semantic obligations and the first pending task survive the backend change; the receiver gets a fresh execution Approval and never inherits the source's | 8 tests, 8 pass, 0 fail, 0 skipped, 0 todo |

### 2.7 J07 — Move an Execution Package across machine-local key roots

**Outcome.** A sealed Execution Package crosses two machines whose local key
material differs and resumes under a different qualified driver.

| Proof | Counters |
| --- | --- |
| `tests/e2e/key-lifecycle-portability.test.mjs` — one end-to-end case crossing two machine-local key roots | 1 test, 1 pass, 0 fail, 0 skipped, 0 todo |
| `docs/qualification/t68a-validation.md` | Chain evidence |

**Honest qualification.** This journey's e2e proof is a single case. Its
breadth comes from `docs/qualification/t68a-validation.md` and the key-lifecycle
unit and security suites, which were **not executed in this pass**.

### 2.8 J08 — Prove an installation works, from a sealed bundle upward

**Outcome.** A user, and a sealed installed bundle with no repository sources,
can both prove the installation is functional.

**Executed by.** `verchestra self-test --profile smoke` (the portability demo
fixed by AD-032), then `workspace`, `drivers`, and `full`.

| Proof | Counters |
| --- | --- |
| `tests/e2e/self-test-cli-e2e.test.mjs` — `smoke` and `workspace` exit 0 with PASS verdicts; `drivers` reaches every approved boundary; `full` includes hard-crash recovery; a missing or invalid `--profile` fails before dispatch; the invoking Git repository stays byte-identical | 10 tests, 10 pass, 0 fail, 0 skipped, 0 todo |
| `tests/build/sealed-launcher-closure.test.mjs` — the real `NodeActivationHealthGate` drives both sealed launchers from a staged layout with no `src/` and no `node_modules/`, and holds a red case proving the development shims fail the same gate | 7 tests, 7 pass, 0 fail, 0 skipped, 0 todo |
| Live, both platforms: `self-test --profile smoke` → `verdict: PASS`, `check_count: 6`, `failure_codes: []` | `.specs/features/npx-launcher/validation.md` "T4 evidence" |

**Recorded defect.** `self-test` refuses when the working directory is an
ancestor of the OS temporary directory, which is the default Windows home
directory ([#370](https://github.com/accd/verchestra/issues/370)). It is
documented in `README.md`, `docs/install-and-run`, and the tarball README, and
the published package still carries it. See section 4, L5.

### 2.9 J09 — Diagnose a machine with deep doctor

**Outcome.** An operator asks Verchestra what is wrong with this machine and
gets a schema-valid report that exposes no absolute machine path.

**Executed by.** `vestra doctor --deep`.

| Proof | Counters |
| --- | --- |
| `tests/e2e/doctor-cli-e2e.test.mjs` — the report validates against `doctor-report@1`; a bare source machine reports `BLOCKED` and exits 4; human and JSON renderers project the same verdict; the report exposes no absolute machine path; every check belongs to the closed twelve-id catalog; two runs converge on the same fingerprint; the diagnostic writes nothing | 8 tests, 8 pass, 0 fail, 0 skipped, 0 todo |

**Honest qualification — `doctor` cannot reach `PASS` on a real machine, now for
one documented reason.** Two checks were `blocked` by design; one is resolved and
one remains:

- **native-asset — resolved (was the circular-digest blocker).** It no longer
  keys off the protocol-null `releaseDigest`. `doctor.native-asset` now reads the
  machine's activation record: the composition root supplies the install root the
  sealed bundle actually sits in (`apps/vestra-cli/src/main.ts`, three levels up
  from its own `bin/`), and the probe cross-checks `<installRoot>/active.json`
  against `releases/<digest>/release.json`
  (`apps/vestra-cli/src/doctor-composition.ts`). A genuinely activated release
  reports `pass`; a source checkout or un-activated layout reports `blocked`,
  honestly; an inconsistent activation record reports `fail`. Asserted by
  `tests/integration/doctor-native-asset-probe.test.mjs` and the sealed-mode case
  in `tests/build/sealed-launcher-closure.test.mjs:295`.
- **secret-presence — the remaining blocker
  ([#379](https://github.com/accd/verchestra/issues/379)).**
  `doctor.secret-presence` is `absent` → `blocked` because no production
  `SecretAdapter` exists to observe: the only real adapter,
  `QualifiedOsSecretAdapter`, needs an OS keychain bridge
  (`packages/platform-node/src/secret-broker.ts`) that the product does not yet
  construct. `packages/application/src/doctor/doctor-facts.ts:56` maps `absent` to
  `blocked`, and `doctor.ts:195` computes `PASS` only when nothing is `blocked`.

So `doctor` still cannot report `PASS` on a real machine — but the reason is now
the missing secret backend (#379), not the circular release digest, and a
sealed-mode doctor verdict is now asserted where before none was.

### 2.10 J10 — Recover a machine, and send diagnostics safely

**Outcome.** An operator restores managed state from an encrypted recovery
bundle, and exports a redacted support bundle that only an authorized recipient
can open.

| Proof | Counters |
| --- | --- |
| `tests/e2e/recovery-bundle-e2e.test.mjs` — General JWE opens the same signed closure per recipient; inspection exposes metadata without decrypting object bytes; a consistent-snapshot barrier rejects state movement mid-capture; staged restore validates, rebinds, reconciles, then activates | 9 tests, 9 pass, 0 fail, 0 skipped, 0 todo |
| `tests/e2e/support-bundle-e2e.test.mjs` — machine paths become deterministic non-reversible pseudonyms; export verifies inspection then Approval then egress before publication; a denied Approval or denied Data Egress produces no encryption and no publication | 10 tests, 10 pass, 0 fail, 0 skipped, 0 todo |

**Honest qualification.** No live disaster recovery has been performed on a
real machine. Both proofs are deterministic.

### 2.11 J11 — Build, promote, and publish a verified release

**Outcome.** An operator turns one repository revision into a signed,
reproducible release that a stranger can resolve and verify from a public
endpoint.

**Executed by.** Candidate build → sealed closure → promotion gate → TUF
publication → upload → independent verification.

| Proof | Counters |
| --- | --- |
| `tests/e2e/promotion-gate-e2e.test.mjs` — a clean candidate is `PROMOTED`; block conditions accumulate with exact codes; the holdout digest in the report equals the sealed oracle digest | 15 tests, 15 pass, 0 fail, 0 skipped, 0 todo |
| `tests/build/t76-release-publication.test.mjs` — per-target signed repositories, exactly one shared `release-inputs/`, every `remoteKey` mirroring the emitted tree, and the base-URL/rollback/key rejection sets leaving no output directory behind | 20 tests, 20 pass, 0 fail, 0 skipped, 0 todo |
| `tests/build/tuf-publication.test.mjs` — signed root, top-level targets, terminating component delegation, snapshot, timestamp; unsafe target paths refused before any publication directory exists | 6 tests, 6 pass, 0 fail, 0 skipped, 0 todo |
| Live: candidate run 32927839487, publication run 32929312169, 990 assets sha256-verified at the endpoint, `verchestra@0.0.0-qualification` on the public npm registry | `docs/qualification/t76-validation.md` "Live evidence" |

**Honest qualification.** Performed live exactly once, by a single operator,
against a single storage endpoint. See section 4, L1 and L8.

### 2.12 J12 — Verify the evidence behind a release from outside

**Outcome.** A third party checks that the qualification evidence for a release
was signed under protected custody, using off-the-shelf DSSE tooling and no
access to this repository.

| Proof | Counters |
| --- | --- |
| `tests/security/t75-evidence-attestation.test.mjs` — the evidence index attestation binds the exact candidate revision | 3 tests, 3 pass, 0 fail, 0 skipped, 0 todo |
| `tests/security/trust-key-separation.test.mjs` — the signing trust domain is separated from the release trust domain | 3 tests, 3 pass, 0 fail, 0 skipped, 0 todo |
| `tests/security/dsse-interoperability.test.mjs` — the envelope is readable by standard DSSE/in-toto verification | 3 tests, 3 pass, 0 fail, 0 skipped, 0 todo |
| Live: `signed-evidence-index.json` reports `signed: true`, verified outside the producing run | `docs/qualification/t75-validation.md` |

**Honest qualification.** The signing key and the storage endpoint are under
single-operator custody. See section 4, L8.

### 2.13 Reverse map — every end-to-end suite is claimed

Nineteen suites exist under `tests/e2e/`. Each is claimed by exactly one
journey; no suite is unclaimed, and no journey cites a suite that does not
exist.

| Suite | Journey |
| --- | --- |
| `cli-launchers-e2e.test.mjs` | J03 |
| `cross-backend-delivery-journey.test.mjs` | J06 |
| `doctor-cli-e2e.test.mjs` | J09 |
| `gate-commit-negative.test.mjs` | J04 |
| `handoff-journey.test.mjs` | J05 |
| `installer-lifecycle-matrix.test.mjs` | J02 |
| `key-lifecycle-portability.test.mjs` | J07 |
| `machine-bootstrap-e2e.test.mjs` | J03 |
| `promotion-gate-e2e.test.mjs` | J11 |
| `recovery-bundle-e2e.test.mjs` | J10 |
| `safe-init-e2e.test.mjs` | J03 |
| `self-test-cli-e2e.test.mjs` | J08 |
| `support-bundle-e2e.test.mjs` | J10 |
| `task-executor-e2e.test.mjs` | J04 |
| `tuf-source-adapters.test.mjs` | J01 |
| `tuf-update-client.test.mjs` | J01 |
| `verification-human-review.test.mjs` | J04 |
| `vestra-launcher-activation.test.mjs` | J01 |
| `workspace-reconcile-e2e.test.mjs` | J03 |

Plus six suites outside `tests/e2e/`, cited because they carry the sealed and
operator evidence no e2e suite holds:
`tests/build/sealed-launcher-closure.test.mjs` (J08),
`tests/build/t76-release-publication.test.mjs` and
`tests/build/tuf-publication.test.mjs` (J11), and
`tests/security/t75-evidence-attestation.test.mjs`,
`tests/security/trust-key-separation.test.mjs`, and
`tests/security/dsse-interoperability.test.mjs` (J12).

### 2.14 Execution record

Every suite named above was executed in this checkout at
`42f2f18410e58885597f3b55b2cc43e58d860a80`.

**232 tests, 232 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, across 25
suite files — all nineteen under `tests/e2e/` plus the six named in section
2.13. The counters are the Node test runner's own, and subtests are included in
them, which is why some totals exceed the number of top-level `test()` calls in
a file.

Three things were **not executed in this pass** and are marked as such above: a
live update/rollback against the published endpoint (J02), a live disaster
recovery (J10), and the key-lifecycle unit and security suites behind J07. The
live rows in J01, J08, J11, and J12 were not re-executed either; they cite the
T75/T76 reports and the npx-launcher validation, which recorded them.

---

## 3. Requirement coverage

### How this view was derived

The register carries only `id`, `declaredIn`, `home`, and `evidence` — it holds
no prose. Meaning is reconstructible only from the artifacts that cite each id,
so this view is generated rather than written:

1. `collectReferences()` from `scripts/requirements-trace.mjs` walks `.specs`,
   `docs`, `tests`, `packages`, `apps`, and `scripts`, and returns, per
   requirement id, the specification, test, source, and qualification-report
   files that reference it.
2. Each id's `qualificationReport` list is projected to its task numbers, and
   its `test` list is carried through unchanged.
3. The **Journey** column is the one editorial step. It maps a requirement
   *family* (the three-letter segment) to the journeys whose execution
   exercises that family's subject matter. It is a reading, not a derivation.

That third point is the honest limit of this section, and it must not be
overstated. **The 93 register requirements and the 12 journeys are two
different views of the system.** The register's vocabulary was declared across
the T01–T68 foundation reports; the journeys are end-to-end executions proved
by the T68a–T76 suites. Exactly one of the 93 requirements — `VES-VFY-001` —
cites a `tests/e2e/` file at all, and it is the only place where a requirement
reaches a journey's proving suite by literal citation. Everywhere else the
Journey column says "this journey exercises this subject matter", which a
reviewer can check by reading and cannot check mechanically.

A reviewer who wants a mechanically checkable requirement-to-journey link
should treat that as the finding: closing it means citing requirement ids from
the end-to-end suites, which is a source change, not a documentation change.

Regenerate columns 1–4 with:

```bash
node scripts/requirements-trace.mjs
```

and, for the per-id detail, the `collectReferences()` export the same file
provides.

**One reproducibility caveat, stated so a regeneration is not misread.** The
table below was generated before this file existed. Because this file names all
93 ids and lives under `docs/qualification/`, `classify()` now counts it as a
qualification report for every one of them, so regenerating in place adds
`acceptance-matrix.md` to every row's report list. That self-citation is an
artifact of the scan, not evidence: an enumeration of requirements does not
evidence them. Exclude this path when regenerating, exactly as
`scripts/requirements-trace.mjs:90` already excludes itself for the same
reason. The register totals are unaffected — `registered: 93 / referenced: 93 /
declared gaps: 0` still holds with this file present, which is the output
recorded in section 1.

### Distribution

| `home` / `evidence` | Count |
| --- | --- |
| `qualification-report-only` / `report` | 66 |
| `qualification-report-only` / `test` | 13 |
| `specification` / `report` | 11 |
| `specification` / `test` | 3 |
| **Total** | **93** |

By family, with the journey each maps to:

| Family | n | Subject (reconstructed from citing reports) | Journey |
| --- | --- | --- | --- |
| `VES-BST` | 5 | Machine bootstrap, state roots, secret naming | J03 |
| `VES-CLI` | 5 | Installed CLI surface and version identity | J01, J03 |
| `VES-CTX` | 6 | Context assembly, determinism, injection boundary | J04 |
| `VES-DBP` | 6 | Read-only database probes | none — see below |
| `VES-DSC` | 3 | Discovery, source identity, provenance | J03 |
| `VES-EXE` | 6 | Task execution authority and isolation | J04 |
| `VES-HOF` | 6 | Portable handoff closure | J05, J06 |
| `VES-INT` | 5 | Managed Jira and Confluence projection | J06 |
| `VES-MDL` | 4 | Model routing and provider separation | J04 |
| `VES-MEM` | 4 | Hybrid memory ingestion and search | J04 |
| `VES-ORD` | 1 | Canonical ordering | cross-cutting |
| `VES-RLS` | 6 | Hermetic closure, distribution, activation | J01, J02, J11 |
| `VES-SEC` | 6 | Policy precedence, approval, egress | J12, cross-cutting |
| `VES-SKL` | 4 | Skill boundary and executable content | J04 |
| `VES-SPC` | 4 | Execution Package and specification identity | J07 |
| `VES-STF` | 2 | Self-Test profile catalog | J08 |
| `VES-TST` | 8 | Diagnostics, doctor, regression catalog | J08, J09 |
| `VES-VFY` | 5 | Verification, gates, human review | J04 |
| `VES-WSP` | 7 | Workspace placement and reconciliation | J03 |

**`VES-DBP` maps to no acceptance journey, and that is stated rather than
padded.** Seven of the eight database engines are `contract-qualified` in
`.specs/features/platform-qualification-matrix/matrix.json` — "Conformance kit
against fixtures; no live server" — so there is no end-to-end journey to point
at. Its evidence is the T40–T49 report chain and the contract kits. See section
4, L4.

### Per-requirement detail

Columns 1–4 are generated; column 5 is the family mapping above.

<!-- Generated from scripts/requirements-trace.mjs at 42f2f18. -->

| Requirement | Evidence | Qualification reports citing it | Direct test assertions | Journey |
| --- | --- | --- | --- | --- |
| `VES-BST-001` | report | T17, T19, T20, T21, T53, T65 | — | J03 |
| `VES-BST-002` | report | T05, T17, T21, T23, T31, T32, T37, T61 | — | J03 |
| `VES-BST-003` | report | T17, T21 | — | J03 |
| `VES-BST-004` | report | T07, T15, T16, T22, T65 | — | J03 |
| `VES-BST-005` | report | T21, T22, T23, T68 | — | J03 |
| `VES-CLI-001` | report | T01, T23, T66, T68 | — | J01, J03 |
| `VES-CLI-002` | report | T01, T23 | — | J01, J03 |
| `VES-CLI-003` | report | T23 | — | J01, J03 |
| `VES-CLI-004` | report | T01, T09, T13, T23, T66, T67, T68 | — | J01, J03 |
| `VES-CLI-005` | report | T11, T13, T23 | — | J01, J03 |
| `VES-CTX-001` | report | T02, T28, T29, T34 | — | J04 |
| `VES-CTX-002` | report | T29, T30, T52 | — | J04 |
| `VES-CTX-003` | report | T27, T29, T63 | — | J04 |
| `VES-CTX-004` | report | T29, T30 | — | J04 |
| `VES-CTX-005` | test | T52 | `unit/memory-retriever.test.mjs` | J04 |
| `VES-CTX-006` | report | `cedar.md`, T06, T24, T29, T63 | — | J04 |
| `VES-DBP-001` | report | T21, T40 | — | none |
| `VES-DBP-002` | report | T08, T41, T42, T43, T44, T45, T46, T47, T48 | — | none |
| `VES-DBP-003` | report | T44, T45, T46, T47, T48 | — | none |
| `VES-DBP-004` | report | T44, T45, T49 | — | none |
| `VES-DBP-005` | report | T44, T45, T46, T47, T48, T49 | — | none |
| `VES-DBP-006` | report | T49 | — | none |
| `VES-DSC-001` | report | T18, T28, T39, T40 | — | J03 |
| `VES-DSC-004` | report | T27, T28, T50, T63 | — | J03 |
| `VES-DSC-005` | report | T13, T28, T49, T50, T63 | — | J03 |
| `VES-EXE-001` | test | `cedar.md`, T06, T14, T24, T25, T58, T61 | `helpers/task-executor-fixture.mjs` `helpers/task-scheduler-fixture.mjs` `integration/task-executor.test.mjs` | J04 |
| `VES-EXE-002` | report | T25 | — | J04 |
| `VES-EXE-003` | report | T15, T25, T29 | — | J04 |
| `VES-EXE-004` | report | T15, T26, T62 | — | J04 |
| `VES-EXE-005` | report | T26 | — | J04 |
| `VES-EXE-006` | test | T59 | `helpers/gate-commit-fixture.mjs` `integration/gate-commit.test.mjs` | J04 |
| `VES-HOF-001` | report | T12, T14, T26, T54, T55, T61, T65 | — | J05, J06 |
| `VES-HOF-002` | report | T25, T61, T64 | — | J05, J06 |
| `VES-HOF-003` | report | T05, T31, T32, T37, T61, T65 | — | J05, J06 |
| `VES-HOF-004` | report | T02, T03, T04, T30, T35, T36, T61 | — | J05, J06 |
| `VES-HOF-005` | report | T16, T56, T61, T62, T64, T65 | — | J05, J06 |
| `VES-HOF-006` | report | T61, T64 | — | J05, J06 |
| `VES-INT-001` | report | T26, T62, T65 | — | J06 |
| `VES-INT-002` | report | T64 | — | J06 |
| `VES-INT-003` | report | T63 | — | J06 |
| `VES-INT-004` | report | T22, T62, T64 | — | J06 |
| `VES-INT-005` | report | T16, T22, T62, T64, T65 | — | J06 |
| `VES-MDL-001` | report | T04, T05, T29, T31, T32, T34, T36, T37 | — | J04 |
| `VES-MDL-002` | report | T03, T21, T35 | — | J04 |
| `VES-MDL-003` | test | — | `unit/promotion-gate.test.mjs` `unit/regression-campaigns.test.mjs` | J04 |
| `VES-MDL-005` | report | T02, T30, T33 | — | J04 |
| `VES-MEM-001` | report | T07, T50, T51 | — | J04 |
| `VES-MEM-002` | report | T07, T52 | — | J04 |
| `VES-MEM-003` | report | T07, T22, T50 | — | J04 |
| `VES-MEM-004` | report | T53 | — | J04 |
| `VES-ORD-001` | test | — | `helpers/database-knowledge-fixture.mjs` `integration/database-knowledge.test.mjs` | cross-cutting |
| `VES-RLS-001` | report | T01, T09, T66, T67, T68 | — | J01, J02, J11 |
| `VES-RLS-002` | report | T01, T66 | — | J01, J02, J11 |
| `VES-RLS-003` | report | T09, T27, T57 | — | J01, J02, J11 |
| `VES-RLS-004` | report | T25 | — | J01, J02, J11 |
| `VES-RLS-005` | report | T12, T14, T15, T55 | — | J01, J02, J11 |
| `VES-RLS-006` | test | — | `unit/promotion-gate.test.mjs` `unit/regression-campaigns.test.mjs` | J01, J02, J11 |
| `VES-SEC-001` | report | `cedar.md`, T06, T24 | — | J12, cross-cutting |
| `VES-SEC-002` | report | `cedar.md`, T06, T24 | — | J12, cross-cutting |
| `VES-SEC-003` | report | T08, T17, T52, T53 | — | J12, cross-cutting |
| `VES-SEC-004` | report | T07, T09, T56 | — | J12, cross-cutting |
| `VES-SEC-005` | report | T07, T09 | — | J12, cross-cutting |
| `VES-SEC-006` | report | `cedar.md`, T06, T08, T17, T27, T52, T57 | — | J12, cross-cutting |
| `VES-SKL-001` | report | T38 | — | J04 |
| `VES-SKL-004` | report | T39 | — | J04 |
| `VES-SKL-005` | report | T02, T08, T34 | — | J04 |
| `VES-SKL-006` | report | T67 | — | J04 |
| `VES-SPC-001` | test | T11, T38, T39, T49, T54, T60 | `helpers/execution-package-fixture.mjs` `unit/execution-package.test.mjs` | J07 |
| `VES-SPC-003` | test | T58, T59 | `helpers/gate-commit-fixture.mjs` `integration/gate-commit.test.mjs` | J07 |
| `VES-SPC-004` | test | T12, T14, T28 | `helpers/execution-package-fixture.mjs` `unit/domain-primitives.test.mjs` `unit/execution-package.test.mjs` | J07 |
| `VES-SPC-005` | report | T11 | — | J07 |
| `VES-STF-001` | test | — | `unit/self-test-t71-rules.test.mjs` | J08 |
| `VES-STF-002` | test | — | `unit/self-test-t71-rules.test.mjs` | J08 |
| `VES-TST-001` | report | T33 | — | J08, J09 |
| `VES-TST-002` | report | T20 | — | J08, J09 |
| `VES-TST-003` | report | T41, T55 | — | J08, J09 |
| `VES-TST-004` | report | T20 | — | J08, J09 |
| `VES-TST-005` | report | T25, T35, T36, T37 | — | J08, J09 |
| `VES-TST-006` | report | T16 | — | J08, J09 |
| `VES-TST-007` | report | T11, T13, T57 | — | J08, J09 |
| `VES-TST-008` | test | — | `unit/doctor-rules.test.mjs` | J08, J09 |
| `VES-VFY-001` | test | T10, T33, T58, T59, T65 | `e2e/gate-commit-negative.test.mjs` `helpers/gate-commit-fixture.mjs` `helpers/task-executor-fixture.mjs` `integration/gate-commit-adapters.test.mjs` `integration/gate-commit.test.mjs` `integration/task-executor.test.mjs` | J04 |
| `VES-VFY-002` | test | — | `helpers/gate-commit-fixture.mjs` `integration/gate-commit-adapters.test.mjs` `integration/gate-commit.test.mjs` | J04 |
| `VES-VFY-003` | test | T14, T60, T65 | `helpers/verification-fixture.mjs` `unit/independent-verification.test.mjs` | J04 |
| `VES-VFY-004` | test | — | `helpers/verification-fixture.mjs` `unit/independent-verification.test.mjs` | J04 |
| `VES-VFY-006` | report | T55 | — | J04 |
| `VES-WSP-001` | report | T18, T20, T23 | — | J03 |
| `VES-WSP-002` | report | T18, T20 | — | J03 |
| `VES-WSP-003` | report | T19, T20 | — | J03 |
| `VES-WSP-004` | report | T19, T20 | — | J03 |
| `VES-WSP-005` | report | T20 | — | J03 |
| `VES-WSP-006` | report | T19, T22 | — | J03 |
| `VES-WSP-007` | report | T17, T18, T19, T20 | — | J03 |

---

## 4. Known limitations a 1.0 decision must weigh

Every item is a written record in a tracked file, cited by path. Nothing here
is inferred except L2, which is derived from source and is labelled as such.
Items are grouped by what a reviewer has to do about them.

### Blocking — the decision cannot honestly record PASS while these hold

**L1. No independent verifier exists, and none is obtainable by
configuration.** `docs/merge-governance.md:19-24` states plainly that
independent review "is not satisfiable for the maintainer's own pull requests",
that `.github/CODEOWNERS` names one owner, and that "no configuration produces
one". T75 and T76 both say so in their own words:
`docs/qualification/t75-validation.md:27-28` and
`t76-validation.md:41` — "This report does not claim an independent verifier
distinct from the implementation author, because there was none."
`RELEASE-DECISION-CONTRACT.md:96` requires an operational reviewer and a
security reviewer, "both distinct from the deciding human and from the
implementation author". This matrix is in the same position and says so at the
top.

**L2. `doctor` cannot report `PASS` on a real machine — now for one documented
reason ([#379](https://github.com/accd/verchestra/issues/379)), not the circular
digest.** The native-asset half is resolved: the probe reads the activation
record (`active.json` cross-checked against `releases/<digest>/release.json`)
instead of the protocol-null `releaseDigest`, and a sealed-mode doctor verdict is
now asserted (`tests/build/sealed-launcher-closure.test.mjs`,
`tests/integration/doctor-native-asset-probe.test.mjs`) where the earlier version
of this matrix noted none existed. The remaining blocker is
`doctor.secret-presence`: no production `SecretAdapter`/OS keychain backend exists
to observe (`secret-broker.ts`), so it stays `blocked`, and because `doctor.ts:195`
reaches `PASS` only when nothing is `blocked`, `doctor` stays `BLOCKED`. Tracked
as #379. A 1.0 decision that promises a working `doctor` must either accept a
permanently `BLOCKED` verdict until #379 ships, or scope the promise accordingly.

**L3. `gate:release` was historically vacuous and its closure must be
re-checked.** `docs/audits/2026-08-verchestra-product-repository-audit.md:47`
records that `test:release` passed vacuously while `tests/public-regression/`
and `tests/system/` did not exist, and that until filled, "gate:release passed"
is weaker than it reads. T73 filled it, and `scripts/test-scope.mjs:20-23` now
fails a scope with zero tests. Confirm the closure at the candidate revision
rather than inheriting the claim.

### Qualifying — must be disclosed in the decision, do not block it

**L4. Seven of eight database engines are contract-qualified, not live.**
`.specs/features/platform-qualification-matrix/matrix.json:7` defines
`contract-qualified` as "The contract is exercised against fixtures; no live
instance was qualified", and PostgreSQL, MySQL, MariaDB, SQL Server, Oracle,
MongoDB, and SAP ASE all carry "Conformance kit against fixtures; no live
server". Only SQLite is live-qualified.
`docs/qualification/t75-validation.md:103` records this as owner decision
AD-017. This is why `VES-DBP` maps to no journey.

**L5. The published package carries a known `self-test` defect (#370).**
`README.md:169` records that `self-test` refuses when the working directory is
an ancestor of the OS temporary directory — which is the default Windows home
directory, and therefore the default location for the one-command demo.
`.specs/features/npx-launcher/handoff.md:9` says the launcher must be
republished once the fix ships. Until republication, the artifact on the public
registry is not the artifact a 1.0 decision would want to promote.

**L6. The four TUF source modes are not proven by cross-adapter equivalence.**
`docs/qualification/t76-validation.md:102-135` records this under "Recorded
limitation": the four-mode loops use `MapDistributionSource`, whose `mode` is
"a cosmetic constructor label", and the `views` descriptors are "not observable
in the emitted `publication-manifest.json`". The parallel hardening PR is
"deliberately not counted as evidence" for the bound revision
(`t76-validation.md:134`, `:252`).

**L7. Live activation covered two of five supported targets.**
`docs/qualification/t76-validation.md:197,204` record live activation on
`win32-x64` and `linux-x64` only. Deterministic five-profile gates ran on all
five targets in candidate run 32927839487; no `darwin-*` or `linux-arm64` live
activation record exists. Reflected in J01.

**L8. Single-operator custody of the signing keys and the storage endpoint.**
T76's live evidence is one operator, one Cloudflare R2 bucket, and one npm
account under the owner's 2FA (`t76-validation.md:176-216`). The T75 evidence
index is signed under owner-provisioned protected custody
(`t75-validation.md:66`). Nothing in the repository provides key rotation
across operators or a second endpoint. `docs/merge-governance.md:37-38` records
the corresponding governance property: the ruleset carries one permanent bypass
actor, the `Repository admin` role, always allowed.

**L9. Vector search is qualified on two platforms.**
`docs/qualification/sqlite.md:21` records that "macOS, ARM, and unknown
platforms remain explicitly unqualified and degrade to lexical-only operation".
Semantic retrieval is therefore a two-of-five-platform capability with an
asserted degraded path, not a skip.

**L10. Two isolation grades are not qualified.**
`.specs/features/platform-qualification-matrix/matrix.json` marks
`isolation-grade:native-restricted` and `isolation-grade:container-isolated`
`not-qualified`; `docs/qualification/isolation.md:7` records that the Windows
fixture qualifies only `process-contained` and "does not claim OS sandbox
strength". `t75-validation.md:99` names both rather than omitting them.

**L11. The sealed-holdout promotion gate shares a process with the candidate,
and contamination is a supplied fact.**
`docs/qualification/t74-validation.md:130-131` records that AD-018 defers
process/storage isolation and an observed contamination detector to post-1.0
work (#235). `.specs/features/sealed-holdout/handoff.md:97-98` records PROM-05
as "the honest PARTIAL the T74 verification recorded, deliberately not
promoted".

**L12. Probabilistic regression campaigns use frozen sequences.**
`docs/qualification/t73-validation.md:177-178` states the verdict "does not
claim that the two probabilistic campaigns sampled a live provider".

**L13. `releaseDigest` is protocol-null, so `--version` renders a source-build
suffix from a sealed package.** `t76-validation.md:223-225` records this as a
known cosmetic item, "deliberately unchanged at this revision". It is the same
protocol property that produces L2.

**L14. Independent verification runs in the same process.**
`docs/audits/2026-08-verchestra-product-repository-audit.md:45` records
`IndependentVerificationCoordinator` as same-runtime today (#35). `README.md:89`
states the repository "does not call same-author checks independent
verification".

### Resolved — cite as evidence, do not carry forward as open

**L15. macOS x64 is qualified, not environmentally excused.** This contradicts
a widely repeated assumption and is worth stating precisely.
`.specs/features/platform-qualification-matrix/handoff.md:285,429` recorded the
Intel runner queue as an environmental limit while T75 was in progress.
`docs/qualification/t75-validation.md:50-52` supersedes that: "at this revision
it dequeued and passed on all five profiles, so no platform case is excused",
and `matrix.json` now records `darwin-x64` as `qualified`, evidenced by the
`macos-15-intel` runner passing all five exact-head profiles at the T75
candidate. **There is no open macOS x64 coverage gap.** The remaining
`darwin-x64` limitation is L7 — live *activation*, not gate coverage.

**L16. T75 evidence signing is no longer blocked.**
`.specs/features/t75-evidence-signing/handoff.md:5` still reads
`status: blocked`, but `docs/qualification/t75-validation.md:66-73` records the
index as `signed: true` and verified outside the producing run. The handoff is
stale; the capability is evidenced. See L17.

### Traceability defects found while compiling this matrix

**L17. Feature handoff statuses contradict the qualification reports.** After
T76 recorded PASS, `.specs/features/t76-release-candidate/handoff.md:5` still
reads `status: in_progress` and its body still lists public-service publication
and release-key custody as open; `t76-release-materialization/handoff.md:26`,
`t76-artifact-inputs/handoff.md:34`, and `t76-supply-chain-evidence/handoff.md:25`
say similar; `t75-evidence-signing/handoff.md:5` reads `blocked`; and
`.specs/features/milestone-2-completion/handoff.md:17` still derives "T74
complete and T75 next". Only `t76-tuf-publication/handoff.md:5` reads
`complete`. This is not a promotion blocker, but a decision that cites these
handoffs uncritically will contradict itself. Recorded here so the T77 report
names the drift rather than inheriting it.

**L18. The `#58` canonical-JSON record is internally inconsistent.**
`.specs/features/canonical-json/handoff.md:17-20` and
`canonical-json-t4-completion/handoff.md:26-27` describe T4j and T4k as not
started, and `docs/canonical-json-compatibility.md:192` marks T4j "Deferred",
while `.specs/STATE.md:410-421` records T4j implemented and submitted. Resolve
before a decision cites #58 either way.

**L19. The public homepage still declares `installable: false`.**
`.specs/features/npx-launcher/handoff.md:296-303` records that
`apps/site/src/data/product.ts` still reads as pre-installer while `README.md`
and the documentation portal describe the published package, and that "That
divergence is recorded for the owner rather than resolved unilaterally".

### Not found in the repository

Two limitations that are often assumed have **no written record** in any
tracked file, and are therefore not asserted here:

- **"No external users" / single-adopter.** No tracked file states a
  user-adoption limitation. The nearest record, L1, is about review
  independence, not user base. If a 1.0 decision wants to weigh adoption, it
  must state it as a new fact, not cite this matrix.
- **An open macOS x64 coverage gap.** See L15 — the record says the opposite.

---

## 5. What this matrix does not establish

- **It is not a qualification report** and does not advance the chain. It has
  no `REPORT-CONTRACT.md` frontmatter for that reason, and `agent:check` does
  not count it.
- **It is not independently verified.** Its author is the same automation that
  authored much of the surface it describes. `RELEASE-DECISION-CONTRACT.md:79`
  puts verifier independence outside the artifact, and that applies here.
- **It does not re-execute the live evidence.** The live rows cite T75, T76,
  and the npx-launcher validation. Re-running them means repeating the operator
  procedure, not re-running a suite.
- **It does not close T77.** `RELEASE-DECISION-CONTRACT.md:84-97` lists five
  preconditions. This file supplies the enumeration T77 was missing and
  confirms precondition 3 (`T77 closure MET`). Preconditions 4 and 5 —
  `gate:release` at the candidate revision, and two reviewers distinct from the
  deciding human and the implementation author — remain open, and precondition
  5 is L1.
- **The requirement-to-journey column is a reading, not a derivation.** Section
  3 says exactly how far the mechanical derivation goes and where the editorial
  step begins.
