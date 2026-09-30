# Single-Binary Distribution Qualification (#236)

**Channel:** `vestra` single executable, one per target
**Status:** Implemented. Proven on the darwin-arm64 build host. All five native
legs passed in tests-only mode on the #236 Windows fix branch (run
36677942597). Pending: the merge-revision and reviewed-input dispatches, and
every owner signing action.
**Release state:** unchanged. Verchestra is `0.0.0-qualification`. The signed
1.0.0 decision (`docs/qualification/release-decision-1.0.0.md`) is a **reject**
(a recorded hold), and this report does not change it. A single binary is a
second distribution channel, and like the first it is its own qualification
surface. Nothing here is a release, a promotion, or a production-readiness
claim.

## What the channel is

Each binary is the official Node 24.14.0 executable for its target with a
Node single executable application (SEA) blob injected into it. The blob holds
two things:

- the launcher bootstrap, bundled as CommonJS from
  `apps/vestra-launcher/closure/single-binary-main.ts`;
- the reviewed pinned inputs (`config/release-source.json` and
  `config/root.json`), embedded as SEA assets.

The bootstrap is the npm launcher's own: the same host gate, pinned-input
contract, TUF activation closure, and shell-free handoff. It runs on the
embedded runtime, so no `node`, npm, or `PATH` entry is involved at any point.
A lone `--version` is answered from the embedded inputs, and every other
argument vector goes to the activated release exactly as given.

Design, options, and the signing implications are in
`.specs/features/single-binary-distribution/design.md`. Requirements SBD-01 to
SBD-12 are in `spec.md`, and their evidence mapping is in `validation.md`.

## Qualified identity

| Component | Value |
| --- | --- |
| Embedded runtime | Node 24.14.0, the official nodejs.org build per target |
| Runtime pins | `apps/vestra-launcher/single-binary/node-runtime.json`, recorded from `https://nodejs.org/dist/v24.14.0/SHASUMS256.txt` |
| Blob generator | the pinned runtime's `--experimental-sea-config` (no `postject`, no new dependency) |
| SEA settings | `useCodeCache: false`, `useSnapshot: false`, `disableExperimentalSEAWarning: true`, `execArgvExtension: "none"` |
| Injector | `scripts/sea-inject.mjs` (Mach-O segment, ELF note segment, PE `RT_RCDATA` resource, sentinel fuse) |
| Build | `pnpm build:vestra-binary -- --target <key> --node-cache <dir> --release-inputs <dir> --out <dir>` |
| macOS signature | ad hoc (`codesign --sign - --identifier vestra`), with no identity or timestamp |
| Windows signature | none. The official Authenticode table is removed, because injection invalidates it. |

## Proven locally

All of this was proven on a darwin-arm64 build host running the pinned
Node 24.14.0, whose runtime archive and executable match their pins.

| Claim | Evidence | Result |
| --- | --- | --- |
| Two builds from identical inputs are byte-identical, across the executable, the manifest, and the license closure | `tests/build/vestra-binary.test.mjs`: "two builds from identical inputs emit byte-identical trees" | PASS |
| The manifest names the verified runtime, the launcher bundle, the embedded blob, the embedded assets, and every license file, with no machine-local path | same file: "the manifest names the verified runtime, …" | PASS |
| With `PATH` empty and a hostile `NODE_OPTIONS`, `--version` is answered by the embedded runtime with nothing on stderr | same file: "with PATH emptied, --version is answered by the embedded runtime alone" | PASS |
| With `PATH` empty and `HOME` redirected, a run reaches the real TUF activation path: it anchors the embedded, signed fixture root and dials the pinned source | same file: "with PATH emptied, a run anchors the embedded trust root and reaches the pinned TUF source" | PASS |
| A runtime, archive, or `LICENSE` that does not match its pin is refused, and so are inputs the launcher would refuse. A refused build leaves nothing behind. | same file, plus `tests/unit/node-runtime-archive.test.mjs` | PASS |
| Every injection branch and every fail-closed branch, on synthetic Mach-O, ELF, and PE executables | `tests/unit/sea-inject.test.mjs` | PASS |
| The injected PE obeys the rules the Windows loader enforces, checked by a reader independent of the injector | `tests/helpers/pe-loader-checks.mjs`, used by `tests/unit/sea-inject.test.mjs` and, on the Windows leg, by `tests/build/vestra-binary.test.mjs` | PASS |
| The embedded-input reader, the lone-`--version` rule, and verbatim argument passthrough | `tests/unit/vestra-single-binary-bootstrap.test.mjs` | PASS |
| The workflow is manual, read-only, SHA-pinned, fleet-bound, and cannot publish | `tests/agent-readiness/single-binary-workflow.test.mjs` | PASS |
| A discrimination sensor over the injector, the runtime verification, the bootstrap, and the build | 11 mutants, listed in `validation.md` | 11 killed, 0 survived |

