---
schema: verchestra-feature-handoff/v1
feature: handoff-reconciliation
issue: 407
status: verification
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T5
nextTask: "Independent review of the reconciliation table in validation.md against each cited commit and report (#407); on merge, mark this handoff complete."
lastGate: pnpm agent:check PASS; pnpm gate:quick PASS; pnpm gate:security PASS
updatedAt: 2026-09-29T00:00:00Z
---

# Handoff

## State

Every handoff that #407 names has been audited. `validation.md` holds the
file-to-evidence table.

Six handoffs moved to `complete`:

- `release-decision`
- `t75-evidence-signing`
- the four T76 slices

`canonical-json` was already `complete`. Only its stale `nextTask` was
corrected.

Six handoffs stay visible as open work, each naming its owner:

- `milestone-2-completion`: blocked on #408.
- `live-activation-matrix`: blocked on #387 and #393.
- `tuf-role-separation`: blocked on the owner's online key; #382 is open.
- `deep-doctor-live-probes`: T22 blocked, with no tracking issue; see #379.
- `canonical-json-t4-completion`: T21, with no tracking issue.
- `agent-ready-repository`: the repository topics.

## Findings for the maintainer

- `.specs/features/tuf-role-separation/republish-v3-runbook.md:92` says that
  #382's refresh routine exists. It does not: #382 is open and
  `t76-refresh-timestamp.yml` is absent. The runbook is left unchanged because
  a parallel branch may edit it.
- T21: `tests/security/canonical-json-locale-allowlist.test.mjs` declares 9
  duplicate keys in `MATRIX_CEILINGS` and 5 in `UNCLASSIFIED_CEILINGS`. The
  later, looser value wins. No issue tracks this.
- T22 (DDL-14) cannot be met by re-dispatching `platform-matrix.yml`. The
  workflow has no deep-doctor step. No issue tracks this.
- `.specs/STATE.md` AD-033 still reads "proposed", although the owner signed
  over its definition in `62ccde4`. Marking it ratified is left to the owner.

## Next

Independent review, then merge. File issues for T21 and T22 if the
maintainer wants them tracked.
