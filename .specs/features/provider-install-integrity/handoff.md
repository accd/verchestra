---
schema: verchestra-feature-handoff/v1
feature: provider-install-integrity
issue: 596
status: verification
branch: ci/596-provider-install-integrity
baseRevision: 5b131e97463dbf581fe1eb6d40ecd15739dd3d31
lastCompletedTask: T4
nextTask: "Read the required checks on the pull request head, including the Quality gate's install of the providers from the lockfile on Linux; on green, maintainer merge, then move this handoff to complete. #596 item 3 (npm provenance) stays open with the owner."
lastGate: "gate:quick PASS; tests/architecture 144 of 144; the ci.yml step and the pinned qualification stage on Windows; see validation.md"
updatedAt: 2026-10-27T13:30:00Z
---

# Evidence

T1 to T4 are recorded in `validation.md`. The four workflows install the
provider CLIs with `npm ci` from `.github/qualified-providers/`, whose lockfile
pins the sha512 of all 16 packages. A platform package npm skips after a failed
integrity check fails the step by name. Only Claude Code's postinstall runs,
and the install reaches later steps through `GITHUB_PATH`.

# Next exact action

Read the Quality gate on the pull request head: it runs the `ci.yml` install on
Linux. The macOS and Linux arm64 legs run the same step text only when
`platform-matrix.yml` or `t76-candidate-build.yml` is dispatched. Mark T5 and
move this handoff to `complete` after review and merge.
