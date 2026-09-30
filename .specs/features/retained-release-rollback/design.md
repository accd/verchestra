# Retained Release Rollback Design (#393)

Decision record: `.specs/STATE.md` AD-036. This document holds the threat model,
the pre-mortem, and the mechanics.

## Threat model

### Assets

- **Release authority.** Only a release whose bytes a TUF resolution under the
  packaged trust root verified may ever execute.
- **Anti-rollback.** A client must never accept remote metadata older than the
  metadata it already trusts.
- **Last-known-good.** The `active.json` pointer always names a byte-valid,
  health-checked, installed release.

### Adversaries and their reach

| Adversary                         | Reach                                                                                                         | In scope                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network or mirror attacker        | Serves any bytes at the pinned metadata and target URLs, including replayed, older, correctly signed metadata | Yes                                                                                                                                                                                      |
| Compromised or mistaken publisher | Publishes a release under the same root that is later found vulnerable                                        | Yes, as a residual risk                                                                                                                                                                  |
| Social engineer                   | Persuades a user to run an older `verchestra@<version>`                                                       | Yes                                                                                                                                                                                      |
| Same-user local attacker          | Writes files under the user's home directory, including the state root and npm's npx cache                    | No. Such an attacker already replaces the cached launcher (`lib/bootstrap.js`) and executes arbitrary code on the next `npx` run. The new records add no capability that attacker lacks. |

### Trust boundaries

1. The npm tarball pins `releaseId`, `semanticVersion`, `rootDigest`, and the
   root bytes. `loadPinnedInputs` proves the root bytes match `rootDigest`.
2. `TufUpdateClient.#bootstrapTrust` anchors that root once per trust directory
   (`bootstrap-root.sha256`) and refuses to replace it.
3. `TransactionalActivationManager` owns the install root under an exclusive
   lock. Installed bundles are re-hashed against their recorded digests before
   every use.

### What the local path trusts, and why that is not new trust

The local path trusts the verified-release record the manager wrote after a
TUF-verified activation. The existing network path already trusts the same
install root in the same way: `activate()` reuses an installed release by
reading its `release.json` and re-hashing its files, and the record is written
under the same lock, with the same atomic rename, into the same root. The only
new fact the record carries is _which trust root verified this digest_, which is
exactly the fact needed to refuse a cross-root re-activation.

### Security properties the change must hold

- **P1 No network on the local path.** The choice is made from local state and
  the pinned inputs before any source is read, so no remote response can trigger
  it, and it performs zero reads.
- **P2 No new authority.** Only a digest recorded after a TUF-verified
  activation under the _same_ pinned root, still installed, can be
  re-activated. A never-installed release has no record and goes to the
  network, where anti-rollback rejects older metadata.
- **P3 Bytes, not names.** The installed manifest must verify, every component
  must re-hash to its recorded digest, the bundle must target this host, and
  the recorded identity must equal the installed identity. Any failure is fail
  closed, never a network fallback that could mask tampering.
- **P4 Health.** The observed health gate runs before the pointer moves.
- **P5 Steady state is unchanged.** The most recently verified release under a
  root keeps the network path, so metadata expiry and publisher revocation stay
  observed for it exactly as before.

### Residual risks (accepted, documented)

