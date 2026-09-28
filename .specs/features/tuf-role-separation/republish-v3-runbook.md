# `.3` republication runbook (owner-gated prep)

This is the operational prep for the next republication (`0.0.0-qualification.3`).
It exists because three findings, all proven while investigating #387, constrain
what a republication can and cannot do. It is not itself a publication step — the
publication is owner-gated (signing keys, R2 upload, `npm publish` under 2FA) —
but everything the owner needs to get it right is here.

The publish tooling now enforces the part that can be enforced: strictly
increasing TUF metadata versions per trust root, checked against the committed
publication ledger `docs/qualification/tuf-publication-ledger.json` (#387). The
rest is procedure and two open design decisions the owner and reviewers must
settle before the live update/rollback leg (matrix J02 / limitation L7) can
close.

## Three findings that constrain a republication

### 1. Each release MUST use a strictly greater TUF `metadataVersion` (#387)

`0.0.0-qualification` (v1) and `0.0.0-qualification.2` were both published with
`metadataVersion = 1`. Under `consistent_snapshot` both expose
`1.snapshot.json` / `1.targets.json`; the update client's persistent metadata
cache then reuses the first release's targets and resolves a target hash the
successor never serves, failing `VES_TUF_SOURCE_HTTP` on the update path. This is
the live-matrix update-leg failure. Launchers built after #391 name the same
collision as `VES_TUF_STALE_METADATA` before any target is fetched; the
already-published launchers are immutable and keep the old code.

Every publication **must** use a `metadata_version` strictly greater than every
snapshot, targets, and timestamp version already published under the **same
root digest**. The tooling enforces it:

- `docs/qualification/tuf-publication-ledger.json` — the committed, append-only,
  hash-chained ledger of every publication (releaseId, semantic version, base URL
  and URL prefix, root digest, per-role versions). It records v1 and `.2` at
  metadata version 1 under the root digest prefix `sha256:491673b9`; facts the
  repository does not record (the full root digest, the root version, `.2`'s
  releaseId and host) are `null`, and the checker treats them conservatively.
  Role-only entries (`kind: "role-refresh"`) are reserved for the #382
  timestamp/snapshot re-signing routine.
- `scripts/t76-publish-release.mjs` — `--metadata-version` is **required**, and
  the script refuses it with `VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC`
  unless it strictly exceeds every version the ledger records for the same root
  digest, before any timestamp, snapshot, or targets metadata is signed and
  before any output byte exists. A different root digest is an independent
  lineage.
- `.github/workflows/t76-publish-release.yml` — the `metadata_version` dispatch
  input has **no default**; the operator states it each time.
- Regression proof: `tests/build/t76-release-publication.test.mjs` (equal and
  lower refused, higher admitted, a different root independent) and
  `tests/e2e/tuf-update-client.test.mjs` (a successor sharing its predecessor's
  `metadataVersion` fails `VES_TUF_STALE_METADATA`; an incremented one stages
  cleanly).

The workflow checks the ledger at the **candidate revision** it checks out, so a
candidate must be built from a revision whose ledger already records every prior
publication.

### 2. Role separation changes the root, so `.3` cannot be updated _in place_ over v1/.2

The role-separation work (F1/F2) adds a separate online timestamp/snapshot key,
which changes `rootDigest`. The update client pins the bootstrap trust root per
managed install and **refuses to replace it**
(`tuf-update-client.ts #bootstrapTrust` → `VES_TUF_TRUST_ROOT_MISMATCH`). So an
install that already activated v1 or `.2` (single-key root) **cannot** update
in-place to a role-separated `.3` (new root) — it fails at bootstrap, before the
`metadataVersion` logic is even reached.

Consequence: the role-separated lineage is a **new trust anchor**. Fresh installs
of `.3` activate cleanly; existing v1/`.2` installs do not update to it in place.
A live update/rollback demonstration therefore cannot be `v1 → .3`. It must be
between two releases that **share** `.3`'s role-separated root.

### 3. A genuine rollback collides with TUF anti-rollback (#393)

The launcher always re-resolves through the TUF client on every invocation
(`node-activation-closure.ts:202` always calls `resolveAndStage` → `refresh()`;
there is no "already staged, skip refresh" short-circuit). Once an update advances
the cache to a higher metadata version, re-invoking the older release re-resolves
older metadata and is rejected: `VES_TUF_ROLLBACK` ("New timestamp version N is
less than current version M"). This is a security property, not a bug — a client
must not be downgraded by replayed metadata.

The live-matrix `rollback` leg (`npx verchestra@$BASE_VERSION` after `update`)
only passed in run 33087399859 because the update _failed_ (cache unchanged). A
successful update makes the naive rollback fail by anti-rollback. Closing J02's
rollback half requires a design decision (#393): reframe rollback as a
roll-_forward_ publication that points at the prior content, add a reviewed
retained-bundle re-activation path, or narrow what J02 claims. **Settle #393
before promising a live rollback demonstration.**

**Status (AD-036, proposed).** The retained-release path is implemented: a
launcher whose pinned release this machine already verified under the same root,
and which a later verified release superseded, re-activates it from its
installed bytes with no source read. The roll-forward publication remains the
way to serve an older release to every client. For step 6 this means both `.3`
and `.4` must be built from a revision that carries AD-036, because each
activation records the release it verified; the naive rollback then passes
through the retained path, and the workflow now fails a leg unless the rollback
restores the base's active pointer.

## Recommended sequence (my judgment; owner and reviewers to ratify)

Publish the role-separated lineage as its own trust anchor and demonstrate the
**forward** update leg on it; treat the rollback half per the #393 decision.

1. **Complete role separation (owner).** Provision the online timestamp/snapshot
   key and commit its anchor; extend the pairwise trust-separation test. Steps
   are in this feature's `handoff.md` ("What the owner must do to complete it").
2. **Confirm the prior version.** Read `docs/qualification/tuf-publication-ledger.json`
   on `main`. `.3`'s role-separated root is a new lineage, so the ledger admits
   any version for it; `.3` should still use `2` (above every recorded version),
   which keeps versions monotonic across lineages at no cost. For any later
   same-root release, use the next integer above the highest version the ledger
   records for that root digest.
3. **Build the `.3` candidate** from `main` (post-merges) via the candidate-build
   workflow; capture its run id and reconciled index (this becomes the rollback
   index the publish step seals).
4. **Publish `.3`** (owner, via `t76-publish-release.yml`): role-separated keys,
   both anchors committed, `metadata_version` from step 2, the default
   `--timestamp-expires` (the full horizon: #382's refresh routine does not exist
   yet, and a short online window without it is an expiry time-bomb), a new
   `/v3/` base-URL prefix, and the rollback index from step 3. The tooling signs
   root+targets offline and timestamp+snapshot online, each bound to its anchor.
5. **Upload to R2 and verify live BEFORE `npm publish`** (owner). Verify every
   object by sha256, then confirm the endpoint serves, for each target: the
   metadata chain `200`, and each target under a `Range` request `206`. Only then
   `npm publish` `.3` (2FA).
6. **Demonstrate the forward update leg.** To exercise a _successful_ update, a
   second role-separated release sharing `.3`'s root and a higher
   `metadata_version` is needed (e.g. `.4`). Run the live-matrix with
   `base=0.0.0-qualification.3`, `update=0.0.0-qualification.4`. The rollback
   phase passes only if both releases carry AD-036 (see finding 3's status);
   without it, do not expect the naive re-invoke-the-base rollback to pass after
   a successful update.
7. **Record.** Append the `.3` (and later `.4`) release entry to
   `docs/qualification/tuf-publication-ledger.json` from its
   `publication-manifest.json` (the final manual step it lists), then update
   `docs/qualification/acceptance-matrix.md` (L5, L7, J02), the live-matrix
   `validation.md`/`handoff.md`, and this feature's handoff with the run ids and
   transcript digests, verified by content. Record the ledger entry **before**
   building the next candidate, so that candidate's ledger carries it.

## What `.3` alone does and does not close

- **Closes / advances:** F1/F2 (role separation reaches users), L5 (a fixed,
  role-separated, `1.0`-intent build is republished), and fresh-install
  activation of the new lineage on all five targets.
- **Does not close by itself:** the live update/rollback leg (J02/L7). That needs
  a second same-root release for the forward update (step 6) and the #393
  decision for rollback. A single `.3` cannot demonstrate an update leg — there is
  nothing correctly-versioned to move _to_.

## Follow-ups referenced

- #387 — the metadata-version collision (fix: this runbook + the tooling guard).
- #393 — rollback vs anti-rollback; the launcher always re-resolves.
- #382 — the monthly timestamp/snapshot refresh routine (makes a short
  `--timestamp-expires` safe).
- #391 — the update client surfacing a version collision as a misleading source
  error; resolved for future launchers by `VES_TUF_STALE_METADATA`.
- The committed publication ledger (`docs/qualification/tuf-publication-ledger.json`,
  feature `tuf-metadata-version-safety`) now carries each published TUF version,
  so the tooling enforces strict monotonicity instead of relying on the operator.
