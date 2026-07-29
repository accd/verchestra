# CI gate selection rescue

## Objective

Make CI select sufficient verification from the actual candidate range, and run
each selected verification stage at most once.

## Acceptance criteria

1. Qualification reports, workflow files, and Dependabot configuration select
   both `gate:full` and `gate:release`, regardless of self-declared metadata.
2. Pull requests compare `pull_request.base.sha`; pushes compare
   `github.event.before`. An unavailable or all-zero base uses a conservative,
   recorded fallback rather than a weaker range.
3. The checkout contains the selected base commit.
4. Evidence records the candidate SHA, base, selection mode, and fallback
   reason without listing repository paths.
5. The workflow executes the union of selected gate stages once each, in
   deterministic order.
