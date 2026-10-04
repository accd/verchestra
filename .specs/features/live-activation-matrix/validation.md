# Live activation matrix — run 33087399859

The five-target live-activation lifecycle (#18, L7; workflow #381) run against the
**published npm packages and the live R2 endpoint** — no repository build, no
fixtures. This is the evidence record; it re-executes the live operator procedure
the deterministic gates cannot.

- Workflow: `.github/workflows/live-activation-matrix.yml`
- Run: <https://github.com/accd/verchestra/actions/runs/33087399859>
- Dispatched revision: `cb1eea754ed27b69ae1713ca20c89729f6c512cf`
- Inputs: `base_version=0.0.0-qualification`, `update_version=0.0.0-qualification.2`
- Started 2026-08-27T15:21:57Z, finished 2026-08-27T15:26:03Z

## Per-target result (exit code per phase)

| Target       | activate | update | rollback | self-test | recover | transcript digest (sha256) |
| ------------ | -------- | ------ | -------- | --------- | ------- | -------------------------- |
| win32-x64    | 0        | **70** | 0        | PASS      | 0       | `7549f451…31cc4af`         |
| linux-x64    | 0        | **70** | 0        | PASS      | 0       | `bf0557a4…ef9db465`        |
| linux-arm64  | 0        | **70** | 0        | PASS      | 0       | `17ba8cc0…c6c1e0a549`      |
| darwin-x64   | 0        | **70** | 0        | PASS      | 0       | `b03bd2f1…293a14de09`      |
| darwin-arm64 | 0        | **70** | 0        | PASS      | 0       | `1c7f716d…931978749`       |

Each digest is `sha256` over that leg's ordered phase logs and summary, computed
from the run's uploaded `live-activation-<platform>-<arch>-33087399859` artifact.

## What is proven live, on all five targets

- **Activation.** `npx verchestra@0.0.0-qualification --version` resolves,
  verifies, and activates the pinned release from the live endpoint on every
  target — the live-activation coverage that stood at two of five (`win32-x64`,
  `linux-x64`) is now **five of five**.
- **Self-test.** `self-test --profile smoke` returns `verdict: PASS`,
  `check_count: 6`, `failure_codes: []` on every target, including `win32-x64`
  (the #370 default-Windows-home-directory refusal does not fire from the runner
  working directory).
- **Disaster recovery.** After the managed state root is wiped, re-activation
  from nothing succeeds on every target — the first live recovery on a real
  machine (matrix J10).

## What is NOT proven, and why (honest gap)

- **Live update and rollback.** The `update` phase fails on all five targets:

  ```
  VES_VESTRA_ACTIVATION_UNAVAILABLE: vestra could not resolve and activate its
  pinned verified release (VES_TUF_SOURCE_HTTP).
  ```

  This is **not** an unactivatable package and **not** an endpoint-serving gap.
  Direct probing of the live endpoint confirms every byte `0.0.0-qualification.2`
  needs is served: its metadata chain returns `200`
  (`timestamp.json` → `1.snapshot.json` → `1.targets.json` → `1.components.json`),
  and all 194 component targets — including the 122 MB `runtime/node` — answer an
  exact byte range with `206` and a correct `Content-Range`. A **fresh** install of
  `0.0.0-qualification.2` activates cleanly on all five targets (see run
  33092399993 below).

  The real cause is a **release-process defect**: both `0.0.0-qualification` (v1)
  and `0.0.0-qualification.2` were published with the **same TUF metadata versions**
  (`metadataVersion = 1`; both pin the byte-identical root digest
  `sha256:491673b9…`). Under `consistent_snapshot`, both therefore expose their
  snapshot/targets under the same versioned names (`1.snapshot.json`,
  `1.targets.json`). The update client keeps a persistent TUF metadata cache in the
  shared managed state root; when the second release is activated over the first,
  the client sees the incoming timestamp/snapshot version is unchanged (`1 == 1`),
  reuses the **first** release's cached targets metadata, and resolves the **first**
  release's target hash — then fetches that hash under the **second** release's URL
  prefix, where only the second release's hash exists → `404` → non-`206` →
  `VES_TUF_SOURCE_HTTP`. The failure is symmetric: whichever release is installed
  _second_ fails on the update path.

  So the `rollback` phase reports `0` only because it re-activates the base into a
  cache that already holds the base; no move _from_ the updated release ever
  succeeded. Live update/rollback is deferred to the `.3` republication, which must
  be published with an **incremented** `metadataVersion` (so its
  `2.snapshot.json`/`2.targets.json` force a re-fetch), after which this workflow
  re-runs with `update_version=0.0.0-qualification.3`. Tracked as
  [#387](https://github.com/accd/verchestra/issues/387).

## Corroborating runs

- **Reproduction — run 33091253051**
  (`base=0.0.0-qualification`, `update=0.0.0-qualification.2`): identical to the
  primary run — `activate 0 / update 70 / rollback 0 / self-test PASS / recover 0`
  on all five targets. The update failure is reproducible, not transient (v1's
  post-failure full re-fetch under `recover` succeeds, ruling out rate-limiting or
  a network artifact).
- **Direction experiment — run 33092399993**
  (`base=0.0.0-qualification.2`, `update=0.0.0-qualification`): **fresh
  `0.0.0-qualification.2` activates `0` on all five targets**, and the update _to
  v1_ over it then fails `70`. This proves both that `.2` is fully activatable from
  a clean state and that the defect is the version collision on the update path,
  independent of which release is `latest`.

## Verification

Re-run: `gh workflow run live-activation-matrix.yml -f base_version=0.0.0-qualification -f update_version=0.0.0-qualification.2`,
then `gh run download <run> --repo accd/verchestra` and read each leg's
`summary.txt` and phase logs. The transcript digests above bind the exact bytes
this record cites. To reproduce the endpoint probe, request any metadata file
under `…/v2/<target>/metadata/` (expect `200`) and any target under
`…/v2/<target>/targets/…` with `Range: bytes=0-99` (expect `206`).

## Correction to the recorded next step (2026-09-29, #407)

The section "What is NOT proven, and why" says that live update/rollback is
deferred to `.3`, after which the workflow re-runs with
`update_version=0.0.0-qualification.3`. That plan is superseded. The run record
above is unchanged. What changes is the plan:

- **`.3` cannot be the update target from this base.** A role-separated `.3`
  changes the trust root. Installs of v1 or `.2` cannot update to it in place
  (`VES_TUF_TRUST_ROOT_MISMATCH`; `republish-v3-runbook.md` finding 2).
- **The forward leg needs two releases on the same root.** It needs `.3` plus
  a later release on that root with a higher `metadata_version`.
- **A genuine rollback needs the #393 decision.** Anti-rollback rejects the
  naive re-invocation of the base after a successful update (finding 3).

The current plan is in `handoff.md`.

## Publication of `0.0.0-qualification.3` (2026-10-01, #387)

`.3` is the first release on the role-separated root. It was signed under
protected custody, after #440 moved signing into environments.

| Fact               | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate revision | `6725554a8e14aba44a0dcdb9edf76decc58ac4d2` (now `b173de01799b` on `main`, same tree; see `docs/qualification/history-rewrite-2026-10-01.md`) |
| Candidate build    | run `36781862073`: five target legs and the reconciled closure passed                                                                        |
| Signing            | run `36785647398`, from `main`, approved in environment `tuf-release-signing`                                                                |
| Release id         | `release:verchestra:0.0.0-qualification.3:6725554a8e14`                                                                                      |
| Root digest        | `sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7` (root version 1)                                                   |
| Offline key id     | `f120cbbb93391adc3a71d35d74048c148753f755eb228739a3ddada8560ce467`                                                                           |
| Online key id      | `0ad7e44bfe1d6b77c683438b9ed1a78b1319f8a8194453bec659d149bd09d6f1`                                                                           |
| Metadata version   | `2` for targets, snapshot and timestamp                                                                                                      |
| Base URL           | `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v3/`                                                                                    |
| Rollback proof     | binds the `.2` candidate `3d363f782bad40e5c5be8252e6626216b4f60248`, run `32980992904`                                                       |

Verification before `npm publish`:

- **Upload.** 1275 objects were uploaded under `v3/`. `rclone check` against the
  signed tree reported 1275 matching files and 0 differences.
- **Live endpoint.** Each of the 1275 objects in `publication-manifest.json` was
  requested from the public URL. Every metadata object answered `200` with the
  manifest's SHA-256 and no `Content-Encoding`. Every target answered
  `Range: bytes=0-99` with `206` and a correct `Content-Range`.
- **npm package.** A local `build:vestra-launcher --release-inputs` build was
  byte-identical to the workflow's verified launcher package.
- **Fresh install.** With an empty home and an empty npm cache,
  `npx verchestra` (npm `latest` = `0.0.0-qualification.3`) activated
  `release:verchestra:0.0.0-qualification.3:6725554a8e14`, listed every
  installed command, and `self-test --profile smoke` reported `PASS`
  (macOS arm64).

After `.3` became `latest`, the superseded `0.0.0-qualification` (bucket root)
and `.2` (`v2/`) objects were removed from the bucket, on the owner's
instruction. Those two npm versions can no longer activate. Their original run
artifacts expire on 2026-11-24.

What this does **not** prove: an update or a rollback. Both need a second
release on this root (`.4`). See `handoff.md`.

## TUF publication of `0.0.0-qualification.4` (2026-10-01, #387)

`.4` is the second release on the role-separated root, so a `.3` install can
update to it in place.

| Fact               | Value                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Candidate revision | `d58a25f3d80a720000bbdd4cbbc8650cdc8c9686` (`main`)                                             |
| Candidate build    | run `36928077854`: five target legs and the reconciled closure passed                           |
| Signing            | run `36930995598`, from `main`, approved in environment `tuf-release-signing`                   |
| Release id         | `release:verchestra:0.0.0-qualification.4:d58a25f3d80a`                                         |
| Root digest        | `sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7` (unchanged from `.3`) |
| Metadata version   | `3` for targets, snapshot and timestamp                                                         |
| Base URL           | `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v4/`                                       |
| Rollback proof     | binds the `.3` candidate `6725554a8e14aba44a0dcdb9edf76decc58ac4d2`, run `36781862073`          |

Verification:

- **Upload.** 1275 objects under `v4/`; `rclone check` reported 1275 matching
  files and 0 differences.
- **Live endpoint.** 1275 of 1275 objects answered as the manifest records:
  `200` with the SHA-256 for metadata, `206` byte ranges for targets.
- **npm package.** A local `build:vestra-launcher --release-inputs` build was
  byte-identical to the workflow's verified launcher package.
- **Update and rollback, macOS arm64, against the live endpoint.** With one
  empty home: the `.3` launcher activated `.3`; the `.4` launcher then
  activated `.4`; the `.3` launcher then re-activated `.3` with exit `0`
  (the retained-release path, AD-036); the `.4` launcher activated `.4`
  again. The active pointer matched the expected release digest after each
  step.

Done on 2026-10-02: the owner published the `.4` launcher to npm, and the
five-target `live-activation-matrix` run with base `.3` and update `.4` is
recorded in the next section.

## Live update and rollback on all five targets — run 36997576112 (2026-10-02, #387)

The first live run between two releases on one trust root, both built from a
revision that carries AD-036. It closes the update/rollback leg that run
33087399859 left open.

- Workflow: `.github/workflows/live-activation-matrix.yml`
- Run: <https://github.com/accd/verchestra/actions/runs/36997576112>
- Dispatched revision: `44c1c100ffdaf6764f34d6f00262d695ef126921` (`main`)
- Inputs: `base_version=0.0.0-qualification.3`,
  `update_version=0.0.0-qualification.4`
- Started 2026-10-02T10:49:12Z, finished 2026-10-02T10:57:13Z
- Packages: `verchestra@0.0.0-qualification.3` and
  `verchestra@0.0.0-qualification.4` from the public npm registry (`.4` is
  `latest`, tarball shasum `39b6930385a5fd9d8c9d8a0b6420be9f7a269c6e`); release
  bytes from the live R2 endpoint (`v3/` and `v4/`).

### Per-target result (exit code per phase)

| Target       | activate | update | rollback | self-test | recover | overall |
| ------------ | -------- | ------ | -------- | --------- | ------- | ------- |
| win32-x64    | 0        | 0      | 0        | PASS      | 0       | 0       |
| linux-x64    | 0        | 0      | 0        | PASS      | 0       | 0       |
| linux-arm64  | 0        | 0      | 0        | PASS      | 0       | 0       |
| darwin-x64   | 0        | 0      | 0        | PASS      | 0       | 0       |
| darwin-arm64 | 0        | 0      | 0        | PASS      | 0       | 0       |

### Active pointer after each phase

The workflow records `active.json` after `activate`, `update` and `rollback`.
The release ids are `release:verchestra:0.0.0-qualification.3:6725554a8e14`
(base) and `release:verchestra:0.0.0-qualification.4:d58a25f3d80a` (update) on
every target. The release digests differ per target:

| Target       | after activate and after rollback (`.3`) | after update (`.4`)        |
| ------------ | ---------------------------------------- | -------------------------- |
| win32-x64    | `sha256:abb36c03…d249345d`               | `sha256:9017bd8c…e3d7a0a3` |
| linux-x64    | `sha256:4d37e19f…4ccdfb0c`               | `sha256:f946315d…cf33ced5` |
| linux-arm64  | `sha256:1917895c…fa8b0295`               | `sha256:7a83a32c…657b7864` |
| darwin-x64   | `sha256:006af2c0…591def37`               | `sha256:2337d44b…f194e712` |
| darwin-arm64 | `sha256:ad0b8f9b…30ea21b9`               | `sha256:3ffe9a7f…a31d8fb3` |

On every target `rollback.active.json` is byte-identical to
`activate.active.json`, and `update.active.json` names `.4`. The rollback
therefore did not pass trivially: the update moved the pointer and the rollback
restored it.

### Transcripts

Each leg uploaded `live-activation-<target>-36997576112` (phase logs, the three
pointer files and `summary.txt`). The artifact digest is the one GitHub records
for the uploaded archive; the summary digest is `sha256` of `summary.txt`.

| Target       | Artifact digest (sha256)                                           | `summary.txt` (sha256)                                             |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| win32-x64    | `becfee54735f6751355ec74d4fb4208fc558089aa3f3b8594645973d80bd4222` | `b1073a660a724ea6c501dd8727064563adc89253a1e2babf0b117cb722ce7261` |
| linux-x64    | `aec4582413caf116035b22e5a4c00621c7d9a4875583fb4c7f8af71a2769b94a` | `a1ca2f80b94a0161d1dd8354e0172cf6970a1f9ced825269dc21f5672b0f8a01` |
| linux-arm64  | `0ab4b7c2912d2baf44c3253945a3f0aa282c71e431d21c86e1bfddc4c5734359` | `518a55cbec9d101391bcdb9de93efbe38ec849ef8f35df4ddbf386fd07f56fb0` |
| darwin-x64   | `11fd7a03a25473ece205c5624d06d05a58b7afbe85f9493147846eff190eec6c` | `70b0bbe5c2292e489739aa3c05c07f3a661b0e569dc8374a8daca9482987dcf8` |
| darwin-arm64 | `8e43a98e22d8a89a19b87f455d8052cc6df193218428788269e7bb78c6e14b14` | `8e56339145c15c0ee5a84916fc0bb2be5b0b75ede8c2fa149825e13395a4ad5b` |

The artifacts expire on 2026-11-01; until then `gh run download 36997576112`
reproduces them.

### What is proven live, on all five targets

- **Update in place.** A machine that activated `.3` activated `.4` with exit
  `0`. The two releases share one trust root and `.4` carries a strictly
  greater metadata version, so the metadata-version collision of #387 does not
  occur.
- **Rollback.** Re-invoking the `.3` launcher after the update exits `0` and
  restores the base pointer byte for byte. This is the retained-release path
  (AD-036): anti-rollback is unchanged, and the launcher re-activates a
  release this machine already verified.
- **Self-test.** `self-test --profile smoke` returns `verdict: PASS`,
  `check_count: 6`, `failure_codes: []` on every target.
- **Recovery.** After the managed state root is wiped, activation from nothing
  exits `0` on every target.

### What this does not prove

- The source-side roll-forward (a new forward publication whose targets point
  at an older release's bytes). No such publication exists.
- An uninstall or purge against a live install. That part of J02 stays proven
  deterministically (`tests/e2e/installer-lifecycle-matrix.test.mjs`).
- Anything about custody: one operator signed and published both releases
  (acceptance matrix L8).

## TUF publication of `0.0.0-qualification.5` (2026-10-02)

`.5` is the third release on the role-separated root. It carries subscription
provider authentication (ADP-A) and the architecture deepening work merged up to
`e17abb3` (ADP-1, ADP-2, ADP-3, ADP-5 to ADP-8).

| Fact               | Value                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Candidate revision | `e17abb3c8970b72c837bbbd07f86b4676ca9adb3` (`main`)                                             |
| Candidate build    | run `37017865729`: five target legs and the reconciled closure passed                           |
| Signing            | run `37039015199`, from `main`, approved in environment `tuf-release-signing`                   |
| Release id         | `release:verchestra:0.0.0-qualification.5:e17abb3c8970`                                         |
| Root digest        | `sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7` (unchanged from `.4`) |
| Metadata version   | `4` for targets, snapshot and timestamp                                                         |
| Base URL           | `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v5/`                                       |
| Rollback proof     | binds the `.4` candidate `d58a25f3d80a720000bbdd4cbbc8650cdc8c9686`, run `36928077854`          |

Custody, stated as it happened: the environment approval was submitted through
the owner's GitHub credential by the agent session, at the owner's explicit
instruction in that session on 2026-10-02. One operator dispatched and approved;
the posture is single-operator custody (acceptance matrix L8, RR10).

The ledger entry is the `ledger-entry.json` the publication run derived
(`admitRelease`, AD-042), appended verbatim as sequence 5. This is the first
real dispatch of that derivation.

Verification:

- **Assembly.** Each of the 1330 objects was hashed locally against
  `publication-manifest.json` (digest and size) before upload: 1330 matched.
- **Upload.** 1330 objects under `v5/`; `rclone check` reported 1330 matching
  files and 0 differences.
- **Live endpoint.** 1330 of 1330 objects answered as the manifest records:
  `200` with the SHA-256 for metadata, `206` byte ranges for targets.
- **npm package.** A local `build:vestra-launcher --release-inputs` build at
  the candidate revision was byte-identical to the workflow's verified launcher
  package.
- **Update and rollback, macOS arm64, against the live endpoint.** With one
  empty home: the `.4` launcher activated `.4`; the `.5` launcher then
  activated `.5`; the `.4` launcher then re-activated `.4` with exit `0` (the
  retained-release path, AD-036); the `.5` launcher activated `.5` again. The
  active pointer then named `.5` with the manifest's `darwin-arm64` release
  digest. `self-test --profile smoke` returned `verdict: PASS`.

Done on 2026-10-02: the owner published the `.5` launcher to npm (`latest`,
tarball shasum `51a52567dfc4c87a272778ab9a684b8a922e8d9b`), and the
five-target run with base `.4` and update `.5` is recorded in the next
section.

## Live update and rollback `.4` to `.5` on all five targets — run 37047903756 (2026-10-02)

- Workflow: `.github/workflows/live-activation-matrix.yml`
- Run: <https://github.com/accd/verchestra/actions/runs/37047903756>
- Dispatched revision: `a59ebc50b2f323ade2ce81ff3b273e451502b710` (`main`)
- Inputs: `base_version=0.0.0-qualification.4`,
  `update_version=0.0.0-qualification.5`
- Started 2026-10-02T18:30:31Z, finished 2026-10-02T18:39:00Z

Every phase exits `0` on every target: activate, update, rollback, self-test
smoke (`verdict: PASS`), and recover.

| Target       | after activate and after rollback (`.4`) | after update (`.5`)        |
| ------------ | ---------------------------------------- | -------------------------- |
| win32-x64    | `sha256:9017bd8c…e3d7a0a3`               | `sha256:ffccd4ca…6762a68f` |
| linux-x64    | `sha256:f946315d…cf33ced5`               | `sha256:a70fa90e…5328bc9e` |
| linux-arm64  | `sha256:7a83a32c…657b7864`               | `sha256:a8165329…0e0fa45a` |
| darwin-x64   | `sha256:2337d44b…f194e712`               | `sha256:70338b0b…f48a9e6b` |
| darwin-arm64 | `sha256:3ffe9a7f…a31d8fb3`               | `sha256:2f5606f9…a5ee1877` |

On every target `rollback.active.json` is byte-identical to
`activate.active.json`, and `update.active.json` names `.5`. The `.4` digests
are the ones run 36997576112 recorded after its update to `.4`, so the two
runs agree on what `.4` is.

| Target       | Artifact digest (sha256)                                           | `summary.txt` (sha256)                                             |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| win32-x64    | `659a29a96139305e2ae600f20536e2255dd01c1725fbb8562b204b72cf24f2a4` | `dd457926d992a578654d1e1d94adb1285922bbf592be4e39f26338e0b32cc0d1` |
| linux-x64    | `9bb4f5e04cca06daa11631a70fb86358aef43e5a68dd734045e8624f971039c0` | `eeab8ed8365a1d977713b03cab2b367b5d15ca5edbfffa190a24328292eab1cc` |
| linux-arm64  | `38f4f34e24b17b55fd02d179c6ef43908bd4248ce93ec8f1a144a9b591481643` | `2bc08eea5a3f4c154570cf9a008af817b37b85c2bb29e09601dd68de52bd08e6` |
| darwin-x64   | `6ea18087ddb5ed00fafe118a494e1e9344467a994e3ece10a5fc8a4e918cbe1e` | `b431ea4332ab816f5d20cb24e38a9efc9e620b89da04abd9bf4076347b802cf7` |
| darwin-arm64 | `039f18d30f113509351514198f66aa44a1e7587641d55407396bafe74e370899` | `7959130bd9f837441fda11f5337f178ebc6f60c17e9ae91ace13633a74bd6500` |

The artifacts expire on 2026-11-01. What this run does not prove is unchanged
from run 36997576112: no source-side roll-forward, no live uninstall, and
single-operator custody (L8). It also says nothing about the governed task
path: `self-test --profile smoke` does not start a provider.

## TUF publication of `0.0.0-qualification.6` (2026-10-03)

`.6` is the fourth release on the role-separated root. Over `.5` it carries the
protected-path security fix (#485), process-tree termination of the providers
(ADP-4), both architecture deepening rounds, the run's complete usage account,
the driver fixes found along the way, and the dependency updates through
#510 (Pi runtime 0.99.1).

| Fact               | Value                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- |
| Candidate revision | `7e274f237648251b972081471134623097122c16` (`main`)                                    |
| Candidate build    | run `37139943097`: five target legs and the reconciled closure passed                  |
| Signing            | run `37147832135`, from `main`, approved in environment `tuf-release-signing`          |
| Release id         | `release:verchestra:0.0.0-qualification.6:7e274f237648`                                |
| Root digest        | `sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7` (unchanged)  |
| Metadata version   | `5` for targets, snapshot and timestamp                                                |
| Base URL           | `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v6/`                              |
| Rollback proof     | binds the `.5` candidate `e17abb3c8970b72c837bbbd07f86b4676ca9adb3`, run `37017865729` |

Custody, stated as it happened: the environment approval was submitted through
the owner's GitHub credential by the agent session, at the owner's instruction
in that session on 2026-10-03. The posture is single-operator custody
(acceptance matrix L8, RR10).

The ledger entry is the `ledger-entry.json` the publication run derived
(`admitRelease`, AD-042), appended verbatim as sequence 6.

Verification:

- **Assembly.** All 1365 objects were hashed locally against
  `publication-manifest.json` (digest and size) before upload: 1365 matched.
- **Upload.** 1365 objects under `v6/`; `rclone check` reported 1365 matching
  files and 0 differences.
- **Live endpoint.** 1365 of 1365 objects answered as the manifest records.
- **npm package.** A local `build:vestra-launcher --release-inputs` build at
  the candidate revision was byte-identical to the workflow's verified
  launcher package.
- **Update and rollback, macOS arm64, against the live endpoint.** With one
  empty home: `.5` activated `.5`; `.6` activated `.6`; `.5` re-activated `.5`
  with exit `0` (the retained-release path, AD-036); `.6` activated `.6` again.
  The active pointer named the manifest's `darwin-arm64` release digest
  (`sha256:8601098a…cac8c8f03`). `self-test --profile smoke` returned
  `verdict: PASS`.

The owner published the `.6` launcher to npm on 2026-10-03 with two-factor
authentication. The registry serves it as `latest`, with `dist.integrity`
`sha512-8QutpuCS9om+z8hLqJgrayRB6pIqnvABooQfrxS8IUCG2IBG9Cut6tDZVK6xhYBKJ2/LxVJKTZw6W8FoIpNP7Q==`.
The five-target run follows.

## Live update and rollback `.5` to `.6` on all five targets — run 37152404760 (2026-10-03)

- Workflow: `.github/workflows/live-activation-matrix.yml`
- Run: <https://github.com/accd/verchestra/actions/runs/37152404760>
- Dispatched revision: `dc35c52254a338e4f4f631d2abb748629ece6eb6` (`main`)
- Inputs: `base_version=0.0.0-qualification.5`,
  `update_version=0.0.0-qualification.6`
- Started 2026-10-03T20:40:53Z, finished 2026-10-03T20:48:37Z

Every phase exits `0` on every target:

- activate;
- update;
- rollback;
- self-test smoke, with `self_test.verdict: PASS` and 6 checks;
- recover.

| Target       | after activate and after rollback (`.5`) | after update (`.6`)        |
| ------------ | ---------------------------------------- | -------------------------- |
| win32-x64    | `sha256:ffccd4ca…6762a68f`               | `sha256:4862afca…12399689` |
| linux-x64    | `sha256:a70fa90e…5328bc9e`               | `sha256:5dce9a4a…0a07209f` |
| linux-arm64  | `sha256:a8165329…0e0fa45a`               | `sha256:d7276d40…2a179e7f` |
| darwin-x64   | `sha256:70338b0b…f48a9e6b`               | `sha256:45410ada…b313951b` |
| darwin-arm64 | `sha256:2f5606f9…a5ee1877`               | `sha256:8601098a…ac8c8f03` |

The evidence was checked by content, after downloading the five artifacts:

- On every target, `rollback.active.json` is byte-identical to
  `activate.active.json`.
- `update.active.json` names `release:verchestra:0.0.0-qualification.6:7e274f237648`.
- Each `.6` digest is the `releaseDigest` that the `.6` `publication-manifest.json`
  records for the same target.
- The `.5` digests are the ones run 37047903756 recorded after its update to
  `.5`, so the two runs agree on what `.5` is.

| Target       | Artifact digest (sha256)                                           | `summary.txt` (sha256)                                             |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| win32-x64    | `6521c22b3f579323ca968dbc8e15c3f99e609765a31aa777a2b01c16ba494a76` | `28182dbbe866a51c2b573b0e7e3e943ca8ec08a46bfec76f3122c75bfa28f9f6` |
| linux-x64    | `df289978331cfb4e1064910154095167e165329eed139eb6cf63cb3c241a5668` | `d1ef15d595dc3795f3117f89c5ab845f05a632697ea24f9112817a4ef3960c9e` |
| linux-arm64  | `a4f18ccb368a5305ea8516237d9384ce518eb7f56c29fdc4a364e4942bff521c` | `1b6da6d36be1500bf0da683a12ce437e6a8a56b56f89115852411d170fb8596f` |
| darwin-x64   | `57e4ae0f699b6e7dcf73d5f1aeeba1c30f22d30946c398900ef7f02acf716a41` | `c0579c1c536fa217e6ca2ba1f767853e8ce1cdb679afe9a678d842e096a4e151` |
| darwin-arm64 | `a1c465aa75aff4fde8d71b9938a907074c5f1a48bf2526c2e48be2a456306cac` | `a1c97d3d073d2b70967a0edbee80aa34a3835e5ced5ce5e8064b37e8c5897cdf` |

The artifacts expire on 2026-11-02. What this run does not prove is unchanged
from run 36997576112:

- no source-side roll-forward;
- no live uninstall;
- single-operator custody (L8).

It also says nothing about the governed task path, because
`self-test --profile smoke` does not start a provider. The planned evidence
for that path is the live task pilot (#406) on `.6`, which has not run yet.

## TUF publication of `0.0.0-qualification.7` (2026-10-04)

`.7` is the fifth release on the role-separated root. Over `.6` it carries:

- the Strands subscription integration (T1–T10): coordinated `agent`, `graph`
  and `swarm` runs on subscriptions only, with suspension on a quota signal,
  resume and reconciliation;
- the governed task path on Windows over the named-pipe bridge;
- every remediation of the two independent verifications (R1–R7);
- the test suites' temporary-directory guard.

| Fact               | Value                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- |
| Candidate revision | `2e97443ea60192464cddfefe2c55dc9c625a975e` (`main`)                                    |
| Candidate build    | run `37227328549`: five target legs and the reconciled closure passed                  |
| Signing            | run `37233733016`, from `main`, approved in environment `tuf-release-signing`          |
| Release id         | `release:verchestra:0.0.0-qualification.7:2e97443ea601`                                |
| Root digest        | `sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7` (unchanged)  |
| Metadata version   | `6` for targets, snapshot and timestamp                                                |
| Base URL           | `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v7/`                              |
| Rollback proof     | binds the `.6` candidate `7e274f237648251b972081471134623097122c16`, run `37139943097` |

Two earlier candidate builds of this release, runs `37211970828` and
`37219409058`, failed on Windows x64 in one named-pipe security case. The
case was `win32: a frame beyond its bound on the named pipe is refused`, and
it failed intermittently. The PowerShell relay read a 131,072-byte block and
did not forward it, so the controller's refusal never fired. Remediation R6
traced it and R7 fixed it in the strands-subscription-integration
validation. No candidate was published from those runs.

Custody, stated as it happened: the agent session submitted the environment
approval through the owner's GitHub credential, at the owner's instruction in
that session on 2026-10-04. The instruction was "ok, prosseguir", to publish
`.7`. The posture is single-operator custody (acceptance matrix L8, RR10).

The ledger entry is the `ledger-entry.json` the publication run derived
(`admitRelease`, AD-042), appended verbatim as sequence 7.

Verification:

- **Assembly.** All 1470 objects (25 metadata, 1445 targets) were hashed
  locally against `publication-manifest.json`, by digest and size, before
  upload. All 1470 matched.
- **Upload.** 1470 objects were uploaded under `v7/`. `rclone check` reported
  1470 matching files and 0 differences.
- **Live endpoint.** All 1470 objects answered as the manifest records.
- **npm package.** A local `build:vestra-launcher --release-inputs` build at
  the candidate revision was byte-identical to the workflow's verified
  launcher package, version `0.0.0-qualification.7`.
- **Update and rollback, macOS arm64, against the live endpoint.** With one
  empty home, in order:
  - `.6` activated `.6`;
  - the `.7` launcher activated `.7`;
  - `.6` re-activated `.6` (the retained-release path, AD-036);
  - `.7` activated `.7` again.

  The active pointer named the manifest's `darwin-arm64` release digest
  (`sha256:411f7441…5d3bbdd8`). `self-test --profile smoke` returned
  `verdict: PASS`.

Not yet done:

- `npm publish` of the `.7` launcher, the owner's two-factor step;
- the five-target `live-activation-matrix` run with base `.6` and update `.7`.
