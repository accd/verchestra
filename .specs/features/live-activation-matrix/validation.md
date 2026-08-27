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

  The published `0.0.0-qualification.2` (npm `latest`) pins a release location the
  endpoint does not serve — it is unactivatable, tracked as
  [#387](https://github.com/accd/verchestra/issues/387). There is therefore no
  working second published release to update to and roll back from. The `rollback`
  phase reports `0` only because it re-activates the base; no move *from* `.2` ever
  happened. Live update/rollback is deferred to the `.3` republication, after which
  this workflow re-runs with `update_version=0.0.0-qualification.3`.

## Verification

Re-run: `gh workflow run live-activation-matrix.yml -f base_version=0.0.0-qualification -f update_version=0.0.0-qualification.2`,
then `gh run download <run> --repo accd/verchestra` and read each leg's
`summary.txt` and phase logs. The transcript digests above bind the exact bytes
this record cites.
