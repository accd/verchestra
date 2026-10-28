# Release custody validation (#408)

The requirements are documentation requirements. The evidence for each one is
the file and line where the model states it, plus the executed tooling
rehearsal. This record does **not** evidence the #408 acceptance criteria that
need humans: ratification, the verified permission arrangement, the authorized
approval rehearsal, and accountable acceptance. Those stay open under
`handoff.md` `# Blockers`.

Base revision: `ac7021bd8b45a29ea636d30cd020196675eef7f4`.

## Requirement to evidence

| Requirement | Evidence |
| --- | --- |
| CUST-01 responsibilities, holders, targets, controls | `docs/release-custody.md:92` (offline root/targets), `:117` (online refresh, #382), `:134` (npm), `:157` (R2), `:176` (release decision), `:192` (T75 evidence), `:202` (merge approval), `:218` (recovery/rotation). Each section has **Current holder**, **Target model**, **Independent control**, and, where one exists, **Does not constrain**. |
| CUST-02 honest posture, no relabel, no promotion claim | `docs/release-custody.md:3-10` (status banner: proposed, single-operator custody, no promotion readiness, hold unchanged); `:283` (what does not change); `docs/merge-governance.md` break-glass pointer states the posture remains single-operator custody. |
| CUST-03 residual risks and the two-person rule | `docs/release-custody.md:26-52` (definition, and what does not count: two fields, two keys, in-process threshold, two secrets, two admins); `:240-281` (RR1 permanent `Repository admin` bypass through RR9). |
| CUST-04 control map per release effect | `docs/release-custody.md:229-238`. |
| CUST-05 revocation, rotation, emergency, retrospective | `docs/release-custody.md:291-367` (triggers, tracked issue first, custodian revocation, per-role rotation, recovery when a custodian is unavailable, independent retrospective). |
| CUST-06 rehearsal, disposable, exact commands, expected denials | `docs/release-custody.md:369-527`: tooling denials D1-D5 at `:426-430`, approval rehearsal G1-G6 at `:503-508`, recording rules at `:517`. |
| CUST-07 owner checklist with sanitized verification | `docs/release-custody.md:529-635` (O1-O10; every command projects names, logins, or settings only). |
| CUST-08 no secrets or local paths | The tracked files contain no key material, token, email, or machine-local path. The only key-shaped values in the document are generated at run time into a temporary directory and removed. `pnpm agent:check` passes. |

## Executed evidence (agent, 2026-09-29, at the base revision)

**Tooling denials (section 8.1).** The exact script block in
`docs/release-custody.md` section 8.1 was extracted and run with the pinned
Node 24.14.0:

```text
D1  VES_T76_PUBLISH_SIGNING_KEY_MISSING
D2  VES_T76_PUBLISH_KEY_MISMATCH
D3  VES_T76_PUBLISH_ANCHOR_MISSING
D4  VES_T76_PUBLISH_KEY_MISMATCH
D5  VES_T76_PUBLISH_INPUT_MISSING
no publication directory was created
```

Every result matches the expected column. D3 reflects the current state, in
which the online-key anchor is not committed. The keys were throwaway,
generated in memory, and deleted with the temporary directory. Nothing was
uploaded or published.

**Positive controls.** The four suites named in section 8.1 ran with
`node --test`: 51 tests, 51 pass, 0 fail, 0 skipped, 0 todo.

**Read-only posture queries (section 2).** The GitHub API reported:

- environments `copilot` (no rules) and `github-pages` (branch policy), both
  `can_admins_bypass: true`;
- collaborators `accd` (`admin`), `MiguelCorre` (`write`), and
  `brunomjanuario` (`write`);
- repository-level secret **names** `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`
  and `VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64`;
- ruleset bypass `[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]`.

The npm registry reported one maintainer, `accd`, and no provenance
attestations on `0.0.0-qualification.2`. No secret value was read. The API does
not expose secret values.

## Protected signing environments and rotation (T5, T11; 2026-09-30)

Base revision: `4e95805586c321a56bcd7b6587a3408e0c175ec3`. The owner authorized
the O2/O3 technical steps. No private key was printed, written, or read back.

| Requirement | Evidence |
| --- | --- |
| CUST-09 environment binding; no signing secret outside its job; no retired repository name | `.github/workflows/t76-publish-release.yml:110` (`environment: tuf-release-signing`), `:240-241` (offline and online environment secrets); `.github/workflows/t76-refresh-timestamp.yml:77`, `:155` (online secret only); `.github/workflows/t75-evidence-signing.yml:51`, `:157`. Guards: `tests/agent-readiness/signing-environments.test.mjs:87` (each signing job binds its environment and reads exactly its secrets), `:100` (no signing secret outside its environment), `:110` (only declared jobs bind a signing environment), `:116` (no retired repository secret, no `*SIGNING_KEY_PKCS8_BASE64` secret reference), `:125` (no `secrets: inherit`, `toJSON(secrets)`, or dynamic index); per-workflow `tests/agent-readiness/t76-publish-workflow.test.mjs:79`, `t76-refresh-workflow.test.mjs:85`, `t75-evidence-signing-workflow.test.mjs:36`. |
| CUST-10 rotation; retired anchors refused for signing; history still verifies | `scripts/t76-signing-custody.mjs:130` (`VES_T76_PUBLISH_ANCHOR_RETIRED` for any anchor carrying `validUntil`, both roles, publish and refresh); `scripts/t75-evidence-attestation.mjs:90-99`, `:235` (sign refused outside the window at `issuedAt` and on the wall clock), `:284` (verify only inside the window); `.github/workflows/t75-evidence-signing.yml:160` (nested reference path refused). Tests: `tests/build/t76-release-publication.test.mjs:243` (anchor for the other role refused), `:260` (retired anchor refused for either role before output), `:275` (committed retired anchors refused, new anchors admitted with the recorded key ids); `tests/build/t76-timestamp-refresh.test.mjs:425`; `tests/security/t75-evidence-attestation.test.mjs:137` (retired reference verifies pre-retirement, refuses post-retirement and backdated signing), `:172` (the committed T75 evidence at `be92397` verifies under `retired/t75-evidence-20260825.json`, not under the new anchor). |
| CUST-11 no key reuse; retired anchors well formed | `tests/security/trust-key-separation.test.mjs:78` (no active anchor carries a window), `:85` (retired anchors named by key id, exact `validUntil`, active successor per role), `:107` (active and retired identities pairwise distinct in key material and key id), `:38` (active identities pairwise disjoint, unchanged). |
| CUST-12 branch dispatch refused by the environment | Observed runs below. |

**Environments (GitHub API, sanitized).**

| Environment | Id | Reviewer | `prevent_self_review` | `can_admins_bypass` | Branch policy | Secret names |
| --- | --- | --- | --- | --- | --- | --- |
| `tuf-release-signing` | `23152805342` | `accd` | `false` | `false` | `["main"]` | `VESTRA_TUF_OFFLINE_KEY_PKCS8_BASE64`, `VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64` |
| `t75-evidence-signing` | `23152805929` | `accd` | `false` | `false` | `["main"]` | `VESTRA_T75_EVIDENCE_KEY_PKCS8_BASE64` |

Repository-level secret names still present (retired values, for the owner to
delete after the merge and the `.3` re-sign):
`VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64`,
`VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64`,
`VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64`.

**Rotated keys.** Active key id, then SHA-256 of the SPKI DER public key:

- offline root/targets: `verchestra-release-20260930-custody`,
  `f120cbbb93391adc3a71d35d74048c148753f755eb228739a3ddada8560ce467`;
- online timestamp/snapshot: `verchestra-release-timestamp-20260930-custody`,
  `0ad7e44bfe1d6b77c683438b9ed1a78b1319f8a8194453bec659d149bd09d6f1`;
- T75 evidence: `t75-evidence-20260930-custody`,
  `67f59b1a43394a506a03c515bd3963c8eb703b760a0dc4bf5198e55a0bb014aa`.

Retired: `verchestra-release-20260825`, `verchestra-release-timestamp-20260930`,
and `t75-evidence-20260825`, each with `validUntil: 2026-09-30T21:25:00.000Z`.

**Environment gate (CUST-12).** Each signing workflow was dispatched on
`feat/408-protected-signing-environments` at `6fa1af6`:

| Workflow | Run id | Conclusion | Steps run | Pending approvals | Annotation |
| --- | --- | --- | --- | --- | --- |
| `t76-refresh-timestamp.yml` | `36779932633` | `failure` | 0 | 0 | `Branch "feat/408-protected-signing-environments" is not allowed to deploy to tuf-release-signing due to environment protection rules.` |
| `t75-evidence-signing.yml` | `36779936595` | `failure` | 0 | 0 | same, for `t75-evidence-signing` |
| `t76-publish-release.yml` | `36779940317` | `failure` | 0 | 0 | same, for `tuf-release-signing` |

No job started, so no secret reached a runner, and no deployment was approved.
The positive path (a `main` dispatch held for approval) is exercised by the
first post-merge `.3` signing run.

**Tooling denials (section 8.1), rerun.** `D1 SIGNING_KEY_MISSING`,
`D2 KEY_MISMATCH`, `D3 KEY_MISMATCH` (the online anchor is committed now),
`D4 ANCHOR_INVALID` (the offline anchor is not reviewed for the online role),
`D5 INPUT_MISSING`, `D6 ANCHOR_RETIRED`, and no publication directory was
created.

## npm publication workflow (T7; 2026-10-28)

`.github/workflows/npm-publish.yml` is the token-less publication path of 3.3,
for #596 item 3. Its guard is `tests/agent-readiness/npm-publish-workflow.test.mjs`:

| Claim | Assertion |
| --- | --- |
| Manual dispatch with exactly `revision`, `publication_run_id`, `version`, `dist_tag`; one run at a time | "the npm publication workflow is manual and takes exactly its four inputs" |
| Top-level `actions: read`, `contents: read`; only the `publish` job, bound to `npm-publication` and needing `verify`, holds `id-token: write`; no other write scope | "only the publish job can mint an OIDC token, and only inside the npm-publication environment" |
| No other workflow binds `npm-publication` or runs `npm publish` | "no workflow other than this one binds npm-publication or runs npm publish" |
| No secret, registry configuration or npm auth variable | "no npm token exists: no secret, no registry-url, no auth variable" |
| `publish` checks out nothing, runs no pnpm, checks the tarball's sha512 against `verify`'s, and runs exactly `npm publish "dist/$TARBALL" --provenance --access public --tag "$DIST_TAG"` | "the publish job runs no repository code and publishes only the verified tarball" |
| `verify` downloads the publication run's pinned inputs and package, rebuilds, `diff -r`s, activates the package from the live endpoint, then packs; no credential persists and no cache is restored | "the verify job rebuilds from the publication run, compares byte for byte, and activates live first" |
| Dispatch inputs reach the shell only through `env` | "dispatch inputs reach the shell only through env" |

Nine faults injected into the workflow, one at a time with the file restored,
each failed the guard: no environment, no `id-token`, no `diff -r`, no
integrity check, no `--provenance`, no live activation, Git credentials
persisted, an input interpolated into a script, and packing the unverified copy.
The integrity-check fault first survived: the ordering assertion compared
positions, and a missing line's position (-1) still counted as "before". The
assertion now also requires the line to exist. The first run of the guard also
caught an earlier draft's own comment naming `registry-url`; the comment was
reworded and the assertion kept.

The workflow has not run: the environment and the npm trusted publisher do not
exist yet (O6).

## Not yet evidenced (owner or human action required)

- The `npm-publication` environment, the npm trusted publisher, and a first
  version published through `npm-publish.yml` with a provenance attestation
  (O6, #596 item 3).

- Ratification of the model by the owner and an independent reviewer (O10).
- Deletion of the retired repository-level secrets (O2 step 4) and the switch
  of both environment reviewers to custodian #2 with self-review prevented.
- The verified permission arrangement (O4-O8).
- The authorized approval rehearsal G1-G6 (O9).
- Accountable human acceptance. Until all four exist, L8 stays as written.

**Owner decision, 2026-10-02.** The owner named no custodian #2 because no
second accountable human is available. The retired repository-level secrets
were deleted on 2026-10-01 (`gh secret list` prints nothing). Everything else
in this list needs custodian #2 and is not evidenced. #408 is closed as not
planned; L8 and the signed hold are unchanged.
