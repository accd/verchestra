---
schema: verchestra-feature-handoff/v1
feature: live-activation-matrix
issue: 18
status: complete
branch: docs/387-live-update-rollback-evidence
baseRevision: d0748dc43ab02799e862f620aa4599b8ca303fda
lastCompletedTask: null
nextTask: "No further action for this feature. The latest live run, 37235055911, passed activate, update, rollback, self-test and recover on all five targets with base 0.0.0-qualification.6 and update 0.0.0-qualification.7 (validation.md). The earlier runs 36997576112 (.3 to .4), 37047903756 (.4 to .5) and 37152404760 (.5 to .6) remain recorded. Acceptance-matrix J02 and L7 are updated in a separate reviewed change."
lastGate: "live-activation-matrix run 37235055911: five of five legs exit 0; rollback restored the .6 active pointer byte for byte on every target, and each .7 pointer names the manifest digest for its target"
updatedAt: 2026-10-04T21:30:00Z
---

# Live activation matrix (#18, L7)

## Result of run 36997576112 (2026-10-02): the update/rollback leg is closed

With base `0.0.0-qualification.3` and update `0.0.0-qualification.4`, both on
the role-separated root and both built from a revision that carries AD-036,
every phase exits `0` on all five targets: activate, update, rollback,
self-test smoke, and recover. The update moved the active pointer to `.4` and
the rollback restored the `.3` pointer byte for byte. See `validation.md`.
Steps 1 to 5 of "Next (reconciled 2026-09-29, #407)" below are done, except
the acceptance-matrix update in step 5, which is a separate reviewed change.
The sections below are kept as the history of how the leg was closed.

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
4. **The rollback half (#393, decided).** The retained-release re-activation
   (option 2, AD-036) is implemented, and the roll-forward publication (option 1)
   is documented. See "Rollback after a successful update" below. Both releases
   in step 3 must be built from a revision that carries it.
5. **Record the result.** Record the run ids and transcript digests in
   `validation.md`. Acceptance-matrix J02, L5, and L7 are updated in a
   separately reviewed change.

The five per-leg transcripts of run 33087399859 remain the evidence a reviewer
verifies by content (`gh run download 33087399859`).

# Blockers

None. The owner-gated publications (`.3` and `.4`, R2 upload, `npm publish`)
were done on 2026-10-01 and 2026-10-02.

## Rollback after a successful update (#393, AD-036)

Fixing #387 makes the update succeed, which exposes a second, deliberate
refusal: the update advances the machine's TUF metadata cache to the successor's
version, so re-invoking the base launcher is a metadata downgrade and
anti-rollback rejects it with `VES_TUF_ROLLBACK`. The workflow's `rollback` phase
could only ever pass trivially, when the update had failed and nothing moved.

Two rollback mechanisms now exist, and neither weakens anti-rollback:

1. **Source-side roll-forward (option 1, no client change).** A publisher serves
   an older release to every client by publishing a _new_ forward publication —
   a strictly higher TUF metadata version — whose targets point at the prior
   release's bytes. Clients update to it as they would to any release. In this
   workflow, that is dispatched as the `update_version` of a later run.
2. **Local retained-release re-activation (option 2, AD-036).** A launcher whose
   pinned release this machine already verified and activated under the same
   trust root, and which a later verified release has superseded, re-activates
   it from its installed bytes with no source read, after re-hashing every
   component and re-running the health gate. This is what the workflow's
   `rollback` phase now exercises.

The workflow now records `active.json` after `activate`, `update`, and
`rollback`, and fails a leg unless the update moved the pointer and the rollback
restored the base pointer byte for byte. Deterministic evidence:
`tests/e2e/vestra-launcher-activation.test.mjs` (A@v1 → B@v2 → A with zero
source reads) and `tests/agent-readiness/live-activation-workflow.test.mjs`.
No live run has exercised either mechanism yet; the published `0.0.0-qualification`
and `.2` packages predate AD-036 and cannot pass `rollback` after a successful
update.

## Next (historical, 2026-08-27 — withdrawn, see above)

- Resolve #387 by republishing `.3` with an incremented `metadataVersion` (its
  release served from R2), so the update client re-fetches instead of reusing the
  cached, same-versioned metadata.
- Re-run this workflow with a base and an update that share one root, both built
  from a revision carrying AD-036, to close the update/rollback leg; update
  `validation.md` and the acceptance matrix J02.
- The five per-leg transcripts of run 33087399859 are the evidence a reviewer
  verifies by content (`gh run download 33087399859`).