- **R1 Revocation of a superseded release is not observed locally.** If the
  publisher revokes A after the machine moved to B, re-invoking launcher A
  re-activates the retained A without consulting the source. Mitigation:
  deleting the managed state root (the README's documented cleanup) or a
  purging uninstall removes every retained release and record;
  the TUF-correct way to withdraw A for everyone is a new forward publication.
- **R2 Metadata expiry does not apply to a superseded retained release.** The
  local path reads no metadata, so A's timestamp or targets expiry is not
  re-checked. Freeze attacks need a network response; the local path has none.
- **R3 A user can be persuaded to run an older launcher.** They re-activate only
  a release this machine already verified and ran. On a fresh machine the same
  persuasion already succeeds today through the network path while A's metadata
  is unexpired, so the marginal exposure is bounded to releases already present.

## Pre-mortem: how could this weaken anti-rollback?

Assume the change shipped and a reviewer later finds it weakened anti-rollback.
Each plausible failure, and the control that prevents it:

| #    | Failure story                                                                                             | Control                                                                                                                    | Evidence                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| PM1  | A replayed older timestamp makes the launcher skip TUF and run old code                                   | The local decision reads no remote input; it runs before the source is touched                                             | Zero-read assertion on a counting source                                    |
| PM2  | A release that was never installed runs after a metadata downgrade                                        | No record means network path; anti-rollback still rejects                                                                  | Never-installed-older test yields `VES_TUF_ROLLBACK`                        |
| PM3  | A release verified under an old or attacker root runs under a new root                                    | Records are keyed by trust-root digest; the local trust anchor must also match                                             | Different-root test: record absent, trust-bound rollback refused            |
| PM4  | Tampered installed bytes run because the local path skips TUF target hashing                              | Every component re-hashes against the installed manifest, and the manifest's release digest must equal the recorded digest | Tampered-bundle test fails closed with the pointer unchanged and zero reads |
| PM5  | A tamper is laundered by a silent network fallback                                                        | A failed local re-activation throws; it never falls back                                                                   | Same test: zero source reads                                                |
| PM6  | Every run of every release skips the network, so expiry and revocation disappear                          | Only a superseded release takes the local path                                                                             | Steady-state test: the latest release still reads the source                |
| PM7  | The local path records its own re-activation as a fresh verification, so a stale release becomes "latest" | `rollback` never writes a record; only a TUF-verified `activate` does                                                      | Record order unchanged after rollback                                       |
| PM8  | Two builds share `releaseId` and `semanticVersion` with different bytes, and the wrong one runs           | An ambiguous match is not retained; the network path decides                                                               | Ambiguity unit test                                                         |
| PM9  | A crash during the pointer switch leaves a mixed pointer                                                  | Rollback journals `PREPARED`/`COMMITTED`; the pointer write is an atomic rename                                            | Rollback crash-point tests                                                  |
| PM10 | A symlink in the record directory redirects the write                                                     | The record directory is inside the install root and passes the real-chain check                                            | Record path uses `ensureRealChain`                                          |
| PM11 | An existing operator rollback caller accidentally becomes trust-bound, or vice versa                      | The trust binding is an explicit option; the closure always passes it                                                      | Closure code and trust-bound rollback tests                                 |

## Mechanics

### Verified-release record

`<installRoot>/verified/<trustRootHex>.json`, written by `atomicJson` under the
activation lock:

```json
{
  "schemaVersion": 1,
  "trustRootDigest": "sha256:…",
  "releases": [{ "releaseId": "…", "releaseDigest": "sha256:…", "semanticVersion": "…" }]
}
```

`releases` is ordered by verification recency: a TUF-verified activation moves
its entry to the end. The last entry is the latest verified release under that
root. Reads are strict (exact keys, digest syntax, unique digests); a malformed
record fails closed with `VES_ACTIVATION_RECORD_INVALID`.

### Closure decision

1. `client.trustAnchored()` reads `bootstrap-root.sha256` without creating
   anything. Absent means the network path; a mismatch fails
   `VES_TUF_TRUST_ROOT_MISMATCH`.
2. `manager.retainedRelease({ trustRootDigest, releaseId, semanticVersion })`
   returns a target only for a unique, installed, superseded match.
3. A target means `manager.rollback(digest, { trustRootDigest })`, reported as
   `network: false`. No target means `resolveAndStage` and
   `manager.activate(staged, { trustRootDigest })`, reported as `network: true`.

### Rollback journal

`rollback` verifies, runs health, writes a `PREPARED` rollback journal, switches
the pointer, writes `COMMITTED`, and removes the journal. There is nothing to
publish, so there is no `PUBLISHED` state. A journal naming a different target
blocks both `activate` and `rollback` with `VES_ACTIVATION_RECOVERY_REQUIRED`,
the rule `activate` already applies.

## Source-side alternative (option 1)

The TUF-correct way to serve an older release to _every_ client is a new forward
publication: a higher metadata version whose targets name the old bytes. This
needs no client change and is how a publisher withdraws a bad release. The
live-activation matrix documents it next to the local path; see
`.specs/features/live-activation-matrix/handoff.md`.
