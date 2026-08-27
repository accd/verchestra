---
schema: verchestra-feature-handoff/v1
feature: live-activation-matrix
issue: 18
status: verification
branch: docs/live-activation-l7
baseRevision: cb1eea754ed27b69ae1713ca20c89729f6c512cf
lastCompletedTask: null
nextTask: "Re-run the matrix with update_version=0.0.0-qualification.3 once #387 is resolved and the .3 release is republished, to close the live update/rollback leg (matrix J02)."
lastGate: "live-activation-matrix run 33087399859: activate + self-test + recover pass 5/5; update fails 5/5 (#387)"
updatedAt: 2026-08-27T00:00:00Z
---

# Live activation matrix (#18, L7)

The workflow `.github/workflows/live-activation-matrix.yml` (from #381) runs the
installed-user lifecycle on all five supported targets against the published npm
package and the live R2 endpoint.

## Result of run 33087399859

See `validation.md`. Live **activation**, **self-test smoke**, and **disaster
recovery** pass on all five targets — the live-activation coverage rose from two
of five to five of five, and a live recovery ran for the first time. The live
**update/rollback** leg is blocked because the published `0.0.0-qualification.2`
is unactivatable (`VES_TUF_SOURCE_HTTP`, tracked as #387).

## Next

- Resolve #387 by republishing `.3` with its release actually served from R2.
- Re-run this workflow with `update_version=0.0.0-qualification.3` to close the
  update/rollback leg; update `validation.md` and the acceptance matrix J02.
- The five per-leg transcripts of run 33087399859 are the evidence a reviewer
  verifies by content (`gh run download 33087399859`).
