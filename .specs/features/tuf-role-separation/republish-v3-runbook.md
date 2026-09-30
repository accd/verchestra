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
  Role-only entries (`kind: "role-refresh"`) record each run of the #382
  timestamp/snapshot re-signing routine (see "Monthly online refresh" below).
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

The workflow reads the ledger from **`origin/main`'s tip**, not from the
candidate revision it checks out, and fails unless the candidate's committed copy
is an unedited prefix of main's (`scripts/tuf-publication-ledger.mjs
assert-prefix`). A candidate cut before a later publication or refresh was
recorded is therefore still bounded by it. Every publication and refresh must
still be recorded on `main` before the next one runs.

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

## Custody of the signing keys (#408)

Since 2026-09-30 the offline and online keys are rotated and exist only as
secrets of the protected `tuf-release-signing` environment
(`VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64`, `VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64`).
Their anchors are the committed
`docs/qualification/trust/verchestra-release-public-key.json`
(`verchestra-release-20260930-custody`) and
`docs/qualification/trust/release-timestamp-snapshot-public-key.json`
(`verchestra-release-timestamp-20260930-custody`). The old anchors are retired
under `docs/qualification/trust/retired/`, and the tooling refuses them
(`VES_T76_PUBLISH_ANCHOR_RETIRED`). This has three consequences for `.3`:

- **Dispatch from `main` only.** `t76-publish-release.yml` and
  `t76-refresh-timestamp.yml` bind `tuf-release-signing`, which admits only
  runs dispatched from `main`. A run from any other branch fails before its
  first step, and no approval is requested.
- **Approve each run.** The job waits until the environment's reviewer approves
  it. Before approving, the reviewer checks the dispatch inputs (revision, run
  ids, versions, expiries). The environment gates the dispatch ref, not the
  checked-out candidate (`docs/release-custody.md` RR13).
- **Rebuild the candidate.** The publish job checks out the candidate revision
  and binds the keys to that revision's anchors. The `.3` publication signed on
  2026-09-30 (publish run `36771571763`, candidate `0f7dedd`, candidate run
  `36768094824`) used the retired keys. Never upload it. Build a new candidate
  from `main` after the #408 change merges, so it carries the new anchors, and
  sign that.

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
3. **Build the `.3` candidate** from `main` (post-merges, including #408) via the
   candidate-build workflow; capture its run id and reconciled index (this
   becomes the rollback index the publish step seals).
4. **Publish `.3`** (owner, via `t76-publish-release.yml` dispatched from `main`,
   then approved in the `tuf-release-signing` environment): role-separated keys,
   both anchors committed, `metadata_version` from step 2, a new `/v3/` base-URL
   prefix, and the rollback index from step 3. `timestamp_expires` is a required
   input: pass the same value as `expires` for the full horizon, or a short
   window (for example 45 days) **only** if the monthly online refresh below will
   be run for this root without a gap. The tooling signs root+targets offline and
   timestamp+snapshot online, each bound to its anchor.
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

## Monthly online refresh (#382)

A short online window is the freeze-attack defense (#18 F2): a client refuses a
`timestamp.json` past its expiry (`VES_TUF_EXPIRED`), so a mirror or attacker
replaying old metadata is detected within the window. The window is only safe
while someone renews it. `t76-refresh-timestamp.yml` (script
`scripts/t76-refresh-timestamp.mjs`) re-signs **only** `timestamp.json` and the
next `<version>.snapshot.json` for all five targets with the online key. It never
reads the offline key (it refuses to run if that key is in its environment),
never re-signs root, targets, or components, and publishes nothing.

Preconditions (met on 2026-09-30, #408): the online key is the
`VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64` secret of the protected `tuf-release-signing`
environment, and its public half is committed as
`docs/qualification/trust/release-timestamp-snapshot-public-key.json` with
`"purposes": ["tuf-timestamp-snapshot"]`. A missing anchor fails closed with
`VES_T76_PUBLISH_ANCHOR_MISSING`, and a retired one with
`VES_T76_PUBLISH_ANCHOR_RETIRED`. The routine refreshes only role-separated
lineages, so it cannot apply to v1/`.2`. Dispatch it from `main`; each run waits
for the environment reviewer's approval, so plan the monthly refresh around the
reviewer's availability.

Every month, at least one full cycle before the current `timestampExpires`:

1. **Pick the version.** Read `docs/qualification/tuf-publication-ledger.json` on
   `main`. The new `metadata_version` must strictly exceed every snapshot,
   targets, and timestamp version recorded for the root (use the next integer
   above the highest). Pick `timestamp_expires`: no later than the published
   targets expiry; about 45 days out keeps a two-week margin on a monthly cadence.
2. **Refresh.** Dispatch `t76-refresh-timestamp.yml` from `main` with
   `publish_revision` and `publish_run_id` of the `t76-publish-release` run that
   published the current release (its `t76-release-metadata-…` artifact holds
   the offline-signed root, targets, and components), plus `metadata_version`
   and `timestamp_expires`. Approve the run in `tuf-release-signing` after
   checking those inputs. The run reads the ledger from `origin/main`, verifies the published root
   against both committed anchors and the targets and components under that root,
   refuses an unrecorded lineage (`VES_T76_REFRESH_LINEAGE_UNKNOWN`), targets that
   are not the newest recorded release for the root
   (`VES_T76_REFRESH_TARGETS_CHANGED`), or a non-increasing version
   (`VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC`), and uploads one artifact:
   `refresh-manifest.json`, `ledger-entry.json`, and
   `publication/<target>/metadata/{<version>.snapshot.json,timestamp.json}`.
3. **Verify.** Check each file's sha256 against `refresh-manifest.json`, and that
   the artifact holds no `root.json`, `*.targets.json`, or `*.components.json`.
4. **Upload.** For each target, upload `<version>.snapshot.json` **before**
   `timestamp.json`, preserving the relative keys under the release base URL.
   Never overwrite or delete root, targets, components, or any target file. Then
   confirm `timestamp.json` is served uncached and run the published launcher
   against the live endpoint.
5. **Append the ledger entry.** Append `ledger-entry.json` verbatim to
   `docs/qualification/tuf-publication-ledger.json` in a reviewed pull request and
   merge it before the next refresh or publication. If another entry landed on
   `main` first, the emitted `sequence`/`previousEntryDigest` no longer chain:
   rerun the refresh against the current `main` rather than editing the entry.

A missed month is a freeze, not a compromise: clients refuse the expired
timestamp (`VES_TUF_EXPIRED`) until a refresh is uploaded, and then resume with
no reinstall. The artifact the refresh reads is retained for 365 days; a lineage
older than that needs its offline-signed metadata re-supplied from the live
endpoint or a fresh publication.

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
  `timestamp_expires` safe): `t76-refresh-timestamp.yml`, procedure above,
  feature `.specs/features/tuf-timestamp-refresh/`.
- #391 — the update client surfacing a version collision as a misleading source
  error; resolved for future launchers by `VES_TUF_STALE_METADATA`.
- The committed publication ledger (`docs/qualification/tuf-publication-ledger.json`,
  feature `tuf-metadata-version-safety`) now carries each published TUF version,
  so the tooling enforces strict monotonicity instead of relying on the operator.
