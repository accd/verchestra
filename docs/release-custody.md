# Release custody model

**Status: proposed, not ratified.** This document is the bounded custody model
that [#408](https://github.com/accd/verchestra/issues/408) asks the owner and an
independent reviewer to ratify. Until they do, and until the owner actions in
section 9 are done and verified, the operating posture is **single-operator
custody** (`docs/qualification/acceptance-matrix.md` L8). This document does not
relabel that posture as independent custody. It does not claim promotion
readiness. It does not change the signed hold in
`docs/qualification/release-decision-1.0.0.md`.

**Progress (2026-09-30).** The technical part of O2 and the O3 decision are done:
the signing keys were rotated into protected GitHub environments, and the old
keys are retired (section 9). The owner still has to delete the retired
repository-level secrets. Custodian #2 (O1) does not exist yet, so the
environment reviewer is the owner and the posture is still single-operator
custody (RR10).

This is owner-led governance. The repository and its agents cannot appoint an
accountable human, read a key, change the `Protect main` ruleset, or configure an
npm package or object-store account. An agent configures a GitHub environment or
provisions a key only under the owner's explicit authorization, as for O2/O3 on
2026-09-30, and never reads a private key back. This document gets the remaining
actions ready. Only the owner and the second custodian can take them.

Scope boundaries. The timestamp/snapshot refresh routine is implemented under
[#382](https://github.com/accd/verchestra/issues/382). The release lifecycle
(`.3` republication, metadata versions, rollback) is tracked under
[#387](https://github.com/accd/verchestra/issues/387) and
[#393](https://github.com/accd/verchestra/issues/393). This document names who
may cause each effect and what constrains them. It does not implement those
routines.

## 1. What counts as a two-person control

A release effect is under a two-person control only when all of the following
hold:

1. The effect cannot happen until a **second accountable human** acts.
2. The first human cannot impersonate, override, or reconfigure away that action.
3. Every remaining bypass path is named, and each bypass use is detectable after
   the fact by someone other than the person who used it.

These do **not** count as a two-person control:

- **Two fields.** `operationalReviewer`, `securityReviewer`, and `decidedBy` are
  three names in a signed document. They prove that three identities were named,
  not that three people acted (`RELEASE-DECISION-CONTRACT.md`, "What this
  contract does *not* enforce").
- **Two keys held by one person.** The offline root/targets key and the online
  timestamp/snapshot key separate *purposes* (#18, F1). They do not separate
  *people* while one operator holds both.
- **Two keys in one process.** The TUF publisher accepts a `k`-of-`n` threshold
  per role. It signs with every configured signer inside one process
  (`packages/distribution/src/tuf-publication.ts`, `signedEnvelope`). A threshold
  root signed that way proves only that the process held `k` keys.
- **Two secrets in one store.** Two GitHub secrets that one administrator can read,
  replace, or expose through a workflow are one person's custody.
- **Two admins.** Two accounts that can each act alone are two single-person
  controls. They improve availability, not separation.

## 2. Current posture (observed 2026-09-29, read-only; signing rows updated 2026-09-30)

These are sanitized facts. Each one comes from a read-only query listed in
section 9. The signing-secret and environment rows reflect the O2/O3 change of
2026-09-30.

| Surface | Observed state |
| --- | --- |
| Repository administrators | One: the owner (`accd`). The repository is user-owned, not organization-owned. |
| Other collaborators | Two, both `write`: `MiguelCorre` and `brunomjanuario`, the #18 reviewers. `docs/merge-governance.md` still says "one collaborator"; that sentence is stale. |
| `.github/CODEOWNERS` | One owner (`@accd`) on every path. |
| `Protect main` bypass | One actor, `Repository admin`, `bypass_mode: always`. |
| Release signing secrets | Rotated on 2026-09-30 (O3). The new keys exist only as **environment** secrets: `VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64` (offline root/targets) and `VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64` (online timestamp/snapshot) in `tuf-release-signing`, and `VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64` in `t75-evidence-signing`. The three retired keys are still **repository-level** secrets under their old names (`VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`, `VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64`, `VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64`) until the owner deletes them. No workflow names them (`tests/agent-readiness/signing-environments.test.mjs`). |
| GitHub environments | `tuf-release-signing` (id `23152805342`) and `t75-evidence-signing` (id `23152805929`): required reviewer `accd`, `prevent_self_review: false`, `can_admins_bypass: false`, deployment branch policy `main` only. `github-pages` (branch policy only) and `copilot` (no rules) are unchanged and report `can_admins_bypass: true`. |
| Release-decision key | Owner-provisioned and owner-held outside GitHub. Its public half is `docs/qualification/trust/release-decision-public-key.json`. |
| npm package `verchestra` | One maintainer (`accd`). The published versions carry no provenance attestation. Publication is a manual `npm publish` under the owner's 2FA (`t76-validation.md`, "Registry publication"). |
| Object store | One Cloudflare R2 bucket behind a managed public base URL. Upload is a manual step by the owner (`t76-validation.md`, "Publication"). |

**Correction to the single-operator description.** GitHub documents that "any
user with write access to your repository has read access to all secrets
configured in your repository". A write collaborator can push a branch whose
workflow reads a repository secret. So until 2026-09-30 the release keys and the
evidence key were **held** by one operator but **reachable** by three GitHub
identities. Nothing suggests they were ever reached. The exposure was a
capability. O2 removes it for the new keys: an environment secret reaches only a
job that runs from `main` after the environment's reviewer approves it. The
retired keys stay reachable until their repository copies are deleted (RR4,
RR11). Adding a second custodian as a write collaborator does not create
separation by itself.

**"Offline" is a role name, not a storage property.** The root/targets key is
called offline because it signs rarely-changing roles. Today it lives in a GitHub
environment secret and is used by a hosted runner.

## 3. Responsibilities

Each row names the current holder honestly, the target model with a second
accountable custodian ("custodian #2"), and the independent control. Custodian #2
is a named human chosen by the owner (section 9, O1). This document does not
choose them.

### 3.1 Offline root and targets signing

- **Current holder.** The owner alone, as the `VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64`
  secret of the `tuf-release-signing` environment (reviewer `accd`, admin
  bypass off, `main` only). It is used by `.github/workflows/t76-publish-release.yml`
  on manual dispatch, after the owner approves the run. The script binds it to
  `docs/qualification/trust/verchestra-release-public-key.json`, which must be
  reviewed for `tuf-release-root` and must not be retired, before any output
  (`VES_T76_PUBLISH_KEY_MISMATCH`, `VES_T76_PUBLISH_ANCHOR_INVALID`, or
  `VES_T76_PUBLISH_ANCHOR_RETIRED` otherwise).
- **Target model.** The key stays in `tuf-release-signing`, with these changes:
  - required reviewer: custodian #2 instead of the owner;
  - `Prevent self-review` on;
  - `Allow administrators to bypass configured protection rules` off (already);
  - deployment branch policy: `main` only (already).
  The owner dispatches, and custodian #2 approves before the job can read the
  key. For the root role specifically, the target is a 2-of-2 TUF threshold with
  one key per custodian, signed **detached** (each custodian signs the canonical
  signed bytes on their own machine). The detached signing path does not exist
  yet (section 5, RR5; tasks T6).
- **Independent control.** Environment approval by custodian #2 constrains every
  signing run. Once detached signing exists, the root threshold constrains root
  changes cryptographically, independent of GitHub.
- **Does not constrain.** The environment gate does not constrain an admin who
  re-enables admin bypass or edits the reviewers (section 5). Neither control
  constrains a new trust root delivered through npm (3.3).

### 3.2 Online timestamp and snapshot refresh (#382)

- **Current holder.** The owner, as the `VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64`
  secret of `tuf-release-signing`. The refresh routine exists
  (`t76-refresh-timestamp.yml`, #382) and binds the same environment, so each
  refresh needs the reviewer's approval. The published v1 and `.2` releases are
  single-key roots and never use it.
- **Why it shares the offline key's environment.** The publish job signs all four
  roles in one job, and a job binds exactly one environment. A separate
  unattended environment (the earlier `tuf-online` proposal) would need the
  online key twice or a split publish job. The refresh is manually dispatched
  today, so the approval costs one step, not an unattended routine (RR14).
- **Target model.** Custodian #2 approves the pull request that commits any new
  online anchor. If the refresh must later run unattended, the online key moves
  to its own environment with branch policy `main` only, admin bypass off, and no
  required reviewer, and the publish job is split to match.
- **Independent control.** Cryptographic role separation: the online key can
  sign only timestamp and snapshot. It cannot change targets or root. The short
  online expiry bounds how long misuse lasts. As a detective control, custodian #2
  reviews each refresh run's summary.
- **Does not constrain.** A holder of the online key can still freeze clients on
  current metadata or re-sign current snapshots until the key is rotated. This is
  accepted and bounded by expiry, not prevented.

### 3.3 npm publication

- **Current holder.** The owner alone, as the sole npm maintainer, using manual
  `npm publish` under 2FA.
- **Why it matters most.** The launcher package pins the bootstrap TUF root
  (`release-inputs`). Whoever publishes to npm therefore chooses the trust root
  that every new install and every `npx verchestra@<version>` run starts from.
  Every other control in this document sits beneath this one.
- **Target model.** Publication happens from a reviewed workflow job in a
  protected environment (proposed `npm-publication`): required reviewer
  custodian #2, self-review prevented, admin bypass off. It uses npm trusted
  publishing (OIDC) bound to that workflow file and environment. The package
  setting "Require two-factor authentication and disallow tokens" is on. That
  workflow does not exist yet (tasks T7).
- **Independent control.** Approval by custodian #2 gates the only token-less
  publication path. As a detective control, every legitimate version carries a
  provenance attestation naming that workflow and environment. Custodian #2
  checks it independently, and a version without one is an incident.
- **Does not constrain.** Any npm maintainer can still publish interactively with
  2FA. npm has no two-person publish. Adding custodian #2 as a second maintainer
  would make two unilateral publishers, not a two-person control. This is an
  explicit owner decision (section 9, O6).

### 3.4 Object-store (R2) publication

- **Current holder.** The owner alone, who controls the Cloudflare account,
  holds the bucket credential, and uploads manually.
- **Target model.**
  - An R2 API token scoped to the single release bucket, with object read/write
    only and a time-to-live, created for each publication and revoked afterwards.
  - Bucket lock (retention) rules on each published prefix, so objects already
    served cannot be overwritten or deleted during the retention period.
  - Custodian #2 is a Cloudflare account member with a read-only or audit role.
    They can review the account audit log but cannot write.
- **Independent control.** TUF itself: clients accept only bytes that signed
  targets metadata names. An upload can make the service unavailable. It cannot
  make clients accept different release content without the targets key (3.1).
  Bucket locks keep published objects from being silently replaced.
- **Does not constrain.** The account owner can remove a lock rule, mint a broad
  token, or delete the bucket. Custodian #2's audit-log review detects this; it
  does not prevent it.

### 3.5 Release-decision signing

- **Current holder.** The owner, as `decidedBy`, with an owner-held key anchored
  at `docs/qualification/trust/release-decision-public-key.json`.
- **Target model.** Unchanged in who signs: the decision is one human's
  accountable act by design (`RELEASE-DECISION-CONTRACT.md`). The two-person
  element comes from two things: reviews by humans distinct from the decider,
  and a merge of the decision file approved by custodian #2 or the independent
  reviewer, with the bypass not used (3.7). A custodian countersignature would
  need a new decision schema. It is not proposed here.
- **Independent control.** Independent approval of the pull request named in
  `reviewedIn`.
- **Does not constrain.** While the `Repository admin` bypass exists, the decider
  can merge the decision without that approval. The use is logged, but it is not
  prevented (section 5).

### 3.6 Qualification-evidence signing (T75)

- **Current holder.** The owner, as the `VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64`
  secret of the `t75-evidence-signing` environment (reviewer `accd`, admin
  bypass off, `main` only). It is used by `.github/workflows/t75-evidence-signing.yml`.
- **Target model.** Same as 3.1, in `t75-evidence-signing`, with custodian #2 as
  required reviewer and self-review prevented. The key stays pairwise distinct
  from every release identity, active or retired
  (`tests/security/trust-key-separation.test.mjs`).
- **Independent control.** Environment approval by custodian #2.

### 3.7 Merge approval

- **Current holder.** The owner. Every owner-authored pull request merges through
  the `Repository admin` bypass, because `@accd` is the only code owner and
  cannot approve their own pull request (`docs/merge-governance.md`).
- **Target model.** Custodian #2 is added as a second code owner, which requires
  write access. Owner-authored pull requests then get an independent code-owner
  approval, and the bypass becomes unnecessary for routine work. The owner then
  decides one of three things for the bypass actor: remove it, narrow it to
  pull-request-only bypass, or keep it (section 9, O8).
- **Independent control.** A code-owner approval from custodian #2 on every
  owner-authored change, enforced by the ruleset once no bypass remains.
- **Does not constrain.** The sole administrator can edit the ruleset or
  CODEOWNERS. GitHub offers no two-person control over administration. The
  repository audit log detects this; nothing prevents it.

### 3.8 Recovery and rotation

- **Current holder.** The owner alone. No key rotates across operators, and
  there is no second endpoint (L8).
- **Target model.** Section 7. Recovery authority belongs to the custodian who
  is still available, and only through a tracked incident issue. A retrospective
  review by a human who did not perform the recovery is mandatory.
- **Independent control.** The tracked-issue precondition plus the independent
  retrospective. Once the root threshold exists (3.1), a lost root key cannot be
  replaced unilaterally within a lineage.

## 4. Control map per release effect

| Release effect | Who can cause it alone today | Target control | Remaining single-person path |
| --- | --- | --- | --- |
| A new trust root reaches new installs | Owner (npm publish) | Trusted-publishing environment approved by custodian #2; provenance checked by custodian #2 | Interactive `npm publish` by any npm maintainer |
| Existing installs accept new release content | Owner (self-approved environment run). For v1/`.2` installs only, also anyone holding the retired offline key who can serve their base URL (RR11) | Environment approval by custodian #2; later a detached 2-of-2 targets/root threshold | Admin re-enables bypass or edits reviewers (until the threshold exists) |
| Clients see fresh or frozen metadata | Owner (online key, self-approved environment run) | Role-separated online key; short expiry; detective review of refresh runs | Online-key holder can freeze clients until expiry |
| Served bytes change or disappear | Owner (R2 account) | Scoped short-lived token; bucket locks; TUF rejects unsigned bytes | Account owner removes locks or deletes the bucket (availability only) |
| A release decision is recorded | Owner (sign + bypass merge) | Independent reviews + approval of the `reviewedIn` pull request | `Repository admin` bypass while it exists |
| Code or governance reaches `main` | Owner (bypass) | Custodian #2 as second code owner; bypass removed or narrowed | Admin edits the ruleset or CODEOWNERS |

## 5. Residual risks

These remain after every target control in this document is in place. A ratified
model must accept each one consciously, not inherit it.

- **RR1. The permanent `Repository admin` bypass.** It stays until the owner
  removes or narrows it (section 9, O8). While it exists, every merge-level
  control above is procedural for the owner. The ratification in
  `release-decision-1.0.0.md` ("Conscious ratification (F5)") accepted that for a
  hold. It is still a reason a promotion cannot follow.
- **RR2. Administration is single-person.** The sole admin can re-enable
  environment admin bypass, edit reviewers, delete environments, edit the ruleset
  or CODEOWNERS, and read or replace any secret by pushing a workflow. No GitHub
  setting makes this two-person. Mitigation is detective: custodian #2 reviews
  the repository audit log and the environment configuration after each release
  (section 9 verification commands). Detection is not prevention.
- **RR3. npm has no two-person publish.** Every npm maintainer can publish alone
  with 2FA (3.3). Because npm delivers the bootstrap root, this path sits above
  every TUF control. Mitigation is provenance plus independent monitoring.
- **RR4. The retired keys are still reachable by write collaborators** (section
  2). O2 moved the signing keys into protected environments, and O3 rotated
  them, so the reachable values are retired: no signing path admits their
  anchors. The repository-level copies stay readable through a branch workflow
  until the owner deletes them (section 9, O2 step 4).
- **RR5. The threshold is in-process.** Until detached signing exists (tasks
  T6), a `k`-of-`n` role threshold does not separate people. Do not describe a
  threshold root as a two-person control before then.
- **RR6. Root rotation within a lineage is not demonstrated live.** The client
  verifies a sequential root rotation (`tests/e2e/tuf-update-client.test.mjs`,
  "trusted root rotates sequentially before release resolution"). However, a
  changed bootstrap root is refused in place (`VES_TUF_TRUST_ROOT_MISMATCH`,
  `republish-v3-runbook.md` finding 2). Today, recovering from a lost or
  compromised root key means a new lineage delivered through npm.
- **RR7. Custodian collusion or coercion.** Two custodians who agree can do
  anything one could. A two-person control narrows unilateral error and
  compromise. It does not defend against both custodians acting together.
- **RR8. Availability.** With one required approver, custodian #2's absence
  blocks every release effect by design. The recovery path (section 7.4) exists,
  but it is an admin act and inherits RR2.
- **RR9. Reviewer independence.** If custodian #2 is also the reviewer who
  ratifies this model or signs as a decision reviewer, they review the controls
  they operate. The ratifying reviewer should be a different person
  (section 9, O1).
- **RR10. The environment reviewer is the dispatcher.** With one maintainer, the
  required reviewer of both signing environments is the owner, and
  `prevent_self_review` is `false`, or no run could ever start. The gate still
  restricts every signing run to `main`, records an explicit approval, and keeps
  the keys away from branch workflows. It is not a two-person control. That
  needs custodian #2 as the reviewer with self-review prevented (O1, O4).
- **RR11. v1 and `.2` installs still trust the retired offline key.** Their
  launchers pin a single-key root that names it, and a pinned root is never
  replaced in place (RR6). Anyone holding that key who can also serve the v1 or
  `.2` base URL could offer those installs new signed metadata. Serving needs
  the R2 account (3.4). Mitigations: delete the repository copy, move users to
  the `.3` lineage, and let the owner decide on `npm deprecate` for v1 and `.2`
  once `.3` is live.
- **RR12. The retired evidence key can still produce backdated evidence.** A
  retired anchor verifies any envelope whose asserted `issuedAt` precedes its
  `validUntil`. `issuedAt` is chosen by the signer, so a holder of the exposed
  key could forge an envelope dated before the retirement. The committed T75
  evidence is pinned by `tests/security/t75-evidence-attestation.test.mjs`,
  which verifies those exact bytes. Treat any other envelope under
  `t75-evidence-20260825` as untrusted.
- **RR13. The approval gates the dispatch, not the inputs.** The environment
  admits only runs dispatched from `main`, but the publish and evidence jobs
  check out and run the requested candidate revision. The reviewer must check
  the revision and run ids before approving. A candidate cut before this change
  carries the retired anchors, which do not name the new keys, so its run fails
  closed with `VES_T76_PUBLISH_KEY_MISMATCH` or a public-reference mismatch.
- **RR14. The online key shares the reviewer-gated environment** (3.2). Each
  refresh waits for the reviewer (RR8). The refresh job could also reach the
  offline key through the environment, although its workflow never names it.
  `tests/agent-readiness/signing-environments.test.mjs` and the refresh
  script's `VES_T76_REFRESH_OFFLINE_KEY_PRESENT` guard keep it that way.

## 6. What does not change

- `0.0.0-qualification` remains the version. The signed hold stands. A future
  promote round decides on a fresh candidate with its own decision file.
- `docs/qualification/acceptance-matrix.md` L1 and L8 stay as written until the
  controls are verified by the evidence in section 9. Then they are updated in a
  separate reviewed change that cites that evidence.

## 7. Revocation, rotation, and emergency procedure

### 7.1 Triggers

Any of the following opens an incident:

- suspected exposure of any private key or publication credential;
- a custodian leaving, becoming unavailable for a release, or losing an account
  factor;
- an npm version without the expected provenance;
- an unexpected environment, ruleset, CODEOWNERS, or secret change in the audit
  log;
- an R2 object that does not match its signed digest;
- any use of an admin bypass outside the maintainer-bypass contract.

### 7.2 First action, always

Open a tracked GitHub issue **before** changing any protection. The issue records:

- the incident;
- the scope (which role, which key id, which versions);
- the reason normal approval cannot occur;
- the exact commit or run involved.

This is the same precondition as break-glass in `docs/merge-governance.md`, and
it covers release effects as well as merges.

### 7.3 Revoke a custodian

1. Remove the person from every environment's required reviewers, as a code
   owner (a pull request authored by the remaining custodian), from npm and
   Cloudflare, and as a collaborator.
2. Rotate every key the person could reach (7.4). Revoke every token they
   created.
3. Verify with the section 9 commands. Record sanitized output in the incident
   issue.

### 7.4 Rotate a key, by role

- **Online timestamp/snapshot key.** Generate a new key and commit its anchor
  through an independently approved pull request. Re-sign root to name the new
  key (a root version increment) and republish. Clients reject the old key once
  they hold the new root.
- **Offline root/targets key.** In-lineage rotation needs the old root to sign
  the new root. This is supported by the client and not demonstrated live (RR6).
  If the old key is compromised or lost, publish a **new lineage**: a new root, a
  new base-URL prefix, and a new npm launcher version. Deprecate affected npm
  versions with `npm deprecate` and record the lineage change in the incident
  issue.
- **Evidence and release-decision keys.** Provision a new key and commit the new
  anchor through an independently approved pull request. Past signatures stay
  verifiable against the old anchor at their recorded revision. Do not rewrite
  history.
- **Retiring an anchor (every role).** A rotation moves the old anchor to
  `docs/qualification/trust/retired/<keyId>.json`. It keeps its public key,
  key id, and purpose, and gains `validUntil`, the instant it stopped signing.
  The active anchor keeps the role's file name and gets the new key and a new
  key id. The tooling enforces the split:
  - `scripts/t76-publish-release.mjs` and `scripts/t76-refresh-timestamp.mjs`
    refuse any anchor that carries `validUntil`, for either role, with
    `VES_T76_PUBLISH_ANCHOR_RETIRED`, whatever path the caller passes. Both
    read anchors through the one shared module `scripts/t76-signing-custody.mjs`;
  - `scripts/t75-evidence-attestation.mjs` refuses to sign under a reference
    whose window has closed, both at the asserted `issuedAt` and on the wall
    clock. It verifies an envelope only if its `issuedAt` falls inside the
    reference's window;
  - `t75-evidence-signing.yml` refuses a nested reference path, and the release
    decision verifier accepts only a direct child of `docs/qualification/trust/`;
  - `tests/security/trust-key-separation.test.mjs` requires every retired
    anchor to be named by its key id, to carry an exact retirement instant, and
    to have an active successor for its role. No key material or key id may
    repeat across active and retired anchors.
  The 2026-09-30 rotation retired `verchestra-release-20260825`,
  `verchestra-release-timestamp-20260930`, and `t75-evidence-20260825`. The
  committed T75 evidence at `be92397` still verifies:

  ```bash
  node scripts/t75-evidence-attestation.mjs verify \
    --index .specs/features/platform-qualification-matrix/signed-evidence-index.json \
    --envelope .specs/features/platform-qualification-matrix/qualification-evidence-index.dsse.json \
    --public-key-ref docs/qualification/trust/retired/t75-evidence-20260825.json \
    --revision be92397ca0a5caaf7ff8b70dad23659b09899d7d
  ```
- **npm and R2 credentials.** Revoke immediately, then re-create with the scopes
  in 3.3 and 3.4.

### 7.5 Recovery when a custodian is unavailable

A pending release waits. It is not forced. If waiting is itself harmful, for
example because online metadata is about to expire, the available custodian may:

1. open the incident issue (7.2);
2. make the smallest temporary change, such as adding a named substitute
   reviewer. Admin bypass is used only if no substitute exists, and it is named
   in the issue;
3. perform the one action;
4. restore the prior configuration and verify it with section 9 commands.

Recovery never adds a standing bypass.

### 7.6 Independent retrospective

Every incident and every recovery gets a written retrospective in the same issue,
reviewed by a human who did not perform the action. That is custodian #2 for
owner actions and the owner for custodian #2 actions. If both acted, it is the
independent reviewer. The issue closes only after the retrospective confirms
three things: the restoration, the rotation, and the sanitized evidence.

## 8. Rehearsal plan (disposable artifacts; publishes nothing)

The rehearsal proves that the controls deny what they should and that recovery
works. Everything it touches is disposable:

- throwaway keys generated in memory;
- a disposable GitHub environment, secret, and branch;
- a `.invalid` base URL.

No release key, npm package, or R2 bucket is used.

### 8.1 Tooling denials (anyone, locally, no credentials)

Run from a clean checkout after `pnpm install --frozen-lockfile`. The script
generates throwaway Ed25519 keys and anchors in a temporary directory. It then
drives the real publish script, which fails closed before reading any input or
writing any output.

```bash
set -u
REHEARSAL="$(mktemp -d)"
throwaway_key() {
  node -e 'const {generateKeyPairSync}=require("node:crypto");process.stdout.write(generateKeyPairSync("ed25519").privateKey.export({format:"der",type:"pkcs8"}).toString("base64"))'
}
throwaway_anchor() {
  node -e 'const {createPrivateKey,createPublicKey}=require("node:crypto");const k=createPublicKey(createPrivateKey({key:Buffer.from(process.argv[1],"base64"),format:"der",type:"pkcs8"}));process.stdout.write(JSON.stringify({algorithm:"Ed25519",encoding:"spki-pem",keyId:"rehearsal",publicKey:k.export({format:"pem",type:"spki"}),purposes:[process.argv[2]]}))' "$1" "$2" >"$3"
}
publish() {
  node scripts/t76-publish-release.mjs \
    --index "$REHEARSAL/absent/t76-target-index.json" \
    --targets "$REHEARSAL/absent/targets" \
    --out "$REHEARSAL/out" \
    --base-url https://rehearsal.invalid/custody/ \
    --revision 0000000000000000000000000000000000000000 \
    --expires 2027-01-01T00:00:00.000Z \
    --metadata-version 1 \
    --rollback-index "$REHEARSAL/absent/rollback-index.json" "$@" 2>&1 \
    | grep -oE 'VES_T76_PUBLISH_[A-Z_]+' | sort -u
}
OFFLINE="$(throwaway_key)"; ONLINE="$(throwaway_key)"
throwaway_anchor "$OFFLINE" tuf-release-root "$REHEARSAL/offline-anchor.json"
throwaway_anchor "$ONLINE" tuf-timestamp-snapshot "$REHEARSAL/online-anchor.json"
export VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64 VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64

echo "D1"; ( unset VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64 VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64; publish )
VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64="$OFFLINE"; VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64="$ONLINE"
echo "D2"; publish
echo "D3"; publish --release-anchor "$REHEARSAL/offline-anchor.json"
echo "D4"; VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64="$OFFLINE" publish \
  --release-anchor "$REHEARSAL/offline-anchor.json" --timestamp-anchor "$REHEARSAL/offline-anchor.json"
echo "D5"; publish --release-anchor "$REHEARSAL/offline-anchor.json" --timestamp-anchor "$REHEARSAL/online-anchor.json"
echo "D6"; publish --release-anchor docs/qualification/trust/retired/verchestra-release-20260825.json \
  --timestamp-anchor "$REHEARSAL/online-anchor.json"
test ! -e "$REHEARSAL/out" && echo "no publication directory was created"
rm -rf "$REHEARSAL"; unset OFFLINE ONLINE VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64 VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64
```

| Case | What it models | Expected result |
| --- | --- | --- |
| D1 | The key-holding custodian is absent: no key in the job | `VES_T76_PUBLISH_SIGNING_KEY_MISSING` |
| D2 | A key the reviewed release anchor does not name (a non-custodian key) | `VES_T76_PUBLISH_KEY_MISMATCH` |
| D3 | The online role has a key the committed anchor does not name | `VES_T76_PUBLISH_KEY_MISMATCH` (it was `VES_T76_PUBLISH_ANCHOR_MISSING` before the anchor was committed) |
| D4 | One key presented for both roles, through the offline anchor | `VES_T76_PUBLISH_ANCHOR_INVALID` (the offline anchor is not reviewed for the online role) |
| D5 | Both roles held and anchored, with absent disposable inputs | Custody checks pass; stops at `VES_T76_PUBLISH_INPUT_MISSING` |
| D6 | A retired anchor offered for the offline role | `VES_T76_PUBLISH_ANCHOR_RETIRED` |
| all | No partial output | `no publication directory was created` |

Positive controls, using throwaway keys only:

```bash
node --test tests/security/trust-key-separation.test.mjs \
  tests/security/tuf-publication-security.test.mjs \
  tests/e2e/tuf-update-client.test.mjs \
  tests/build/t76-release-publication.test.mjs
```

The expected result is every test passing with zero skipped. This includes role
separation, the refused unattainable threshold, and sequential root rotation.

### 8.2 Approval rehearsal (owner and custodian #2)

Custodian #2 must be a collaborator (section 9, O4). Replace `<custodian-login>`.

**Setup (owner).**

```bash
CUSTODIAN_ID="$(gh api users/<custodian-login> --jq .id)"
gh api -X PUT repos/accd/verchestra/environments/custody-rehearsal --input - <<JSON
{"wait_timer":0,"prevent_self_review":true,
 "reviewers":[{"type":"User","id":$CUSTODIAN_ID}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/accd/verchestra/environments/custody-rehearsal/deployment-branch-policies \
  -f name='rehearsal/custody-408' -f type=branch
openssl rand -hex 16 | gh secret set CUSTODY_REHEARSAL_NONCE --env custody-rehearsal
```

In the environment settings, deselect "Allow administrators to bypass
configured protection rules". The REST body does not accept this setting, and
the read-only check below confirms it.

Create a branch `rehearsal/custody-408` from `main` that adds only this file. It
is never merged:

```yaml
# .github/workflows/custody-rehearsal.yml  (disposable branch only)
name: Custody rehearsal
on:
  push:
    branches: ["rehearsal/custody-408", "rehearsal/custody-408-denied"]
permissions:
  contents: read
jobs:
  gated:
    runs-on: ubuntu-latest
    environment: custody-rehearsal
    steps:
      - name: Report whether the gated secret reached the job
        env:
          NONCE: ${{ secrets.CUSTODY_REHEARSAL_NONCE }}
        run: '[ -n "$NONCE" ] && echo "gated secret present" || { echo "gated secret absent"; exit 1; }'
```

Useful queries (sanitized: ids, states, logins, and conclusions only):

```bash
RUN_ID="$(gh run list --repo accd/verchestra --branch rehearsal/custody-408 --workflow custody-rehearsal.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
ENV_ID="$(gh api repos/accd/verchestra/environments/custody-rehearsal --jq .id)"
gh api repos/accd/verchestra/actions/runs/$RUN_ID/pending_deployments --jq '.[] | {environment: .environment.name, current_user_can_approve}'
gh api repos/accd/verchestra/actions/runs/$RUN_ID/approvals --jq '.[] | {state, user: .user.login, environments: [.environments[].name]}'
gh run view $RUN_ID --repo accd/verchestra --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

**Scenarios.**

| Case | Steps | Expected |
| --- | --- | --- |
| G1 normal approval | The owner pushes the branch. Custodian #2 runs `gh api -X POST repos/accd/verchestra/actions/runs/$RUN_ID/pending_deployments -F "environment_ids[]=$ENV_ID" -f state=approved -f comment='custody rehearsal G1'` | Run waits, then succeeds. Log shows `gated secret present`. `approvals` shows custodian #2 `approved`. |
| G2 self-approval denied | The owner pushes an empty commit and tries the same `POST` as themselves | `pending_deployments` shows `current_user_can_approve: false` for the owner. The `POST` is refused. The run keeps waiting. Record the HTTP status and message. |
| G3 admin cannot force | While G2 waits, the owner looks for "Start all waiting jobs" in the environment | Not offered while admin bypass is off. Record this. It is a setting the admin could re-enable (RR2). |
| G4 custodian unavailable | The owner pushes. Custodian #2 does not act. After the agreed window, custodian #2 or the owner **rejects** with `-f state=rejected` | The job never starts. Conclusion `failure`. The log never contains `gated secret present`. |
| G5 wrong branch | The owner pushes the same file on `rehearsal/custody-408-denied` | The job fails before it runs: the branch is not allowed to deploy to `custody-rehearsal`. No approval is requested. |
| G6 recovery | Follow 7.5 against the rehearsal: open a rehearsal-labelled incident issue. Add a named substitute reviewer, or record that none exists. Approve one run. Restore the reviewer list. | The issue records each step. The final environment query equals the setup state. Custodian #2 writes the retrospective (7.6). |

**Teardown (owner).**

```bash
git push origin --delete rehearsal/custody-408 rehearsal/custody-408-denied
gh api -X DELETE repos/accd/verchestra/environments/custody-rehearsal
```

### 8.3 Recording

Record each case in `.specs/features/release-custody/validation.md` with:

- the run id and conclusion;
- the acting logins;
- the observed denial text or code;
- the date.

Never record a secret value, an environment value, an email address, an IP
address, a token, or a screenshot that shows any of them.

## 9. Owner checklist

These steps are for humans only. Each one ends with a read-only verification
whose sanitized output goes into the validation record. Commands print names,
logins, and settings, never values.

**O1. Choose custodian #2 and the ratifying reviewer.** Custodian #2 is a named
human who accepts accountability for approving release effects and reviewing
the audit log. The ratifying reviewer should be a different person (RR9).
Record both on #408.

**O2. Move signing secrets out of repository scope. Do this before any access
changes.** Steps 1-3 were done on 2026-09-30; step 4 is the owner's.

1. Done. The signing jobs declare `environment:` and read environment secrets
   whose names differ from the repository-level ones, so no job can fall back to
   a repository secret (tasks T5, `tests/agent-readiness/signing-environments.test.mjs`).
2. Done, with the owner as reviewer until custodian #2 exists (RR10). The
   environments are `tuf-release-signing` (offline and online keys) and
   `t75-evidence-signing`. Both have required reviewer `accd`,
   `prevent_self_review: false`, admin bypass off, and `main` only. When
   custodian #2 exists, replace the reviewer and set `prevent_self_review: true`.
3. Done, as a rotation (O3). The keys were generated in memory and piped
   straight into the environment secrets. No private key was printed or written.
4. **Owner, after the change is merged and `.3` is re-signed from `main`:**
   delete the three repository-level secrets
   (`gh secret delete <name> --repo accd/verchestra` for each retired name in
   section 2).

```bash
gh api repos/accd/verchestra/actions/secrets --jq '[.secrets[].name]'
gh api repos/accd/verchestra/environments/tuf-release-signing --jq '{name, can_admins_bypass, rules: [.protection_rules[] | {type, prevent_self_review, reviewers: [.reviewers[]?.reviewer.login]}]}'
gh api repos/accd/verchestra/environments/tuf-release-signing/secrets --jq '[.secrets[].name]'
gh api repos/accd/verchestra/environments/tuf-release-signing/deployment-branch-policies --jq '[.branch_policies[].name]'
```

Expected output:

- The repository-level list contains no signing key name. Until step 4 it still
  lists the three retired names.
- `can_admins_bypass` is `false`.
- A `required_reviewers` rule names the reviewer: `accd` with
  `prevent_self_review: false` today, custodian #2 with
  `prevent_self_review: true` in the target model.
- The environment secret list is `["VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64","VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64"]`.
- The branch policy list is `["main"]`.

Repeat the checks for `t75-evidence-signing`, whose secret list is
`["VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64"]`.

A run dispatched from any branch other than `main` must fail before its first
step with `Branch "<name>" is not allowed to deploy to <environment> due to
environment protection rules`, and no approval is requested. This was observed
on 2026-09-30 for all three signing workflows
(`.specs/features/release-custody/validation.md`).

**O3. Decide whether to rotate the reachable keys.** Decided and done on
2026-09-30: all three reachable keys were rotated. The `.3` lineage needed a new
root anyway (runbook finding 2), so the new offline and online keys cost no
extra lineage break. The committed T75 evidence still verifies under its
retired anchor (7.4).

| Role | Retired key id | Active key id | Active key SHA-256 (SPKI DER) |
| --- | --- | --- | --- |
| Offline root/targets | `verchestra-release-20260825` | `verchestra-release-20260930-custody` | `f120cbbb93391adc3a71d35d74048c148753f755eb228739a3ddada8560ce467` |
| Online timestamp/snapshot | `verchestra-release-timestamp-20260930` | `verchestra-release-timestamp-20260930-custody` | `0ad7e44bfe1d6b77c683438b9ed1a78b1319f8a8194453bec659d149bd09d6f1` |
| T75 evidence | `t75-evidence-20260825` | `t75-evidence-20260930-custody` | `67f59b1a43394a506a03c515bd3963c8eb703b760a0dc4bf5198e55a0bb014aa` |

For the two TUF keys, the SHA-256 is also the TUF key id that `root.json`
carries.

**O4. Add custodian #2 as a collaborator and a code owner.** Grant `write`, not
`admin`. Custodian #2 then **authors** the `.github/CODEOWNERS` pull request that
adds them next to `@accd`, and the owner approves it as the existing code owner.
That is an independent path, with no bypass or break-glass needed.

```bash
gh api repos/accd/verchestra/collaborators --jq '.[] | {login, role_name}'
gh api repos/accd/verchestra/codeowners/errors --jq '.errors | length'
```

Expected: custodian #2 is listed with `write`, and there are `0` CODEOWNERS
errors.

**O5. Provision the online key under custody.** Done on 2026-09-30 as part of
O2/O3: the key is in `tuf-release-signing`, not a repository secret, for the
reason in 3.2. Custodian #2 approves any later anchor pull request.

**O6. npm.** Decide whether custodian #2 becomes a second maintainer. That
improves availability and creates a second unilateral publisher (3.3). Configure
trusted publishing once the publication workflow exists (tasks T7). Then enable
"Require two-factor authentication and disallow tokens".

```bash
npm owner ls verchestra | cut -d' ' -f1
npm view verchestra@<version> dist.attestations --json
```

Expected: the maintainer list matches the decision, and every version published
after the change shows an attestation.

**O7. Cloudflare R2.** Create a bucket-scoped object read/write token with a
time-to-live for each publication, and revoke it afterwards. Add bucket lock
rules for published prefixes. Give custodian #2 a read-only or audit
membership. Record an owner-attested statement listing token scope, TTL, lock
rules, and member roles by name, with no token value and no account identifier.
Add one public probe:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data probe <public-release-base-url>custody-probe
```

Expected: a `4xx` status, never `2xx`.

**O8. Decide the bypass actor.** Once custodian #2 can approve owner pull
requests, choose one:

- remove the `Repository admin` bypass;
- change its mode to pull-request-only;
- keep it and ratify it again consciously.

Any ruleset change goes through a tracked issue first (`docs/merge-governance.md`).

```bash
gh api repos/accd/verchestra/rulesets/19738785 --jq '.bypass_actors'
```

Expected: the output matches the decision.

**O9. Rehearse.** Run section 8 and record it (8.3).

**O10. Ratify.** The owner and the independent reviewer approve the pull request
that marks this document ratified, citing the O1-O9 evidence. Only after that
may L8 be updated, in a separate reviewed change, and #408 be closed.
