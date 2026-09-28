# TUF metadata version safety (#391, #387 follow-up)

Two releases published with the same TUF metadata version under one trust root
collide in the update client's cache (#387): tuf-js keeps the cached
equal-version timestamp, snapshot and targets, and the client then requests a
target hash the new release never serves. This feature hardens both sides.

## Client side (#391)

- **MV-01.** Before `refresh()`, the update client reads the locally trusted
  `timestamp.json` (version, the `snapshot.json` meta version, and the SHA-256
  of its bytes), and the source fetcher captures the remote `timestamp.json`
  bytes.
- **MV-02.** When the remote timestamp carries the trusted version but different
  content, and tuf-js discarded it as an equal version after verifying its
  signature, resolution fails with `VES_TUF_STALE_METADATA` before any target is
  read. The sanitized message names the metadata version collision and carries
  only version integers.
- **MV-03.** The check still names the collision when refresh fails after the
  timestamp step (for example, a cached snapshot that must be re-fetched).
- **MV-04.** Neighbouring cases keep their behavior: a genuinely incremented
  version updates; identical re-served metadata is accepted; a replayed older
  version is `VES_TUF_ROLLBACK`; an unsigned equal-version timestamp is
  `VES_TUF_THRESHOLD`; an equal-version timestamp accepted under a rotated root
  (the cached one no longer verifies) updates normally.

## Publication side (#387 follow-up)

- **MV-05.** A committed, append-only ledger,
  `docs/qualification/tuf-publication-ledger.json`, records every published
  release: releaseId, semantic version, base URL and URL prefix, root digest,
  and per-role versions (root, targets, snapshot, timestamp). It admits
  role-only refresh entries (timestamp/snapshot) for the #382 routine. Entries
  are hash-chained and sequence-numbered.
- **MV-06.** Facts not recorded in the repository are recorded as unknown
  (`null`). An unknown root digest with a recorded prefix matches every root
  with that prefix; an unknown digest without a prefix matches every root; an
  unknown role version on a matching entry makes monotonicity unprovable and
  the publication is refused.
- **MV-07.** `scripts/t76-publish-release.mjs` requires `metadataVersion`
  strictly greater than every snapshot, targets, and timestamp version the
  ledger records for the same root digest, and fails with
  `VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC` before any release metadata
  is signed or any output byte is written. A different root digest is an
  independent lineage.
- **MV-08.** Library callers must pass `metadataVersion` and `rootVersion`
  explicitly; the silent `?? 1` fallback is removed.
- **MV-09.** The republication runbook and the tuf-role-separation handoff
  reference the ledger, and the runbook no longer claims the #382 refresh
  routine exists.

## Out of scope

- Already-published launchers are immutable and keep reporting the collision as
  `VES_TUF_SOURCE_HTTP`.
- The #382 refresh routine itself, and appending entries for publications that
  have not happened.
