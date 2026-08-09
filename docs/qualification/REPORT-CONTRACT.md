# Qualification Report Contract

A file named `tNN-validation.md` is not evidence, and neither is a well-formed
string inside one. `agent:check` counts a report toward the qualification chain
only when the claims it makes can be checked against something the report author
does not control.

Reports for T01–T68 predate this contract. They are immutable evidence and are
admitted by declaration, not rewritten.

## Required frontmatter

Every report for a task after T68 begins with:

```yaml
---
schema: verchestra-qualification-report/v1
task: T68a
revision: <40-character implementation commit id reachable from the trusted qualification target>
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: <must equal revision>
criteriaEvidence: 7 of 7 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 5 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/<number>
---
```

The human-readable body follows unchanged: scope with case counts and the
required minimum, the deterministic gates table, the spec-anchored adequacy
matrix, the discrimination sensor table, non-shallow checks, and the verdict.

## What fails closed

| Condition | Why |
| --- | --- |
| Missing or malformed frontmatter | An empty or placeholder file must never advance qualification. |
| A revision this repository does not contain | A well-formed but invented SHA is the obvious forgery; existence is checked with `git cat-file`, which the report cannot fake. |
| A revision reachable only through a side ref | A readable object is not necessarily portable evidence. Git must prove `git merge-base --is-ancestor <revision> <trusted-target>`, so reports bind to trusted implementation history rather than arbitrary local objects. |
| `gateRevision` ≠ `revision` | Gate evidence copied from an earlier revision is not evidence for this one. |
| A gate outside the declared set | Any package script would let `format:check` stand in for a security surface. Only `gate:quick`, `gate:full`, `gate:build`, `gate:security`, and `gate:release` count. |
| No `gate:quick`, or no substantive gate | `gate:quick` alone proves formatting and unit behavior. A qualification claim also needs a gate that runs contract, architecture, security, or release stages. |
| Any `gateResults` entry other than `pass` | Partial gate coverage is not a pass. |
| `criteriaEvidence` not in the exact form `<n> of <n> acceptance criteria proven` | `7 missing, 7 total` reads as complete to any parser that just looks for two numbers. |
| `discriminationSensor` not in the exact form `<n> killed, <n> survived` | `5 survived, 0 killed` reads as five kills to the same parser. |
| Zero killed, or any survivor | A sensor that kills nothing proves nothing. |
| `skipped` or `todo` ≠ `0` | Skipped work is unproven work. |
| No `reviewedIn` pull request URL | The evidence has to point at where it was reviewed. |

## What this contract does *not* enforce

**Independent verification and human review are not fields here, deliberately.**

An earlier version of this contract had `verifierRole: independent` and
`humanReview: approved`. Both are strings the report author writes. A report
claiming `verifier: author` alongside `verifierRole: independent` passed, which
is worse than not checking at all: it reads as enforcement while enforcing
nothing.

Those properties can only be established outside the file:

- **Independence** comes from a reviewer who is not the implementation author.
  `reviewedIn` records where to verify that; it does not assert the verdict.
- **Human review** comes from branch protection on the commit the report names.
  The `Protect main` ruleset requires one approving review, independent of the
  author, on every pull request — with the logged maintainer-bypass exception
  for the maintainer's own pull requests. See `docs/merge-governance.md`. This
  contract file does not itself enforce that review; it records where the review
  happened (`reviewedIn`) so it can be verified.

So a report can satisfy every mechanical condition above without this file, on
its own, establishing accountability: independence and human review are carried
by the ruleset and `reviewedIn`, not by the frontmatter. The contract narrows
what can be claimed without evidence; the ruleset and the review it names supply
the accountability.

## Trusted target and report sequencing

For T68a and later, `agent:check` derives the trusted qualification target
from the Git checkout being validated (`HEAD`), never from report frontmatter.
Readiness callers validating another checkout may supply its already-trusted
implementation revision directly; a report field cannot select or relax that
target.

A report may bind to an earlier implementation commit that is an ancestor of
the target. It must not bind to its own future report commit or an object that
exists only through an unmerged side ref. Run required gates on the merged
implementation revision first, then add the report in a later documentation
commit while preserving that implementation SHA in both `revision` and
`gateRevision`.

## Verifying locally

```bash
pnpm agent:check
```

Failures name the task and the specific field, and never include machine-local
paths.
