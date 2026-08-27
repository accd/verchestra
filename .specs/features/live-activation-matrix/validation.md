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

| Target | activate | update | rollback | self-test | recover | transcript digest (sha256) |
| --- | --- | --- | --- | --- | --- | --- |
| win32-x64 | 0 | **70** | 0 | PASS | 0 | `7549f451…31cc4af` |
| linux-x64 | 0 | **70** | 0 | PASS | 0 | `bf0557a4…ef9db465` |
| linux-arm64 | 0 | **70** | 0 | PASS | 0 | `17ba8cc0…c6c1e0a549` |
| darwin-x64 | 0 | **70** | 0 | PASS | 0 | `b03bd2f1…293a14de09` |
| darwin-arm64 | 0 | **70** | 0 | PASS | 0 | `1c7f716d…931978749` |

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
  *second* fails on the update path.

  So the `rollback` phase reports `0` only because it re-activates the base into a
  cache that already holds the base; no move *from* the updated release ever
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
  `0.0.0-qualification.2` activates `0` on all five targets**, and the update *to
  v1* over it then fails `70`. This proves both that `.2` is fully activatable from
  a clean state and that the defect is the version collision on the update path,
  independent of which release is `latest`.

## Verification

Re-run: `gh workflow run live-activation-matrix.yml -f base_version=0.0.0-qualification -f update_version=0.0.0-qualification.2`,
then `gh run download <run> --repo accd/verchestra` and read each leg's
`summary.txt` and phase logs. The transcript digests above bind the exact bytes
this record cites. To reproduce the endpoint probe, request any metadata file
under `…/v2/<target>/metadata/` (expect `200`) and any target under
`…/v2/<target>/targets/…` with `Range: bytes=0-99` (expect `206`).
