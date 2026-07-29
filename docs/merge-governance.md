# Main branch merge governance

`main` is an accountability boundary. Continuous integration reports test
results; it does not supply human acceptance or independent evidence review.

## Required approval

Every pull request to `main` requires one approving review after its latest
material push. An approver must be a repository collaborator who did not author
the implementation or push that latest material. An implementation author,
automation acting for that author, and CI are not independent reviewers.

Code-owner review is required for every pull request. The explicit ownership
map covers policy, effects, secret handling, evidence integrity, distribution,
schemas, qualification evidence, and workflow governance. A code-owner
approval satisfies the ruleset only when it is also independent under the
preceding paragraph.

## Required checks and merge method

The live `Protect main` ruleset requires strict `Quality gate`, `Site quality`,
and `CodeQL` checks, resolved review threads, linear history, and squash-only
merges. Force-pushes and branch deletion are blocked.

## Break-glass

There is no standing bypass actor. A genuine emergency requires a maintainer to
record the incident, scope, reason normal review cannot occur, and the exact
commit in a tracked GitHub issue before any temporary protection change. The
same issue must record the restoration of the ruleset and receive an
independent retrospective review. Break-glass is not a way to merge routine
agent or maintainer work.

## Live verification

The ruleset is read-only verifiable through:

```bash
gh api repos/accd/verchestra/rulesets/19738785
```

It must report one required approving review, stale-review dismissal,
last-push approval, code-owner review, no bypass actors, and the three strict
required checks named above.
