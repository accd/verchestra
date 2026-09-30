---
schema: verchestra-feature-handoff/v1
feature: tuf-role-separation
issue: 18
status: blocked
branch: feat/382-online-key-anchor
baseRevision: 4dde7e9edbec3c6ef1cc5f1bc1d6f995908e85c5
lastCompletedTask: null
nextTask: "Follow republish-v3-runbook.md for .3 (#387): build the candidate, publish under /v3/ with a metadata_version above the ledger, verify R2 (200 metadata, 206 targets) before npm publish, then append the ledger entry. The npm 2FA session and the R2 upload are owner-held. Run t76-refresh-timestamp.yml monthly for any root published with a short timestamp_expires."
lastGate: "gate:quick, gate:build, gate:security, gate:release, agent:check PASS (feat/382-tuf-timestamp-refresh)"
updatedAt: 2026-09-30T07:15:00Z
---

# TUF role separation (#18, F1 + F2)

Closes the security review's finding **F1** ("No TUF role separation; the release
trust model is effectively single-key") and delivers the decoupling half of **F2**
("one `expires` for every role collapses the freeze-attack defense"). Both are
from the #18 release decision and are on the security reviewer's must-fix list
for any future promote.

## What landed (code, reviewable now)

- `packages/distribution/src/tuf-publication.ts` — `TufPublicationInput` is
  role-separated: `roles: {root, timestamp, snapshot, targets}`, each with its
  own `signers` + `threshold`; `expires` is a per-role `TufRoleExpiries`; the
  root `version` is an input, not a hardcoded `1`. The root declares the **union**
  of all role keys; each role's metadata is signed **only** by its own key. The
  core enforces the freeze-defense ordering `timestamp <= snapshot <= targets <=
root`. Role separation is transparent to the TUF client, proven by the existing
  resolve/stage round-trip and the new F1/F2 assertions in
  `tests/security/tuf-publication-security.test.mjs`.
- `scripts/t76-publish-release.mjs` — signs with two role-separated keys: the
  offline `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64` (root + targets) and the
  online `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64` (timestamp +
  snapshot). Each key is bound to its own reviewed anchor before any output
  (extends #18/F3), the two keys must differ, and the online window defaults to
  the full horizon with an opt-in `--timestamp-expires` (see the time-bomb note
  below). `--root-version` is also accepted.
- `.github/workflows/t76-publish-release.yml` — reads both role-separated secrets
  in the single signing step; header prose and the shape guard
  (`tests/agent-readiness/t76-publish-workflow.test.mjs`) updated from "exactly
  one secret" to the two role-separated secrets.

## What the owner must do to complete it

The online key and its committed anchor are owner-gated, exactly like the release
key and the #18 decision key — the code fails closed (`VES_T76_PUBLISH_ANCHOR_MISSING`)
until the anchor exists, and the publish workflow needs the second secret:

1. Generate the online key straight into the environment (never to disk), the
   same one-liner pattern as the release key:

   ```bash
   export VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64="$(openssl genpkey -algorithm ed25519 -outform DER | openssl base64 -A)"
   printf '%s' "$VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64" \
     | openssl base64 -d -A | openssl pkey -inform DER -pubout -outform PEM
   ```

2. `gh secret set VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64` with the
   base64 PKCS#8 private half.

3. Commit `docs/qualification/trust/release-timestamp-snapshot-public-key.json`
   with the PEM public half, shaped like the existing trust files, with
   `"purposes": ["tuf-timestamp-snapshot"]`.

4. Extend `tests/security/trust-key-separation.test.mjs` to assert the three
   trust identities (evidence, release, timestamp-snapshot) are pairwise
   distinct in key material and purpose.

## The republication itself

See `republish-v3-runbook.md` (this directory) for the owner-gated `.3` procedure
and, critically, three findings from the #387 investigation that constrain it:
each release must use a strictly greater TUF `metadataVersion` (#387, now enforced
by the publish tooling against the committed ledger
`docs/qualification/tuf-publication-ledger.json`, which records v1 and `.2` and
must gain an entry for every later publication); a role-separated root cannot be updated _in place_ over
v1/`.2` (`VES_TUF_TRUST_ROOT_MISMATCH`), so the new lineage is a fresh trust
anchor; and a genuine live rollback collides with TUF anti-rollback (#393) because
the launcher always re-resolves. The live update/rollback leg needs a second
same-root release and the #393 decision — a single `.3` cannot close it.

## Notes

- **Republish, not retrofit.** These changes alter `rootDigest`, so they reach
  users only on the next republication (the `.3` release under a new base-URL
  prefix). The already-published package is unaffected. Because the root changes,
  existing installs do not update in place to `.3` (finding 2 in the runbook).
- **Short online window (#382).** The monthly re-signing routine now exists:
  `.github/workflows/t76-refresh-timestamp.yml` runs
  `scripts/t76-refresh-timestamp.mjs`, which re-signs only timestamp and snapshot
  with the online key over the verified, untouched root, targets, and components,
  and emits the files, an upload manifest, and the ledger entry to append. The
  publish workflow's `timestamp_expires` input is now required (no default). A
  short window is safe only while the operator runs the monthly procedure in
  `republish-v3-runbook.md` ("Monthly online refresh") for that root:
  refresh, verify, upload (snapshot before timestamp), append the ledger entry.
  Feature: `.specs/features/tuf-timestamp-refresh/`.
- **Custody.** Two role-separated keys narrow F1, but both still sit with one
  operator; a second human custodian (matrix L8) remains a separate promote
  precondition only the owner can resolve.

# Blockers

Reconciled 2026-09-29 (#407).

- **The code has landed.** Role separation landed in `1ee646e`, and the
  monotonic `metadataVersion` guard for #387 landed in `5ac3122`.
- **The online key and anchor are provisioned (2026-09-30).**
  `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64` is a repository secret,
  generated in memory and never written to disk. Its public half is committed
  as `docs/qualification/trust/release-timestamp-snapshot-public-key.json` with
  `purposes: ["tuf-timestamp-snapshot"]`. `tests/security/trust-key-separation.test.mjs`
  already checks every pair of trust files, so the new anchor is covered.
  Moving the release secrets into protected environments is tracked by #408 (O2).
- **The `.3` republication is owner-gated.** It covers keys, R2 upload, and
  `npm publish` under 2FA, and it is tracked by #387. A single `.3` does not
  close live update/rollback (runbook finding 2; see
  `.specs/features/live-activation-matrix/handoff.md`).
- **The #382 refresh routine has shipped** (`t76-refresh-timestamp.yml`,
  `scripts/t76-refresh-timestamp.mjs`, merged in #428). A short
  `timestamp_expires` is safe only for a root whose monthly refresh is running.
