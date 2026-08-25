# Release Decision Contract

T77 (#18) ends in one artifact: a signed decision to promote or reject a
specific candidate as 1.0.0. This contract says what that artifact must
contain, and — following `REPORT-CONTRACT.md`'s example — is explicit about
what it cannot enforce.

A decision file lives at `docs/qualification/release-decision-<version>.md`.
There is at most one per version. A rejection is as valid an outcome as a
promotion and is recorded the same way; the contract exists so that neither
can be asserted without the evidence it names.

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

## What fails closed

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

## Preconditions for authoring a decision

A decision cannot honestly be written before all of the following hold. None
of them is a formality, and each is checkable:

1. `pnpm agent:context` derives T76 complete — which requires
   `docs/qualification/t75-validation.md` and `t76-validation.md` to exist and
   satisfy `REPORT-CONTRACT.md`.
2. A candidate release exists: the T76 candidate build has been dispatched and
   its five-target closure collected.
3. `node scripts/requirements-trace.mjs` reports `T77 closure MET`.
4. `pnpm gate:release` passes at the candidate revision.
5. An operational reviewer and a security reviewer, both distinct from the
   deciding human and from the implementation author, have reviewed.

As of this contract's introduction none of 1–3 holds. That is the honest
state, and it is why this file describes a decision rather than recording one.
