# TUF online timestamp/snapshot refresh (#382)

A short expiry on the online `timestamp.json` and `snapshot.json` is TUF's
freeze-attack defense (#18 F2): a client refuses metadata past its expiry, so a
mirror or attacker that replays old metadata is detected within the window. The
publish tooling already decouples the online expiry from the offline root and
targets horizon (`--timestamp-expires`), but a short window without a routine
that renews it is an expiry time-bomb. This feature adds that routine and makes
it operationally safe.

## Requirements

- **TR-01 Refresh input.** The refresh reads the metadata artifact a
  `t76-publish-release` run emitted (`publication-manifest.json` and
  `publication/<target>/metadata/`) for all five supported targets. Every
  target's `root.json` must hash to the manifest's pinned `rootDigest`.
- **TR-02 Offline metadata is verified, never re-signed.** Under the published
  root: the root verifies against its own root role, the top-level targets
  against the root's targets role, and the components delegation against the
  delegation declared in targets. Root, targets, and components must be
  unexpired. The root must delegate root and targets to exactly the committed
  release anchor, and timestamp and snapshot to exactly the committed timestamp
  anchor, with every key id equal to sha256 of its declared key. The top-level
  targets must name only `releases/<target>/release.json`, with the manifest's
  `releaseId`. No root, targets, or components file is emitted.
- **TR-03 Online key only.** The refresh signs with
  `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64` only. The key must match
  `docs/qualification/trust/release-timestamp-snapshot-public-key.json`, which
  must declare exactly `"purposes": ["tuf-timestamp-snapshot"]`. A missing anchor
  fails `VES_T76_PUBLISH_ANCHOR_MISSING`, and a mis-purposed anchor fails
  `VES_T76_PUBLISH_ANCHOR_INVALID`. If the offline
  `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64` is present in the environment, the
  refresh fails `VES_T76_REFRESH_OFFLINE_KEY_PRESENT`. An online key that is the
  release anchor's key, or equal anchors, fails
  `VES_T76_REFRESH_ROLE_SEPARATION`. The library refuses any online signer that
  shares a key id or key material with a root, targets, or delegated-targets key
  (`VES_TUF_PUBLICATION_ROLE_SEPARATION`).
- **TR-04 Monotonic versions.** The new timestamp and snapshot version must
  strictly exceed every snapshot, targets, and timestamp version the ledger
  records for the root, and every timestamp or snapshot version present in the
  input (`VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC`). The ledger must
  record a release for the root (`VES_T76_REFRESH_LINEAGE_UNKNOWN`). The
  published targets version must equal the newest targets version the ledger
  records for the root, so a superseded release is never re-signed
  (`VES_T76_REFRESH_TARGETS_CHANGED`).
- **TR-05 Expiry ordering.** The new expiry is ordered timestamp <= snapshot <=
  targets <= root, using the published targets and root expiries, and is in the
  future (`packages/distribution/src/tuf-publication.ts` `validateRoleExpiries`).
- **TR-06 Output.** The refresh writes `publication/<target>/metadata/` holding
  exactly `timestamp.json` and `<version>.snapshot.json`,
  `refresh-manifest.json` (per-target assets in upload order, snapshot first,
  with digests, sizes, and remote keys, plus the manual steps), and
  `ledger-entry.json`: a `role-refresh` entry that chains to the ledger's last
  entry and validates when appended. Nothing is uploaded and the ledger is not
  edited. No refusal writes any output byte.
- **TR-07 Client round trip.** A client that trusted the published release
  refuses it once the short window passes (`VES_TUF_EXPIRED`), and accepts the
  refreshed timestamp and snapshot, resolving the same release. A fresh install
  also bootstraps from the refreshed metadata.
- **TR-08 Per-role versions in the publication model.** Snapshot and timestamp
  signing is one shared routine that takes per-role versions
  (`TufRoleVersions`). A release passes one version for every role. Existing
  publication outputs stay byte-identical.
- **TR-09 Refresh workflow.** `.github/workflows/t76-refresh-timestamp.yml` is
  `workflow_dispatch` only, uses SHA-pinned actions already reviewed for T76,
  and has read-only permissions (`actions: read` to download the publish run's
  artifact, `contents: read`). Its inputs are required, default-free, and
  validated against exact patterns, and reach the shell only through `env:`.
  Only the online secret is named, in exactly one step, and it is never echoed.
  The workflow has no storage endpoint, upload tool, or publishing step. It
  uploads the refresh output as one artifact.
- **TR-10 Ledger from main.** Both the publish and refresh workflows read the
  ledger from `origin/main`'s tip, fail unless the checked-out copy is an
  unedited prefix of it (`VES_T76_PUBLISH_LEDGER_DIVERGED`), and pass it to the
  signer with `--ledger` before anything is signed.
- **TR-11 Publish input.** `t76-publish-release.yml` gains a required,
  default-free `timestamp_expires` input validated against the exact instant
  pattern and passed as `--timestamp-expires`.
- **TR-12 Key separation, client side.** Targets or a root signed by the online
  key never verify. The refresh refuses them, and the update client rejects them
  (`VES_TUF_THRESHOLD`) before staging anything.
- **TR-13 Operator procedure.** The runbook and the tuf-role-separation handoff
  describe the monthly procedure: refresh, verify, upload (snapshot before
  timestamp), then append the ledger entry.

## Out of scope

- Generating, provisioning, or committing the real online key or its anchor.
  That stays with the owner. Tests use throwaway in-process keys.
- Scheduling the refresh. It stays a manual dispatch so a human uploads and
  records every run.
- Adding a purpose check to the publish script's anchors. Only the refresh
  checks purposes, so existing publish behavior is unchanged.
