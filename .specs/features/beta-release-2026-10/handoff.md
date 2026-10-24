---
schema: verchestra-feature-handoff/v1
feature: beta-release-2026-10
issue: null
status: verification
branch: feat/beta-release-2026-10
baseRevision: a5a9b105b5d92d5de652b54082aa3b5e30ecf01f
lastCompletedTask: T10
nextTask: "Owner review of feat/beta-release-2026-10, then push and a pull request whose CI (Quality gate, Site quality, CodeQL) runs the POSIX legs; move this handoff to complete after merge."
lastGate: "independent verification round 3 PASS at 85e6c1b (57/57 checks, every coverage member proven, every injected fault killed; validate_verification.py exit 0); gate:quick PASS"
updatedAt: 2026-10-24T19:30:00Z
---

# Scope

The repository changes an external beta tester needs, as `plan.md` (approved by the owner on
2026-10-24) states them and `checks.md` turns them into 57 checks with proofs. Task `Tn` is slice
`Sn` of `checks.md`; each was committed on its own by one builder.

Owner-held steps stay outside this change: pilot #406 attempt 3 on `.8`, the publication of `.9`
(npm 2FA, R2 upload, ledger sequence 9), its tags, GitHub Release and `beta` dist-tag, and the
closing comments on #569 once this change merges (#568 closes from the commit).

# Completed Evidence

T1-T10 (S1-S10) and three verification rounds. `verification.md` (round 3, independent
sub-agent, profile standard) proves 57/57 checks with `file:line` evidence, recomputes every
coverage row, and records 13 injected faults across the rounds, all killed in the final code
(round 1's surviving mutant against C4 was fixed by `73f8d8c` and killed in rounds 2 and 3).
`validate_verification.py` exits 0. On Windows x64 without Developer Mode: gate:quick PASS
(unit 3024, agent-readiness 373, census 13); e2e 316/316; fault 310/310; integration 1252/1274
and security 1361/1363, every failure being a file-link test that names Windows Developer Mode,
or the security test that fails because this host's temporary directory is inside the home
directory (untouched by this change). The site builds (135 pages, internal links valid).

# Context

`main` at `5a77a87` carried #583 (Cedar 4.14.0 as Dependabot generated it), which failed the
policy suites. The owner chose to revert it: #589 merged as `a5a9b10`, and this branch was
rebased onto it. Cedar 4.14 is recorded in #563.

For the owner: regenerating the lockfile moved the optional `ws` peer of the root Pi packages
from 8.21.3 to 8.22.0 (Pi stays 0.99.1; `qualify:pi` with pinned providers passes 26/26). It is
outside criterion 45 and named here under the driver-runtime rule (DSB-05).

# Next exact action

Owner review; on approval, push `feat/beta-release-2026-10` and open the pull request.
