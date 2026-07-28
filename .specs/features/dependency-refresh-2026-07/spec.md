# July 2026 Dependency Refresh Specification

## Problem statement

Four Dependabot pull requests were open against `main`: prettier 3.9.5 → 3.9.6
(#32), `opencode-ai` 1.17.18 → 1.18.7 (#30), `@opencode-ai/sdk` 1.17.18 →
1.18.7 (#31), and jose 6.2.3 → 6.2.4 (#29).

The two OpenCode proposals are the same defect the Pi runtime already hit:
Dependabot split one qualification unit into two pull requests. Merging either
alone installs a 1.18.7 / 1.17.18 pair that no qualification report describes,
and each alone fails `pnpm qualify:opencode`, which asserts the exact repo-local
version. `.github/dependabot.yml` groups `@earendil-works/pi-*` for exactly this
reason but has no equivalent OpenCode rule.

## Goals

- Resolve all four pull requests without weakening a qualification boundary.
- Keep OpenCode one coordinated qualification unit with a superseding report.
- Stop the split from recurring by extending the Dependabot grouping policy.
- Leave the supported OpenCode floor for users unchanged.

## Out of scope

| Exclusion                                        | Reason                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Raising `minimumVersion` above 1.17.18            | Narrowing which host versions users may run is a product decision, not a refresh.    |
| Advancing to OpenCode 1.18.9                      | Qualify what Dependabot proposed, so the change stays traceable to #30 and #31.      |
| Editing the original T05 qualification evidence   | Superseding reports preserve traceability, following the Pi 0.82.1 precedent.        |
| Product implementation or the roadmap chain       | This is maintenance after T68.                                                       |

## Requirements

| ID     | Requirement                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| DRF-01 | prettier SHALL be 3.9.6 and `format:check` SHALL pass with no file reformatted.                                                   |
| DRF-02 | `opencode-ai` and `@opencode-ai/sdk` SHALL both be 1.18.7 in the manifest and in every lockfile entry.                            |
| DRF-03 | All seventeen OpenCode boundary outcomes SHALL pass against the installed 1.18.7, recorded in a superseding qualification report. |
| DRF-04 | The supported floor SHALL stay 1.17.18 in the spike and in `packages/drivers`.                                                    |
| DRF-05 | `.github/dependabot.yml` SHALL group `opencode-ai` with `@opencode-ai/*`, asserted by a test.                                     |
| DRF-06 | Superseded pull requests SHALL be closed with a concrete reason and unblock condition.                                            |
| DRF-07 | jose SHALL be evaluated on its own, under `gate:security`, because it is a production cryptography dependency.                    |
| DRF-08 | When the batch is complete GitHub SHALL report zero open Dependabot pull requests and `main` SHALL be green.                      |

## Acceptance criteria

1. WHEN the coordinated OpenCode change is installed THEN `pnpm qualify:opencode`
   SHALL report 17 passed, 0 failed, 0 skipped.
2. WHEN the lockfile is inspected THEN exactly one OpenCode version SHALL appear
   for both packages.
3. WHEN a 1.17.18 host is probed THEN it SHALL still be accepted.
4. WHEN Dependabot next proposes an OpenCode update THEN it SHALL arrive as one
   grouped pull request.

## Safety and authority

Dependency upgrades require explicit human approval; it was given for this
batch. No assertion, Lighthouse threshold, workflow permission, or qualification
boundary may be weakened. Squash merge is the only supported merge method, and
human review remains mandatory before merge.

## Success criteria

All four pull requests resolved, `pnpm gate:full` and `pnpm test:qualification`
green, the superseding report tracked, and the grouping policy asserted by a
test rather than only documented.
