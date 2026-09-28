---
schema: verchestra-feature-handoff/v1
feature: release-custody
issue: 408
status: blocked
branch: docs/408-independent-custody-model
baseRevision: 2500c6c4fe59479d893912b889efce337a6cbda1
lastCompletedTask: T2
nextTask: "Owner: decide O1 (custodian #2 and a distinct ratifying reviewer) from docs/release-custody.md section 9, then O2 before any access change."
lastGate: "agent:check PASS; gate:quick PASS; focused custody suites 51/51 PASS"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Prepare the bounded release custody model #408 asks for, so that closing it
needs only owner decisions and actions. The canonical document is
`docs/release-custody.md`. The operating posture remains **single-operator
custody** (acceptance matrix L8). Nothing here claims independent custody or
promotion readiness, and the signed hold is unchanged.

# Completed evidence

- T1: `docs/release-custody.md` covers the model, the control map per release
  effect, residual risks RR1-RR9, the revocation/rotation/emergency procedure,
  the rehearsal plan, and the owner checklist O1-O10. `docs/merge-governance.md`
  points to it.
- T2: the section 8.1 tooling denials were reproduced on throwaway keys (D1-D5).
  No publication directory was created. See `validation.md`.
- Read-only observation on 2026-09-29 (section 2 of the document). Two points
  are material:
  - The release root/targets key and the T75 evidence key are **repository-level**
    GitHub secrets. Two `write` collaborators exist, and GitHub documents that
    write access implies read access to repository secrets. Custody is therefore
    held by one operator and reachable by three identities.
  - `docs/merge-governance.md` still says the repository has one collaborator;
    that sentence is stale.

# Blockers

Every remaining step needs an owner decision or action that an agent cannot
take:

- **O1.** Name custodian #2, and a distinct ratifying reviewer.
- **O2.** Move signing secrets into protected environments and delete the
  repository copies. This must happen before any further access change. It
  depends on T5 being merged.
- **O3.** Decide whether to rotate the keys reachable by write collaborators
  (RR4).
- **O4.** Grant custodian #2 `write`. Custodian #2 authors the CODEOWNERS pull
  request, and the owner approves it.
- **O5.** Provision the online key into a `tuf-online` environment and commit
  its anchor with custodian #2's approval.
- **O6.** Decide npm maintainership, then configure trusted publishing and
  disallow tokens.
- **O7.** Scope the R2 token, add bucket locks, and give custodian #2
  audit-only membership.
- **O8.** Decide the `Repository admin` bypass actor: remove it, make it
  pull-request-only, or re-ratify it.
- **O9/O10.** Run the approval rehearsal G1-G6 with custodian #2. Then the owner
  and the independent reviewer ratify.

# Next action

The owner reads `docs/release-custody.md` sections 3, 5, and 9, and records O1
on #408. An agent can then take T5, the workflow `environment:` wiring, as a
separate reviewed change that strengthens enforcement.
