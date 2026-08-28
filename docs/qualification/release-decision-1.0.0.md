---
schema: verchestra-release-decision/v1
version: 1.0.0
decision: reject
candidateRevision: 3d363f782bad40e5c5be8252e6626216b4f60248
candidateReleaseDigest: sha256:0572d5d7832af2981b042861ed28cebd2870d5cc2a3bcb2be252866755989f63
requirementsRegister: e81e066ad0c1bf30f90e150f57502ea17f036edbb3cecf1e7c5a437adbd54907
requirementsClosed: 93 of 93 requirements evidenced
qualificationReports: T69, T70, T71, T72, T73, T74, T75, T76, T77
gates: pnpm gate:release
gateResults: pass
gateRevision: 3d363f782bad40e5c5be8252e6626216b4f60248
skipped: 0
todo: 0
survivingMutants: 0
operationalReviewer: MiguelCorre
securityReviewer: brunomjanuario
decidedBy: accd
decidedAt: 2026-08-28T19:14:48Z
signature: 98gvdNDijpl3uDFp5xwwmsUAtER_ev2GwHKFGViGiW3Y_uf84ft3xrYcSYCNngv9HMMQeO8QnY-2nm6VqDiLDg
publicKeyRef: docs/qualification/trust/release-decision-public-key.json
reviewedIn: https://github.com/accd/verchestra/pull/397
---

# 1.0.0 release decision: reject (a recorded hold)

This records a **hold**. The candidate `3d363f782bad` is fit to keep operating as
`0.0.0-qualification`; it is not fit to promote to `1.0.0`. A rejection is as
valid an outcome as a promotion and is recorded the same way
(`RELEASE-DECISION-CONTRACT.md`).

The reasons below are **the two reviewers' own**, quoted and attributed, not the
deciding session's. Both reviewers independently reached `ENDORSE HOLD`.

## The operational review — MiguelCorre, ENDORSE HOLD

Recorded on #18. "The evidence supports operating only as `0.0.0-qualification`;
it does not support promotion to 1.0." Ranked reasons, as given:

