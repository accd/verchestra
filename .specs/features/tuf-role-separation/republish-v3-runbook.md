# `.3` republication runbook (owner-gated prep)

This is the operational prep for the next republication (`0.0.0-qualification.3`).
It exists because three findings, all proven while investigating #387, constrain
what a republication can and cannot do. It is not itself a publication step — the
publication is owner-gated (signing keys, R2 upload, `npm publish` under 2FA) —
but everything the owner needs to get it right is here.

The publish tooling now enforces the part that can be enforced (monotonic TUF
metadata versions, #387). The rest is procedure and two open design decisions the
owner and reviewers must settle before the live update/rollback leg (matrix J02 /
limitation L7) can close.

## Three findings that constrain a republication

### 1. Each release MUST use a strictly greater TUF `metadataVersion` (#387)

`0.0.0-qualification` (v1) and `0.0.0-qualification.2` were both published with
`metadataVersion = 1`. Under `consistent_snapshot` both expose
`1.snapshot.json` / `1.targets.json`; the update client's persistent metadata
cache then reuses the first release's targets and resolves a target hash the
successor never serves, failing `VES_TUF_SOURCE_HTTP` on the update path. This is
the live-matrix update-leg failure.

`.3` **must** publish with `metadata_version` strictly greater than the highest
previously published (so **≥ 3** if v1 = 1 and `.2` = 2 — confirm `.2`'s actual
published version first; see "Confirm the prior version" below). The tooling now
requires this to be a conscious choice:

- `scripts/t76-publish-release.mjs` — `--metadata-version` is **required** (no
  silent default).
- `.github/workflows/t76-publish-release.yml` — the `metadata_version` dispatch
  input has **no default**; the operator states it each time.
- Regression proof: `tests/e2e/tuf-update-client.test.mjs` — a successor sharing
  its predecessor's `metadataVersion` cannot be staged over it; an incremented
  one stages cleanly.

The tooling cannot yet *derive* the prior version from a committed ledger (the
rollback index does not carry it — see the follow-up note), so strict
monotonicity across releases remains the operator's responsibility, guarded by
the required flag and this runbook.

### 2. Role separation changes the root, so `.3` cannot be updated *in place* over v1/.2

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
only passed in run 33087399859 because the update *failed* (cache unchanged). A
successful update makes the naive rollback fail by anti-rollback. Closing J02's
rollback half requires a design decision (#393): reframe rollback as a
roll-*forward* publication that points at the prior content, add a reviewed
retained-bundle re-activation path, or narrow what J02 claims. **Settle #393
before promising a live rollback demonstration.**

## Recommended sequence (my judgment; owner and reviewers to ratify)

Publish the role-separated lineage as its own trust anchor and demonstrate the
**forward** update leg on it; treat the rollback half per the #393 decision.

1. **Complete role separation (owner).** Provision the online timestamp/snapshot
   key and commit its anchor; extend the pairwise trust-separation test. Steps
   are in this feature's `handoff.md` ("What the owner must do to complete it").
2. **Confirm the prior version.** Read the highest published TUF metadata version
   (`.2`'s `timestamp.json` `signed.version` from the live endpoint). `.3` uses
   the next integer above it.
3. **Build the `.3` candidate** from `main` (post-merges) via the candidate-build
   workflow; capture its run id and reconciled index (this becomes the rollback
   index the publish step seals).
4. **Publish `.3`** (owner, via `t76-publish-release.yml`): role-separated keys,
   both anchors committed, `metadata_version` = the next integer (step 2),
   `--timestamp-expires` short now that #382's refresh routine exists, a new
   `/v3/` base-URL prefix, and the rollback index from step 3. The tooling signs
   root+targets offline and timestamp+snapshot online, each bound to its anchor.
5. **Upload to R2 and verify live BEFORE `npm publish`** (owner). Verify every
   object by sha256, then confirm the endpoint serves, for each target: the
   metadata chain `200`, and each target under a `Range` request `206`. Only then
   `npm publish` `.3` (2FA).
6. **Demonstrate the forward update leg.** To exercise a *successful* update, a
   second role-separated release sharing `.3`'s root and a higher
   `metadata_version` is needed (e.g. `.4`). Run the live-matrix with
   `base=0.0.0-qualification.3`, `update=0.0.0-qualification.4`. Handle the
   rollback phase per the #393 decision — do not expect the naive
   re-invoke-the-base rollback to pass after a successful update.
7. **Record.** Update `docs/qualification/acceptance-matrix.md` (L5, L7, J02),
   the live-matrix `validation.md`/`handoff.md`, and this feature's handoff with
   the run ids and transcript digests, verified by content.

## What `.3` alone does and does not close

- **Closes / advances:** F1/F2 (role separation reaches users), L5 (a fixed,
  role-separated, `1.0`-intent build is republished), and fresh-install
  activation of the new lineage on all five targets.
- **Does not close by itself:** the live update/rollback leg (J02/L7). That needs
  a second same-root release for the forward update (step 6) and the #393
  decision for rollback. A single `.3` cannot demonstrate an update leg — there is
  nothing correctly-versioned to move *to*.

## Follow-ups referenced

- #387 — the metadata-version collision (fix: this runbook + the tooling guard).
- #393 — rollback vs anti-rollback; the launcher always re-resolves.
- #382 — the monthly timestamp/snapshot refresh routine (makes a short
  `--timestamp-expires` safe).
- #391 — the update client surfacing a version collision as a misleading source
  error rather than a clear one.
- Possible follow-up: record each published TUF `metadataVersion` in a committed,
  tamper-evident ledger so the publish tooling can enforce strict monotonicity
  against it rather than relying on the operator plus this runbook.
