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

Not yet done: `npm publish` of the `.5` launcher (owner two-factor step), and
the five-target `live-activation-matrix` run with base `.4` and update `.5`.
