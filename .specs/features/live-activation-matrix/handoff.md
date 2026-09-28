---
schema: verchestra-feature-handoff/v1
feature: live-activation-matrix
issue: 18
status: blocked
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: null
nextTask: "J02 cannot close with a single .3 publication: .3's role-separated root cannot update v1/.2 in place (VES_TUF_TRUST_ROOT_MISMATCH). Next: the owner completes tuf-role-separation and publishes .3 with a strictly greater metadata_version (#387), then a later release on the same root (for example .4) with a higher metadata_version, then re-runs this matrix base=.3 update=.4; the rollback half waits for the #393 decision."
lastGate: "live-activation-matrix runs 33087399859 + 33091253051 (reproduction): activate + self-test + recover pass 5/5; update fails 5/5 (#387). Run 33092399993: fresh .2 activates 5/5."
updatedAt: 2026-09-29T00:00:00Z
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

## Next (reconciled 2026-09-29, #407)

The earlier next step was to publish `.3` with an incremented
`metadataVersion` and re-run with `update_version=0.0.0-qualification.3`. That
step is **withdrawn**. It would not close J02. The constraints come from
`.specs/features/tuf-role-separation/republish-v3-runbook.md`, findings 2 and 3:

- **Finding 2: `.3` changes the trust root.** Role separation adds an online
  timestamp/snapshot key, which changes `rootDigest`. The update client pins
  the bootstrap root per managed install and refuses to replace it
  (`VES_TUF_TRUST_ROOT_MISMATCH`). An install that activated v1 or `.2`
  therefore cannot update to `.3` in place. `base=v1 update=.3` would fail at
  bootstrap and demonstrate nothing about the update leg.
- **Finding 3: anti-rollback blocks a genuine rollback (#393).** The launcher
  re-resolves on every invocation. After a successful update, re-invoking the
  older release is rejected with `VES_TUF_ROLLBACK`. The `rollback` exit `0`
  recorded in run 33087399859 happened only because the update failed.

Closing J02 therefore needs all of the following. No single publication
supplies them.

1. **The online key and anchor (owner).** The owner provisions the online
   timestamp/snapshot key and commits its anchor. See
   `.specs/features/tuf-role-separation/handoff.md`.
2. **`.3` published (owner, #387).** It needs a `metadata_version` strictly
   greater than the highest already published, per the runbook. After
   publication, fresh-install activation of the new lineage can be recorded on
   all five targets.
3. **A later release on `.3`'s root.** For example, `.4` with a higher
   `metadata_version`. The matrix is then re-run with
   `base_version=0.0.0-qualification.3` and
   `update_version=0.0.0-qualification.4` for the forward update leg.
4. **The #393 decision for the rollback half.** Rollback may become a
   roll-forward publication, a reviewed retained-bundle re-activation, or a
   narrower J02 claim. Do not expect the naive re-invoke-the-base rollback to
   pass after a successful update.
5. **Record the result.** Record the run ids and transcript digests in
   `validation.md`. Acceptance-matrix J02, L5, and L7 are updated in a
   separately reviewed change.

The five per-leg transcripts of run 33087399859 remain the evidence a reviewer
verifies by content (`gh run download 33087399859`).

# Blockers

- **Owner-gated publication.** This covers the online key and anchor, the `.3`
  and later same-root publications, R2 upload, and `npm publish` under 2FA
  (#387).
- **The #393 design decision** for the rollback half.

## Next (historical, 2026-08-27 — withdrawn, see above)

- Resolve #387 by republishing `.3` with an incremented `metadataVersion` (its
  release served from R2), so the update client re-fetches instead of reusing the
  cached, same-versioned metadata.
- Re-run this workflow with `update_version=0.0.0-qualification.3` to close the
  update/rollback leg; update `validation.md` and the acceptance matrix J02.
- The five per-leg transcripts of run 33087399859 are the evidence a reviewer
  verifies by content (`gh run download 33087399859`).
