# Handoff reconciliation

Issue: #407

## Problem

At `951e25f`, `pnpm agent:context` correctly derived T77 complete, but it
listed stale feature handoffs as active work. Some examples:

- `release-decision` asked to implement signature verification and to obtain
  the first signed decision. Both were committed.
- `t75-evidence-signing` read `blocked` despite its qualification report.
- Four T76 slices asked to materialize or verify evidence that
  `docs/qualification/t76-validation.md` records.
- `live-activation-matrix` implied that a single `.3` publication would close
  the live update/rollback leg. The role-separation runbook shows it cannot.

## Requirements

- **HR-01**: Audit these handoffs against their exact source reports and merged
  commits: `release-decision`, `t75-evidence-signing`, `milestone-2-completion`,
  the four T76 slices, `canonical-json-t4-completion`, `live-activation-matrix`,
  `tuf-role-separation`, `agent-ready-repository`, and
  `deep-doctor-live-probes`.
- **HR-02**: For each audited handoff, record what is complete (with a commit or
  report path), what remains open, and the exact next action with its open
  issue. Say so explicitly where no issue exists. Mark a feature `complete`
  only where the evidence shows its own work is complete, not merely because a
  later report exists.
- **HR-03**: `release-decision` SHALL record the signed hold as the completed
  decision. A future fresh-candidate promotion is separate work.
- **HR-04**: `live-activation-matrix` next actions SHALL agree with the trust-root
  and anti-rollback constraints (runbook findings 2 and 3, #387, #393). A single
  publication SHALL NOT be claimed to close J02.
- **HR-05**: `pnpm agent:context` SHALL no longer list completed signing or
  materialization steps as outstanding. Genuinely open work SHALL stay listed.
- **HR-06**: Historical reports, signed decision bytes, the qualification graph,
  the acceptance matrix, and the qualification version SHALL be unchanged. The
  change SHALL make no new production-readiness claim.

## Constraints

- Handoff frontmatter stays valid under `parseHandoff`, and a `blocked` handoff
  carries a `# Blockers` section. No handoff moves out of `complete`.
- Superseded text is kept under a "historical" heading rather than deleted, so
  the record of what was believed when stays readable.
- `.specs/features/tuf-role-separation/republish-v3-runbook.md` is not edited.
  A parallel branch may change it. Its false line 92 is recorded instead.

## Out of scope

- Fixing the defects the audit found: the T21 duplicate ceiling keys and the
  missing doctor step in the T22 workflow. Owner-gated actions (keys,
  publication, repository topics) are also out of scope.
- Editing `docs/qualification/acceptance-matrix.md`. Its L16 to L18 items stay
  as the record bound to their revision.