The following were also observed by hand on the same host. They are recorded
here but are not gate evidence.

- The builder emitted **all five** targets from their pinned archives, and
  `locateSeaBlob` recovered the exact blob from each.
- The darwin-x64 binary ran under Rosetta 2, and the linux-arm64 binary ran in
  an Ubuntu 22.04 (glibc 2.35) container. Each printed its `--version` and
  reached the activation path with `PATH` empty.
- The win32-x64 resource tree was read back by an independent PE parser. It
  showed every original resource, plus `RT_RCDATA/NODE_SEA_BLOB`. The image
  checksum matched that parser's value. That was not enough: see "Windows
  loader fix" below.
- The archive route and the installed-runtime route produced byte-identical
  executables.

## Windows loader fix

The first fleet dispatch on `main` (run 36675382810) passed four legs. On
Windows x64 both PATH-emptied cases failed with `spawn EFTYPE`
(ERROR_BAD_EXE_FORMAT). The injector had moved the resource tree into a new
section but left every existing resource's bytes in `.rsrc`, and Windows
refuses to start an image whose resource data lies outside the section that
holds the resource directory. A bisection of `node.exe` variants on the Windows
runner isolated that rule. The steps are recorded in
`.specs/features/single-binary-distribution/validation.md` § T8.

The injector now copies every resource's bytes into the new section beside the
tree and the blob. The locator refuses any other layout. Run 36677942597 then
passed on all five legs, 50 tests each with 0 skipped. Mach-O and ELF bytes
did not change.

## Pending

| Item | Owner | How it closes |
| --- | --- | --- |
| Native execution on darwin-x64, linux-x64, linux-arm64, and win32-x64, at the merge revision | CI | Run 36677942597 passed all five legs on the fix branch. Dispatch `.github/workflows/single-binary-build.yml` again at the merge revision. Each leg fetches its pinned archive, verifies it, and runs the four single-binary suites with zero skips allowed. |
| Binaries built from the **reviewed** pinned inputs, and reconciled across all five targets | CI + owner | Dispatch the same workflow with `release_inputs_revision` and `release_inputs_run_id` naming a `t76-publish-release` run. |
| A real activation and handoff against the live release source from a reviewed binary | Owner | Run a reviewed binary against the published TUF endpoint on each target. |
| macOS Developer ID signing with the hardened runtime and V8's JIT entitlements, then notarization and stapling | Owner | Owner-held identity. See `design.md` § Code signing. Each step changes the bytes, so each needs its own digest record. |
| Windows Authenticode signing with a timestamp | Owner | Owner-held certificate. The signed digest is recorded separately. |
| Signed provenance and SBOM attestations per artifact | Owner | The manifest carries the unsigned facts. Signing them needs an owner-held identity, which this workflow does not request. |
| Offline, rollback, and update evidence for this channel | Future work | The channel reuses the qualified activation closure, but its own offline, rollback, and update journeys are not yet recorded. |

## Verdict

The channel is implemented and proven on its build host. It is **not**
qualified across the fleet. It stays unqualified until the pending native legs
pass and the owner's signing actions are done and recorded. It is not part of
any release decision.
