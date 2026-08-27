---
schema: verchestra-feature-handoff/v1
feature: live-activation-matrix
issue: 18
status: verification
branch: docs/correct-387-tuf-version-collision
baseRevision: eeba159659a480977088e93c582d4c4f7f56a02e
lastCompletedTask: null
nextTask: "Publish .3 with an incremented metadataVersion (so its 2.snapshot/2.targets force a re-fetch), then re-run the matrix with update_version=0.0.0-qualification.3 to close the live update/rollback leg (matrix J02). See #387 — the .2 block is a TUF-version collision, not an unactivatable package."
lastGate: "live-activation-matrix runs 33087399859 + 33091253051 (reproduction): activate + self-test + recover pass 5/5; update fails 5/5 (#387). Run 33092399993: fresh .2 activates 5/5."
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
**update/rollback** leg is blocked by a release-process defect, not an
unactivatable package: `0.0.0-qualification.2` activates cleanly from a fresh
state on all five targets (run 33092399993), and every byte it needs is served
live, but it shares v1's TUF `metadataVersion`, so activating either release over
the other's cached metadata reuses stale targets and fails `VES_TUF_SOURCE_HTTP`
on the update path (tracked as #387).

## Next

- Resolve #387 by republishing `.3` with an incremented `metadataVersion` (its
  release served from R2), so the update client re-fetches instead of reusing the
  cached, same-versioned metadata.
- Re-run this workflow with `update_version=0.0.0-qualification.3` to close the
  update/rollback leg; update `validation.md` and the acceptance matrix J02.
- The five per-leg transcripts of run 33087399859 are the evidence a reviewer
  verifies by content (`gh run download 33087399859`).
