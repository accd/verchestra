# Dependency Pull Request Backlog Specification

## Problem Statement

Seven Dependabot pull requests are open against `main`. Some are stale, one
contains an incorrect action pin, two split one qualified Pi boundary, and two
contradict the exact Node 24.14.0 qualification.

## Goals

- Resolve every currently open pull request with a merge or a documented safe
  closure.
- Keep protected `main` green after every merge.
- Preserve Node 24.14.0, T68 complete, and T69 next.
- Prevent Dependabot from recreating the same invalid or split proposals.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Node 26 qualification | It changes the T01 runtime baseline. |
| `tuf-js` 6 qualification | It requires Node 24.15 or newer and a new T67 qualification. |
| Product task T69 | Dependency maintenance does not advance the product roadmap. |

## Assumptions and Decisions

- “Resolve all PRs” means merge compatible work and close incompatible or
  superseded work with exact evidence.
- Human approval is supplied by the request to implement this approved plan;
  repository gates and independent verification remain mandatory.
- Squash merge is the only repository-supported merge method.
- No assertion, Lighthouse threshold, workflow permission, or qualification
  boundary may be weakened.

## Acceptance Criteria

1. **DPR-01** — WHEN PR #3 is corrected THEN both CI jobs SHALL use the exact
   `pnpm/action-setup` v6.0.8 commit and matching comments, and required checks
   SHALL pass before merge.
2. **DPR-02** — WHEN PR #2 is corrected THEN every tracked
   `actions/setup-node` occurrence SHALL use the exact v7.0.0 commit while
   retaining Node 24.14.0 and existing permissions.
3. **DPR-03** — WHEN PR #4 is refreshed THEN `typescript-eslint` SHALL be
   8.65.0 with a frozen-installable lockfile and green required checks.
4. **DPR-04** — WHEN the Pi update is integrated THEN
   `pi-agent-core` and `pi-ai` SHALL both be 0.82.1, the lockfile SHALL contain
   one qualified Pi version, and all twelve Pi qualification outcomes SHALL
   pass.
5. **DPR-05** — WHEN Dependabot policy is updated THEN future Pi updates SHALL
   be grouped and major `tuf-js` and `@types/node` proposals SHALL be ignored
   while the Node 24.14.0 baseline remains active.
6. **DPR-06** — WHEN PRs #6, #7, and #8 are closed THEN each SHALL contain a
   concrete incompatibility or supersession reason and a future unblock
   condition.
7. **DPR-07** — WHEN the backlog is complete THEN GitHub SHALL report zero open
   pull requests, protected `main` SHALL equal the last merged commit, required
   CI and Pages deployment SHALL be successful, and the public site SHALL
   return HTTP 200.
8. **DPR-08** — WHEN Lighthouse evaluates the consolidated update THEN the
   performance score SHALL meet the existing 0.95 minimum without threshold
   changes; a single isolated miss may be rerun, but two clean consecutive
   misses SHALL stop the merge for diagnosis.

## Failure and Ordering Rules

- Merge one PR at a time and wait for the resulting `main` checks before
  continuing.
- Refresh each remaining branch after the preceding merge.
- If a Dependabot branch rejects maintainer commits, replace it with a
  same-scope maintainer PR and close the original as superseded.
- A failed required check blocks merge; a failed check unrelated to the diff
  is diagnosed and rerun only with recorded evidence.
- Authentication, production data, provider profiles, and local paths never
  enter tracked output.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| DPR-01 | T2 | Pending |
| DPR-02 | T3 | Pending |
| DPR-03 | T4 | Pending |
| DPR-04, DPR-05, DPR-08 | T5 | Pending |
| DPR-06 | T6 | Pending |
| DPR-07 | T7 | Pending |

## Success Criteria

- Zero open pull requests.
- Every merged change passed required PR and post-merge checks.
- Invalid proposals are closed rather than forced through qualification.
- Independent validation kills the defined discrimination mutations.
