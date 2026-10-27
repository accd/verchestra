---
schema: verchestra-feature-handoff/v1
feature: provider-install-integrity
issue: 596
status: complete
branch: main
baseRevision: 5b131e97463dbf581fe1eb6d40ecd15739dd3d31
lastCompletedTask: T5
nextTask: "None in this feature. #596 stays open for item 3, npm provenance, which the owner holds."
lastGate: "PR #621 merged by rebase through the maintainer bypass at 2026-10-27T14:57:31Z (main e5389cd, tree equal to the branch rebased onto d4756a6 and tested locally) with Quality gate, Site quality and CodeQL passing on the head 406b42b in run 40505833811; platform-matrix run 40506131245 installed from the lockfile on all five legs; no independent review, so the implementing agent's local pass and mutation sensors in validation.md are the record"
updatedAt: 2026-10-27T15:20:00Z
---

# Evidence

T1 to T4 are recorded in `validation.md`. The four workflows install the
provider CLIs with `npm ci` from `.github/qualified-providers/`, whose lockfile
pins the sha512 of all 16 packages. A platform package npm skips after a failed
integrity check fails the step by name. Only Claude Code's postinstall runs,
and the install reaches later steps through `GITHUB_PATH`.

T5 is the merge of #621 with every required check green on its exact head. The
fleet run on that head installed from the lockfile on all five legs, and on
both Linux legs the driver qualification passed against the install.

# Next exact action

None in this feature. #596 item 3, npm provenance for the `verchestra`
package, stays with the owner.
