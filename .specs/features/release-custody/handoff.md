---
schema: verchestra-feature-handoff/v1
feature: release-custody
issue: 408
status: blocked
branch: feat/408-protected-signing-environments
baseRevision: 0f7dedde2a2a9ff334b873d42ea5ae1760be1507
lastCompletedTask: T11
nextTask: "Merge the protected-environment change, re-sign .3 from a new main candidate with environment approval, then the owner deletes the three retired repository-level secrets (O2 step 4) and decides O1 (custodian #2 and a distinct ratifying reviewer)."
lastGate: "gate:quick, gate:build, gate:security, gate:release, agent:check PASS (feat/408-protected-signing-environments)"
updatedAt: 2026-09-30T22:00:00Z
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
- T5 and T11 (2026-09-30, owner-authorized): the O2 technical part and O3.
  - Environments `tuf-release-signing` (id `23152805342`) and
    `t75-evidence-signing` (id `23152805929`): required reviewer `accd`,
    `prevent_self_review: false` (single maintainer, RR10), `can_admins_bypass:
    false`, deployment branch policy `main` only.
  - The offline, online, and evidence keys were rotated, generated in memory,
    and piped straight into the environment secrets
    `VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64`, `VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64`,
    and `VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64`. No private key was printed or
    written.
  - New anchors carry new key ids; the old ones are retired under
    `docs/qualification/trust/retired/` and refused by every signing path. The
    committed T75 evidence still verifies under its retired anchor.
  - The three signing jobs bind their environments and read only the renamed
    environment secrets. A run of each workflow dispatched from the feature
    branch was refused before its first step. See `validation.md`.
  - `docs/release-custody.md` records the new posture, the retired-anchor
    mechanism (7.4), rehearsal case D6, and residual risks RR10-RR14.

# Blockers

Every remaining step needs an owner decision or action that an agent cannot
take:

- **Merge.** The workflow, script, anchor, and test change must merge to `main`
  before any signing run can use the new keys: the old workflows name the
  retired repository secrets, and the new anchors exist only on the branch.
- **`.3` re-sign.** The 2026-09-30 `.3` signing (publish run `36771571763`) used
  the retired keys and must never be uploaded. Build a new candidate from
  `main`, dispatch `t76-publish-release.yml` from `main`, and approve it in
  `tuf-release-signing` (`republish-v3-runbook.md`).
- **O1.** Name custodian #2, and a distinct ratifying reviewer. This is
  human-only.
- **O2 step 4.** Delete the three retired repository-level secrets
  (`VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`,
  `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64`,
  `VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64`) after the merge and the `.3`
  re-sign. Until then a write collaborator can still read the retired values
  (RR4, RR11).
- **O2 reviewer switch.** Once custodian #2 exists, make them the required
  reviewer of both environments with `prevent_self_review: true`.
- **O4.** Grant custodian #2 `write`. Custodian #2 authors the CODEOWNERS pull
  request, and the owner approves it.
- **O6.** Decide npm maintainership, then configure trusted publishing and
  disallow tokens.
- **O7.** Scope the R2 token, add bucket locks, and give custodian #2
  audit-only membership.
- **O8.** Decide the `Repository admin` bypass actor: remove it, make it
  pull-request-only, or re-ratify it.
- **O9/O10.** Run the approval rehearsal G1-G6 with custodian #2. Then the owner
  and the independent reviewer ratify.

# Next action

The coordinator merges `feat/408-protected-signing-environments` (maintainer
bypass; enforcement strengthened). The owner then re-signs `.3` from a new
`main` candidate with environment approval, deletes the three retired
repository-level secrets, and records O1 on #408.
