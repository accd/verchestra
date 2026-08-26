---
name: tuf-role-separation
status: in_progress
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

## Notes

- **Republish, not retrofit.** These changes alter `rootDigest`, so they reach
  users only on the next republication (the `.3` release under a new base-URL
  prefix). The already-published package is unaffected.
- **Time-bomb / follow-up (#382).** A short online window is only safe once a
  monthly timestamp/snapshot re-signing routine exists; until then the window
  defaults to the horizon. The routine (`t76-refresh-timestamp.yml`) is tracked
  as #382.
- **Custody.** Two role-separated keys narrow F1, but both still sit with one
  operator; a second human custodian (matrix L8) remains a separate promote
  precondition only the owner can resolve.
