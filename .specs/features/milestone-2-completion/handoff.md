---
schema: verchestra-feature-handoff/v1
feature: milestone-2-completion
issue: null
status: blocked
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: null
nextTask: "Blocked: M2C-04 (an owner-designated independent verifier) is unmet and the signed 1.0.0 decision is a hold. On 2026-10-02 the owner named no second accountable human, so #408 is closed as not planned and no promote round can open (docs/release-custody.md). If the owner later names one, a fresh promotion round (new candidate, T77 rerun, own decision file, with #382/#387/#379/#405/#406) decides 1.0; P7 (#234, #235, #236) stays post-1.0."
lastGate: "agent:context at 20071a7 derives T77 complete and the chain fully verified; agent:check PASS"
updatedAt: 2026-10-02T11:00:00Z
---
# Current state (reconciled 2026-09-29, #407)

`agent:context` at `20071a78eb5b96b9de63e5e9c863b6997643c767` derives T77
complete, with the declared qualification chain fully verified. The
"T74 complete and T75 next" state recorded below is historical. This drift is
acceptance-matrix L17. The P0 to P7 rows of `tasks.md`, measured against
merged evidence:

| Task | State | Evidence |
| --- | --- | --- |
| P0 | Done | Programme reconciliation commits `dc482e2`, `71ab3a5`, `8f2d05d`. |
| P1 (#58) | Done; #58 closed | T4j `b738b04`, T4k `44c7a85`, T4i `190e06f`/`e469dbd`. One latent test defect (T21) is tracked in `canonical-json-t4-completion`. |
| P2 (#207) | Implementation done; #207 closed | PRs #302/#306. T22's fleet doctor evidence is not recorded; see `deep-doctor-live-probes`. |
| P3 (#294) | Done; #294 closed | Public reference `84ae20a`, signed attestation `11f9318`, verified outside the producing run (`docs/qualification/t75-validation.md:65-73`). |
| P4 (#16, T75) | Done; #16 closed | `docs/qualification/t75-validation.md` (`3365a47`, reviewed in PR #354). |
| P5 (#17, #36, T76) | Done; #17 and #36 closed | `docs/qualification/t76-validation.md` (`aa59ba7`, `5514322`, reviewed in PR #369); npm `verchestra@0.0.0-qualification`. |
| P6 (#18, T77) | Decided: signed reject, a recorded hold; #18 closed | `docs/qualification/t77-validation.md` (`bee42fa`, `9722d03`); `docs/qualification/release-decision-1.0.0.md` (`62ccde4`, PR #397). |
| P7 (#234, #235, #236) | Not started; all three open | Depends on "P6 PASS". The decision was a hold, so these stay post-1.0. |

Two requirements of `spec.md` are **not** met, and this handoff does not claim
them:

- **M2C-04.** No T75, T76, or T77 report was authored by an independent
  verifier. Each report says so: `t75-validation.md:23-32` and
  `t76-validation.md:33-44`. Acceptance-matrix L1 records that no configuration
  can produce one. Reports already merged cannot become independent after the
  fact. A fresh promotion round needs #408.
- **M2C-07.** #234, #235, and #236 are open, so the open-issue list is not
  empty.

# Next exact action

None while the owner is the only accountable human. #408, the independent
human custody and review model, was closed as not planned on 2026-10-02: the
owner named no second custodian (`docs/release-custody.md`). The
merge-protocol rule in `tasks.md` (item 4) keeps this handoff `blocked`. If
the owner later names one, the custody work resumes from O1, and a promotion
round then starts from a fresh candidate. The prerequisites for that round
are:

- #382: TUF timestamp/snapshot refresh.
- #387 and #393: the live update and rollback legs.
- #379: doctor reaching `PASS`.
- #405: the governed task path through the installed CLI.
- #406: the supervised real-task pilot.

The round records its own T77 run and its own decision file. P7 starts only
after a promote.

# Blockers

- **No independent human (#408, closed as not planned).** M2C-04 needs an
  owner-designated independent verifier. None exists, the owner named none on
  2026-10-02, and the maintainer cannot create one by configuration
  (acceptance-matrix L1).
- **The signed 1.0.0 decision is a hold.** P7 depends on "P6 PASS".

# Historical state (2026-08-25, superseded)



The canonical main head is `56ac0ce96d793517964b5828edd228bef4e1086b`.
`agent:context` derives T74 complete and T75 next. #16 and #36 remain open
because their original acceptance criteria are still incomplete.

The operating plan is the eight-task table in `tasks.md`. #207 is closed and
its live-probe implementation is on main. P1/#58 has green PR #320, P3/#294
has green guard PR #321, and the T76 implementation stack is #316–#322. These
branches are not qualification evidence until the required human review and
rebase merges occur. P3 still cannot finish until the owner provisions a
protected GitHub Actions signing secret and matching public reference; the
secret itself must never be accessed or recorded.

## Next exact action (historical)

Review the open PRs with the owner-designated independent verifier, merge only
after the ruleset approval, then run the exact-candidate T75 signing workflow
with the owner-provisioned identity. The independent verifier must
independently author `docs/qualification/t75-validation.md`.
Only after T75 is accepted may T76 and then T77 advance.

## Blockers (historical)

Human review is required for the open implementation PRs. T75 signing is also
blocked by owner-only secret/PublicKeyRef provisioning, and T75 completion is
blocked by the independent report. npm trusted publishing and the final T77
decision are later, explicit owner/human prerequisites.

## Files intentionally unchanged (historical)

Product code, generated contracts, qualification reports, secrets, npm
configuration, and release metadata remain unchanged by this handoff update.
