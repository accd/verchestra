# Feature Specification — milestone-2-completion

## Problem statement

The previous programme plan was stale: T72–T74 are now qualified, #16 and #36
were closed before their original criteria were met, and `agent:context` still
advertised historical work as active. Ticket arithmetic must not replace
evidence or human release accountability.

## Goals

- Maintain one truthful, resumable plan for the ten open operating obligations.
- Close #16 only with a signed T75 evidence index and an independent report;
  close #17/#36 only with an independently verified T76 candidate; close #18
  only with a signed human T77 decision.
- Reach an empty GitHub open-issue list only after the three expressly
  post-1.0 obligations also meet their acceptance criteria.

## Requirements

| ID | Requirement |
| --- | --- |
| M2C-01 | The programme, GitHub milestone, active handoffs and `agent:context` state shall agree that T74 is complete and T75 is next. |
| M2C-02 | The ten open obligations shall have dependency-ordered work and exact evidence/gate expectations. |
| M2C-03 | #16 and #36 remain open until their original acceptance criteria, not a partial bridge or an unsigned index, are satisfied. |
| M2C-04 | Every T75/T76/T77 report shall be independently authored; MiguelCorre is the intended T75 verifier and no implementation author verifies their own surface. |
| M2C-05 | Automation shall observe the repository ruleset: rebase-only, required checks, code-owner and last-push approval, resolved threads, and no administrative bypass. |
| M2C-06 | Secret provisioning, npm trusted publishing, reviewer rejection, and the T77 signed decision are explicit blocking conditions; none may be fabricated or bypassed. |
| M2C-07 | The final state shall have zero open issues and PRs, no skipped/todo/surviving-sensor evidence, aligned projections, and recorded human review for every merge. |

## Acceptance criteria

1. `agent:context` reports T74/T75 and does not list a handoff as active when
   its closed issue has no remaining work.
2. The tracked task table names all ten obligations, their dependencies,
   expected evidence, and applicable gates.
3. T75 cannot advance without #58, #207, #294, the exact candidate evidence,
   an independent report, and human-reviewed merge.
4. T76 cannot claim a launcher or publish npm output without trusted-publishing
   configuration, TUF/provenance verification, and clean-machine proof.
5. T77 cannot claim `1.0.0` without its final human decision.

## Out of scope

- Treating a GitHub issue close, CI green check, or milestone percentage as a
  qualification result.
- Accessing or recording a private signing key, token, passphrase, environment
  value, or provider session.
- Replacing independent verification or human review with automated approval.
