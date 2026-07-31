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

That requirement is not satisfiable for the maintainer's own pull requests, and
this document says so rather than implying a control that does not operate.
`.github/CODEOWNERS` names one owner, the repository has one collaborator, and
GitHub does not permit approving your own pull request. For a pull request the
maintainer authored there is therefore no independent code owner to ask, and no
configuration produces one. Independent review remains required, and remains
achievable, for every pull request the maintainer did not author — including
contributions from forks.

## Required checks and merge method

The live `Protect main` ruleset requires strict `Quality gate`, `Site quality`,
and `CodeQL` checks, resolved review threads, linear history, and squash-only
merges. Force-pushes and branch deletion are blocked.

## Maintainer bypass (logged)

Because the preceding requirement cannot be met by the maintainer's own work,
the ruleset carries one permanent bypass actor: the `Repository admin` role,
always allowed. It exists so that routine maintainer work has an executable
merge path instead of an improvised one, and its scope is deliberately narrow.

A maintainer merge through the bypass is legitimate only when all of the
following hold:

- the maintainer authored the pull request;
- every required check is green on the current head, not on an earlier push;
- every review thread is resolved;
- the merge is a squash, as the ruleset requires of everyone;
- the pull request body states that it was merged by maintainer bypass.

The bypass is not silent. GitHub records it in the repository audit log and on
the pull request timeline, so every use is attributable after the fact.

Two kinds of change stay outside it, because they decide who may approve and
what is enforced, and a control that can relax itself is not a control:

- `.github/CODEOWNERS` and the `Protect main` ruleset itself;
- any change under `.github/workflows/` that **reduces** what is enforced —
  removing a gate stage, narrowing a required check, or weakening a scan. A
  workflow change that preserves or strengthens enforcement is ordinary work,
  and its pull request body must say which of the three it does, so a reader can
  check the claim rather than infer it.

Those go through break-glass below.

## Break-glass

Break-glass is a different thing from the maintainer bypass above. That bypass
is a standing, audited actor and changes nothing about the ruleset; break-glass
is a temporary change to the protection itself. A genuine emergency requires a maintainer to
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
last-push approval, code-owner review, squash-only merges, the three strict
required checks named above, and exactly one bypass actor:

```bash
gh api repos/accd/verchestra/rulesets/19738785 --jq '.bypass_actors'
[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]
```

`actor_id` 5 is the `Repository admin` role. A second bypass actor, or a bypass
of any other type, is a governance change and belongs in a tracked issue before
it is applied.
