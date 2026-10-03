# Release Decision Contract

T77 (#18) ends in one artifact: a signed decision to promote or reject a
specific candidate as 1.0.0. This contract says what that artifact must
contain, and — following `REPORT-CONTRACT.md`'s example — is explicit about
what it cannot enforce.

A decision file lives at `docs/qualification/release-decision-<version>.md`.
A version's decisions are numbered **rounds**. Round 1 is
`release-decision-<version>.md`. A later round *n* is
`release-decision-<version>.round-<n>.md` and supersedes round *n − 1*. There
is at most one file per version and round. A later round may follow only a
reject, because a promote is final. No round is ever edited or deleted: each
later round binds to the exact bytes of the round before it. The version's
effective decision is its highest round whose whole chain of earlier rounds is
valid. A rejection is as valid an outcome as a promotion and is recorded the
same way; the contract exists so that neither can be asserted without the
evidence it names.

## Required frontmatter

```yaml
---
schema: verchestra-release-decision/v1
version: 1.0.0
decision: promote            # promote | reject
candidateRevision: <40-character commit id reachable from main>
candidateReleaseDigest: sha256:<64 hex>
requirementsRegister: <sha256 of docs/requirements-register.json at candidateRevision>
requirementsClosed: 93 of 93 requirements evidenced
qualificationReports: T69, T70, T71, T72, T73, T74, T75, T76
gates: pnpm gate:release
gateResults: pass
gateRevision: <must equal candidateRevision>
skipped: 0
todo: 0
survivingMutants: 0
operationalReviewer: <GitHub identity, not the implementation author>
securityReviewer: <GitHub identity, not the implementation author>
decidedBy: <GitHub identity of the accountable human>
decidedAt: <RFC 3339 UTC timestamp>
signature: <detached signature over the canonical decision body>
publicKeyRef: <reference resolvable to the verifying key>
reviewedIn: https://github.com/accd/verchestra/pull/<number>
---
```

### Additional frontmatter for a later round

Round 1 carries none of these fields. Round *n* ≥ 2 carries all three, in
addition to every field above:

```yaml
round: <n, the number in the filename>
supersedes: <release-decision-<version>.md for round 2; release-decision-<version>.round-<n-1>.md after that>
supersedesDigest: sha256:<64 hex of the superseded file's exact bytes>
```

The signature covers these fields like every other: the signed body is every
frontmatter field except `signature`, plus the sha256 of the Markdown body.
`supersedesDigest` is over the superseded file's bytes as committed, so editing
an earlier round in any way, even in a way its own signature does not see,
breaks the round after it.

## What fails closed

Every row applies to every round. The rows after `reviewedIn` are the ones
rounds add.

| Condition | Why |
| --- | --- |
| Missing or malformed frontmatter | An empty or placeholder decision must never promote a version. |
| `candidateRevision` not reachable from `main` | A decision must bind to trusted history, checked with `git merge-base --is-ancestor`, not to a local object. |
| `gateRevision` ≠ `candidateRevision` | Gate evidence from another revision is not evidence for this candidate. |
| A gate other than `gate:release` | 1.0 is the one decision where the narrowest gate is not a choice. |
| `gateResults` other than `pass` | Partial gate coverage is not a pass. |
| `skipped`, `todo`, or `survivingMutants` ≠ 0 | Skipped work is unproven work, and a surviving mutant is a test that proves nothing. |
| `requirementsClosed` not in the exact form `<n> of <n> requirements evidenced` | `5 open, 93 total` reads as complete to a parser that looks for two numbers. |
| `requirementsRegister` ≠ the digest of the register at `candidateRevision` | The denominator must be the reviewed register, not a number retyped into the decision. |
| A missing qualification report for any task in the chain | `agent:check` derives the chain; a decision cannot skip a link. |
| `operationalReviewer` or `securityReviewer` equal to `decidedBy` | One person cannot be their own second reviewer. |
| An unresolvable `publicKeyRef`, or a signature that does not verify | An unverifiable signature is worse than none: it reads as accountability while carrying none. |
| No `reviewedIn` pull request URL | The decision has to point at where it was reviewed. |
| A file named `release-decision-*.md` outside the round-1 or `.round-<n>` convention, or a round suffix below 2 or with a leading zero | A decision that is not read must not sit on disk while an earlier round stays in effect. |
| A frontmatter `round` that disagrees with the filename's round | The round is part of the file's identity, as the version is. |
| A round 1 file that carries `round`, `supersedes`, or `supersedesDigest` | Round 1 supersedes nothing; the unsuffixed name is round 1. |
| Two files for the same version and round, or a gap in a version's rounds (a round whose round *n − 1* is missing) | Each version has one linear history; a round with no predecessor binds to nothing. |
| Any round after a `promote` | A promote is final. |
| `supersedes` naming anything other than the immediately previous round | A later round cannot skip a round it did not supersede. |
| `supersedesDigest` that does not match the superseded file's current bytes | Earlier rounds are immutable; an edited hold must break the round that relied on it. |
| `decidedAt` not strictly later than the previous round's | A later round is decided later. |
| `candidateRevision` equal to the previous round's, or one the previous round's candidate is not an ancestor of (`git merge-base --is-ancestor`) | A later round decides on a fresh candidate built on the one before, not on the same evidence or on older history. |

`requirementsClosed` is checkable because `scripts/requirements-trace.mjs`
computes it: closure requires an empty `openGaps` in the register, so a
requirement that no test asserts and no report traces blocks promotion by
construction rather than by anyone remembering to look.

## What this contract does *not* enforce

**That the reviewers actually reviewed, and that the decision is sound.**

`operationalReviewer`, `securityReviewer`, and `decidedBy` are identities the
document names. The contract can prove they are three distinct identities and
that the signature verifies against a key the repository can resolve. It
cannot prove a human read the evidence, and it must not pretend to: a field
named `reviewApproved: true` would read as enforcement while enforcing
nothing, which is the failure `REPORT-CONTRACT.md` already names.

Accountability is carried by the same mechanism as everywhere else in this
repository — the `Protect main` ruleset on the pull request named in
`reviewedIn`, and the signature over the decision body. See
`docs/merge-governance.md`.

**Independence of the final verifier** is likewise external. The verifier who
authors the T77 report must not have authored the implementation under
review. `reviewedIn` records where that can be checked; this file does not
assert it.

**That a later round answered the earlier one.** Rounds do not make a promote
easier. Every round needs its own operational and security reviewers, its own
deciding human, its own `gate:release` pass at its own candidate, and its own
signature; nothing is inherited from the round it supersedes. A later round
cannot rewrite why an earlier one rejected: the earlier file stays on disk,
byte for byte, and its reasons stay its reasons. Whether the later round's
reviewers actually addressed those reasons is a human judgement made in the
pull request named in `reviewedIn`, not something this contract can check.
Removing the most recent round leaves no gap on disk, so that removal is
visible only in Git history and review, like any other deletion.

## Preconditions for authoring a decision

A decision cannot honestly be written before all of the following hold. They
apply to every round, not only the first. None of them is a formality, and
each is checkable:

1. `pnpm agent:context` derives T76 complete — which requires
   `docs/qualification/t75-validation.md` and `t76-validation.md` to exist and
   satisfy `REPORT-CONTRACT.md`.
2. A candidate release exists: the T76 candidate build has been dispatched and
   its five-target closure collected.
3. `node scripts/requirements-trace.mjs` reports `T77 closure MET`.
4. `pnpm gate:release` passes at the candidate revision.
5. An operational reviewer and a security reviewer, both distinct from the
   deciding human and from the implementation author, have reviewed.

*Historical, kept as written when this contract was introduced:* As of this
contract's introduction none of 1–3 holds. That is the honest state, and it is
why this file describes a decision rather than recording one. Round 1 for
1.0.0 has since been recorded in `release-decision-1.0.0.md`.