1. **Published-package defect (#370).** "The published package still fails when
   `self-test` runs from the default Windows home directory… It must be fixed and
   republished before 1.0."
2. **Live activation covers only 2/5 targets.** "`win32-x64` and `linux-x64` were
   activated live. The other three targets have deterministic gate coverage, but
   no live activation record."
3. **No live update/rollback or disaster-recovery run.** "The relevant tests
   exist and pass, but they do not replace live operational exercises against the
   published endpoint."
4. **Single-operator custody.** "Keeping both signing keys and the storage
   endpoint under one operator is not acceptable for 1.0."
5. **`doctor` cannot reach `PASS`.** "`releaseDigest` remains protocol-null. I
   consider this a functional blocker for a 1.0 promise of operational
   diagnostics."

He would escalate limitations **L5, L7, L8, and L6** from "qualifying" to
blocking for 1.0.

## The security review — brunomjanuario, ENDORSE HOLD

Recorded on #18, performed against `3d1a1f8` (a clean worktree tracking main),
verified by opening the file or running the command. "The trust boundaries hold
for what they actually claim. They are not sufficient for a 1.0 promote, and the
repository says so itself (`acceptance-matrix.md` L8)." Findings, ranked:

- **F1 — No TUF role separation; the release trust model is effectively
  single-key** (High for promote, tolerable at hold). "Collapsing them means
  compromise of the one signing key is immediately full root compromise, with no
  containment and no recovery path… the single strongest technical reason 1.0
  should not promote today."
- **F2 — One `expires` for every role collapses the freeze-attack defense**
  (Medium).
- **F3 — The committed release anchor is declaratory, never bound** (Medium).
- **F4 — `gate:security` and `gate:release` are not hermetic** (Medium). "‘The
  release gate passes’ is not reproducible by an independent reviewer whose
  machine has different provider CLIs installed."
- **F5 — The accountability backstop carries a permanent bypass** (Low,
  structural). "The three-distinct-identities rule is therefore procedural, not
  enforced… the owner should ratify it consciously rather than inherit it."

His conclusion: "F1 and F3 together mean the release trust model is one key, held
by one operator, anchored to a public reference nothing checks. That is a
defensible posture for 0.0.0-qualification. It is not a 1.0 supply-chain
guarantee." He also states the signature is checked for presence, not verified,
and asks for the §4.1 signed-bytes definition to be ratified with the validator
verifying against it before any promote.

## Independent re-verification (both reviewers, on a clean clone of the candidate)

Each reviewer re-performed their own review on a fresh clone checked out at
`3d363f782bad`, verifying by opening the file or running the command.

**Security (brunomjanuario).** "I have independently re-performed the security
review of candidate `3d363f782bad` on a clean clone and adopt these conclusions
as my own accountable review. ENDORSE HOLD." Verdict: "The boundaries hold for
exactly what they narrowly claim… yet they are insufficient to promote 1.0: the
TUF trust model is a flat single-key wrapper (F1/F2), the declared release
identity is unwired (F3), the mandated release gate is not reproducible
independent of machine state (F4), and authority separation is procedural for the
sole maintainer (F5). Nothing is fraudulent or affirmatively unsafe, so this is a
HOLD, not a reject. HOLD is correct."

**Operational (MiguelCorre).** Confirmed all five reasons at file/line/code and
concluded: "Every one of your five reasons still holds; none is stale." He added
two findings the deciding session had wrong, both incorporated below.

## Two corrections the operational re-verification supplied

- **The candidate carries no T77 report, by design.** `t77-validation.md` does
  **not** exist in a checkout of `3d363f782bad`. T77 does not end in a
  `REPORT-CONTRACT.md` report; per the contract it ends in this decision file.
  T77's "closure" at the candidate is the requirements trace and the acceptance
  matrix, both of which the reviewer re-verified. (An earlier reviewer prompt
  pointed at a report to read at the candidate; there was nothing to read, and
  that changes no part of the verdict.)
- **Precondition 4's evidence is a post-candidate tracked artifact, and this is
  expected.** No tracked file *inside the candidate checkout* binds
  `gate:release` to `3d363f782bad`. The artifact that binds it is
  `docs/qualification/t77-validation.md` **at HEAD** — `revision:` and
  `gateRevision:` both `3d363f782bad`, citing candidate build run
  **32967293127** (five target legs, five gate profiles each). The 232-test
  acceptance record binds `42f2f184`. A report about a candidate is written after
  the candidate, so the binding evidence living at HEAD rather than in the
  candidate's own tree is the normal shape, not a gap. The frontmatter of this
  decision uses that same run and revision.

## Why reject is the only honest verdict now

Two reasons are structural and would force a hold regardless of the rest:

1. **No independent verifier or second reviewer is obtainable by configuration**
   (matrix L1; `docs/merge-governance.md` "no configuration produces one"). The
   contract requires an operational and a security reviewer distinct from the
   deciding human and the implementation author. Miguel and bruno's reviews, and
   their adoptions, are what supply that today — but it remains an organisational
   property, not a repository one, and bruno's own account cannot self-attest
   (see §"Conscious ratification").
2. **`doctor` cannot report `PASS` on a real machine.** The circular-`releaseDigest`
   half of Miguel's reason 5 is resolved (the probe now reads the activation
   record); the remaining half is a missing production secret backend, tracked as
   [#379](https://github.com/accd/verchestra/issues/379). Until it ships, a user's
   `doctor` is honestly `BLOCKED`.

Everything else the reviewers list is disclosable rather than disqualifying, and
would belong in a promotion's limitations section once these clear.

## Conscious ratification (F5)

The deciding human consciously ratifies, rather than inherits, the governance
property bruno's F5 names: the `Protect main` ruleset carries one permanent
bypass actor — the `Repository admin` role, always allowed
(`docs/merge-governance.md:36-39`). The identity that signs as `decidedBy` can
bypass the control designated to carry what the decision validator cannot verify,
so the three-distinct-identities rule is procedural for this decision. This is
accepted for a **hold** and is itself a reason a promote cannot follow until a
second human custodian exists (matrix L8; the second custodian is out of scope
and only the owner can resolve it).

## Corrections to the record (evidence integrity)

- **The "six fail-closed modes table" never existed.** bruno checked #17
  directly: "Issue #17 has 18 comments; zero contain a single Markdown table row
  and zero contain a single `VES_` code." The real acceptance artifact is the
  **four-criterion** table in `docs/qualification/t76-validation.md:75-82`, whose
  cited suites he ran and passed. No six-mode table is claimed here.
- **#370 was republished, but is not treated as resolved.** The source fix is in
  the candidate; the registry has since drifted to `0.0.0-qualification.2`
  (published the same day), which is still a pre-1.0 build, not `1.0.0`. Both
  reviewers still record the published-package defect, so this decision does
  **not** treat L5 as resolved — it closes only when a fixed `1.0`-intent build is
  republished (the `.3` republication).
- **Earlier closing comments were mangled to "@-"** on #17 and #18 (a mobile
  client). The cited evidence therefore lives in git — this file and
  `acceptance-matrix.md` — not in comments, per bruno's point that a table cited
  from a comment is not reviewable.

## What clears each reason (the path to a promote round)

The promote-readiness work on #18 closes the reviewers' technical findings, each
reviewed before merge (F5): F3 [#377], F4 [#378], F1+F2 [#383], the `doctor`
native-asset half [#380], and the live-activation matrix [#381] — all now on
`main`. The matrix raises live activation from 2/5 to **5/5** and adds the first
live disaster-recovery and self-test-smoke runs on all five targets, but it does
**not** fully close L7: the live update/rollback leg is still open. That leg is
blocked by a release-process defect, not an unactivatable package — both
`0.0.0-qualification` and `.2` activate cleanly from a fresh state on all five
targets, but they were published with the same TUF `metadataVersion`, so
activating one over the other's cached metadata fails `VES_TUF_SOURCE_HTTP`
[#387]; it closes when the `.3` republication ships with an incremented
`metadataVersion`. Open, tracked: the doctor secret backend [#379], the timestamp
refresh routine [#382], the `.3` republication [#387], and — organisational,
owner-only — a second human custodian and reviewer (L1/L8). These land after this
candidate, so a future round decides on a fresh candidate with its own decision
file; they do not make `3d363f782bad` promotable.

## Provenance of this record

Both reviewers re-performed their reviews independently and adopted the hold as
their own accountable review (quoted above); their reviews are recorded on #18.
This file is signed by the owner as `decidedBy` under `publicKeyRef`, over the
canonical projection of its own frontmatter and body (`prepared-decision.md`
§4.1, ratified as AD-033 and verified by `scripts/agent-readiness.mjs`). Recording
this hold is the T77 acceptance decision (#18); the candidate continues to operate
as `0.0.0-qualification`, and a future promote round decides on a fresh candidate
with its own decision file.
