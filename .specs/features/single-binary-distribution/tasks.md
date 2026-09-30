# Single-Binary Distribution Tasks (#236)

**Design:** `.specs/features/single-binary-distribution/design.md`
**Status:** T1–T5 and T7 done locally. T6 is the next action (CI dispatch
and owner signing).

## Execution Plan

```
T1 -> T2 -> T3 -> T4 -> T5 -> T7 -> T6
```

## Task Breakdown

### T1: Share one pinned-input contract across channels

**Status:** Done.
**What:** Split pinned-input reading from validation (`readPinnedInputs(reader)`),
let `BootstrapContext` name either a package root or an embedded reader, and
move the npm default package root into `closure/bootstrap-entry.ts`.
**Where:** `apps/vestra-launcher/src/pinned-inputs.ts`,
`apps/vestra-launcher/src/bootstrap.ts`,
`apps/vestra-launcher/closure/bootstrap-entry.ts`.
**Requirements:** SBD-05.
**Done when:** the existing launcher unit, security, e2e, build, and
architecture suites pass unchanged.

### T2: Compose the single-binary bootstrap

**Status:** Done.
**What:** `closure/single-binary-bootstrap.ts` (embedded reader, lone
`--version`, the shared bootstrap with the same closure) and
`closure/single-binary-main.ts` (the side-effect entry).
**Requirements:** SBD-05, SBD-06.
**Tests:** `tests/unit/vestra-single-binary-bootstrap.test.mjs`.

### T3: Verify the pinned runtime and inject the blob

**Status:** Done.
**What:** Runtime pins for five targets
(`apps/vestra-launcher/single-binary/node-runtime.json`), archive and
installation verification (`scripts/node-runtime-archive.mjs`), and the Mach-O,
ELF, and PE injector and locator (`scripts/sea-inject.mjs`).
**Requirements:** SBD-01, SBD-02, SBD-08.
**Tests:** `tests/unit/node-runtime-archive.test.mjs`,
`tests/unit/sea-inject.test.mjs`.

### T4: Build deterministically with a manifest

**Status:** Done.
**What:** `scripts/build-vestra-binary.mjs` (`pnpm build:vestra-binary`). It
takes a verified runtime and validated inputs, runs typecheck, builds a CJS
bundle and a SEA blob, injects the blob, applies an ad-hoc macOS signature,
verifies the result, and emits the license closure and a canonical manifest
with a CycloneDX SBOM. Gate selection routes the new scripts to
`gate:release`.
**Requirements:** SBD-01 to SBD-04, SBD-07 to SBD-09.
**Tests:** `tests/build/vestra-binary.test.mjs`,
`tests/agent-readiness/gate-selection.test.mjs`.

### T5: CI workflow and qualification record

**Status:** Done.
**What:** `.github/workflows/single-binary-build.yml` (manual, read-only, five
native legs, zero skips, artifacts only) with its shape test, plus
`docs/qualification/single-binary-distribution.md` and AD-038 in
`.specs/STATE.md`.
**Requirements:** SBD-10 to SBD-12.
**Tests:** `tests/agent-readiness/single-binary-workflow.test.mjs`.

### T6: Fleet evidence and owner signing

**Status:** Next. This needs an owner or CI dispatch after merge.
**What:**
1. Dispatch `single-binary-build.yml` at the merge revision, first without
   reviewed inputs and then with a `t76-publish-release` run.
2. Record per-leg transcripts in `validation.md`.
3. The owner applies Developer ID signing and notarization on macOS and
   Authenticode signing on Windows, and the signed digests are recorded.

**Requirements:** SBD-09, SBD-10, SBD-11.

### T7: SonarCloud remediation and archive hardening

**Status:** Done.
**What:** Resolve the SonarCloud findings on the #236 pull request without
changing the emitted bytes. `actions: read` moves from the workflow to the one
job that needs it. The regex-based NUL trimming and pax parsing become linear
scans. Nested ternaries are extracted. The pin sort gets an ordinal comparator.
The launcher defaults move into named factories. The pinned-archive reader is
hardened as SBD-13 describes.
**Requirements:** SBD-10, SBD-13.
**Tests:** `tests/unit/node-runtime-archive.test.mjs`,
`tests/agent-readiness/single-binary-workflow.test.mjs`, and
`tests/build/vestra-binary.test.mjs` (byte determinism).
