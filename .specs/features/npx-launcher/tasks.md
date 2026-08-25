# npx Launcher Tasks

**Design:** `.specs/features/npx-launcher/design.md`
**Status:** In Progress

## Execution Plan

```
T1 -> T2 -> T3 -> T4
```

No task is parallel: each consumes the verified boundary produced by the
previous task, and the integration/security suites share filesystem and
process resources.

## Task Breakdown

### T1: Resolve the verified active launcher

**Status:** Done.

**What:** Add one read-only distribution API that maps the active pointer to
the exact reverified `launcher:vestra` component.
**Where:** `packages/distribution/src/transactional-activation.ts`, matching
integration and security tests.
**Depends on:** None.
**Reuses:** `active()`, `#installedBundle()`, bundle component validation.
**Requirements:** NPX-03, NPX-04.
**Tools:** `apply_patch`, declared Node tests; CodeNavi pointers.
**Tests:** integration + security.
**Gate:** `pnpm gate:security` for the trust-boundary slice; `pnpm gate:quick`
before review.

Done when:

- [x] A valid active release resolves one immutable pointer/path result.
- [x] The resolver uses component identity and manifest logical path, not a
  fixture filename.
- [x] Missing active state, mixed identity, missing/duplicate launcher,
  tampered bytes, and path redirection fail before returning a path.
- [x] Existing activation tests remain unchanged except for additive cases.

Evidence: 44 focused integration/security cases pass with zero failed,
skipped, or todo; five additive resolution cases moved from RED (method
absent) to GREEN. Closed bundle validation already rejects missing/duplicate
canonical launchers before an installed record can be trusted.

### T2: Implement observed activation health and handoff

**Status:** Done.

**What:** Add the real health gate and shell-free child executor used by the
bootstrap.
**Where:** `packages/platform-node/src/activation-launcher-adapters.ts` and
`packages/platform-node/src/activation-launcher-errors.ts`, with unit,
integration, security, and fault suites.
**Depends on:** T1. T76 no longer blocks it: this task *defines* the executable
launcher health protocol that T76's launchers must answer.
**Reuses:** `ActivationHealthGatePort` (satisfied structurally) and the safe
process contract from `gate-commit-adapters.ts`.
**Requirements:** NPX-05, NPX-06, NPX-07.
**Tests:** unit + integration + security + fault.
**Gate:** `pnpm gate:security`.

Done when:

- [x] All health evidence is observed from real staged bytes.
- [x] Arguments never enter a shell command string.
- [x] Exit, signal, timeout, output bound, and process cleanup cases pass.

Evidence: 29 focused cases pass with zero failed, skipped, or todo. The gate
spawns both canonical launchers from the staged release through that release's
own `node-runtime` component, so `bin/*.mjs` never needs a shell on Windows.
Every digest is computed over what a child process actually printed.

Protocol defined here and required of T76: a launcher invoked as
`<runtime> <launcher> --activation-health` must print one JSON object with
exactly `schemaVersion`, `report`, `componentId`, `semanticVersion`, `checks`,
and `behavior`. It does not report the release digest, because that digest is
computed over a manifest containing the launcher's own content digest and the
installed `release.json` does not exist at pre-publication health time; the gate
binds the evidence to the release it actually ran.

### T2 decision for review

The safe process-tree termination routine now exists twice: in
`gate-commit-adapters.ts` (T59) and in `activation-launcher-adapters.ts`.
`design.md` says to *follow* that pattern, and refactoring a qualified security
adapter was out of scope, so it was followed rather than extracted. Extracting
one shared `terminateProcessTree` helper is a reasonable follow-up.

### T3: Build the publishable `vestra` package

**Status:** Artifact contract done; the activation closure remains open.

**What:** Add the minimal public composition root and deterministic tarball.
**Where:** `apps/vestra-launcher/`, `scripts/build-vestra-launcher.mjs`,
`scripts/architecture.mjs`, `scripts/gate-selection.mjs`,
`scripts/gate-stages.mjs`, `scripts/complexity.mjs`, `package.json`,
`docs/repository-map.md`, and architecture/build/security tests.
**Depends on:** T2; T76 root/URLs/source identity; owner confirmation of npm
name control; explicit approval if a build dependency is required.
**Reuses:** TUF/activation APIs at build time; no workspace import at runtime.
**Requirements:** NPX-01, NPX-02, NPX-08, NPX-10.
**Tests:** architecture + build + security.
**Gate:** `pnpm gate:build` and `pnpm gate:security`.

Done when:

- [x] `npm pack --dry-run` and tar inspection match the exact allowlist.
- [x] The artifact contains compiled code and pinned public inputs only.
- [x] No private/workspace/source import or install script remains.

Evidence: 25 focused cases pass with zero failed, skipped, or todo. The
allowlist is ten paths: `LICENSE`, `README.md`, `bin/vestra.mjs`,
`config/release-source.json`, `config/root.json`, `lib/bootstrap.js`,
`lib/pinned-inputs.js`, `lib/public-errors.js`, `lib/supported-host.js`, and
`package.json`. `npm pack --dry-run --json` and a dependency-free reader over
the real `.tgz` both report exactly that set. Two builds from identical inputs
emit byte-identical files. The build refuses to emit without reviewed pinned
inputs, refuses a trust root that does not match its configuration, and refuses
to overwrite an output tree. Nothing publishes: `npm publish` stays a human
step and no workflow was added.

### T3 decisions for review

1. **Architecture registration.** `apps/vestra-launcher` is in
   `EXPECTED_PACKAGES`, not `NON_PRODUCT_WORKSPACES`. A non-product workspace is
   never scanned, and scanning is exactly the enforcement this package needs, so
   it is a product package with the strictest possible edge rule:
   `validateDependencyEdge("vestra-launcher", *)` is always denied with
   `VES_ARCH_PUBLIC_LAUNCHER_ISOLATED`, and `inspectSource` now treats it like
   the inward core for third-party imports.
2. **`test:build` was orphaned.** `tests/build/` held nine suites that no gate
   stage executed; the path was routed to `gate:quick`, which runs no build
   stage. A `test:build` stage now exists and runs in `gate:build` and
   `gate:release`, and `tests/build/` selects `gate:build`. This adds roughly a
   minute to both profiles and puts 54 previously unexecuted assertions under
   the gates.
3. **The activation closure is still open and is the owner's call.** A
   functional bootstrap must reach `TufUpdateClient` and
   `TransactionalActivationManager`, which need `@verchestra/domain` and
   `tuf-js` at runtime. Emitting that into a public tarball requires either an
   approved bundler (a new dependency) or a public runtime dependency on
   `tuf-js`. Neither was taken unilaterally, so the bootstrap fails closed with
   `VES_VESTRA_ACTIVATION_UNAVAILABLE` instead of approximating a resolve.
4. **The pinned inputs are build inputs, never tracked fixtures.** The tarball's
   `config/root.json` and `config/release-source.json` come from
   `--release-inputs`. No trust root is committed. Tests supply an ephemeral
   `mkdtemp` input set that is deleted afterwards.

### T4: Prove the clean-machine journey

**What:** Install the tarball into repository-free temporary homes and run
help, version, portability, recovery, and cleanup scenarios per supported
platform.
**Where:** E2E/platform evidence and user documentation.
**Depends on:** T3 and the T76 candidate release.
**Reuses:** T76 online/offline views and platform matrix.
**Requirements:** NPX-01, NPX-09, NPX-10.
**Tests:** E2E + release/platform.
**Gate:** `pnpm gate:build`; T76 carries the final `pnpm gate:release` evidence.

Done when:

- [ ] No clone, source build, credential, or unrecorded fixture is present.
- [ ] Help/version/demo execute the activated embedded runtime.
- [ ] Supported-platform evidence and cleanup instructions are recorded.
- [ ] #36 can close without claiming T76/T77 completion.

## Dependency Cross-Check

| Task | Declared dependency | Diagram | Status |
| --- | --- | --- | --- |
| T1 | None | Start | Match |
| T2 | T1 | T1 -> T2 | Match; T2 defines the protocol T76 must answer |
| T3 | T2 + release/registry inputs | T2 -> T3 | Match; artifact contract done, closure open |
| T4 | T3 + T76 candidate | T3 -> T4 | Match; still blocked |

## Test Co-location Check

| Task | Layer | Required evidence | Task evidence | Status |
| --- | --- | --- | --- | --- |
| T1 | Distribution trust boundary | Integration + security | Integration + security | OK |
| T2 | Process/health boundary | Unit/integration/security/fault | Same task | OK |
| T3 | Package/architecture boundary | Architecture/build/security | Same task | OK |
| T4 | User journey/release | E2E/release/platform | Same task | OK |

Granularity: each task produces one independently reviewable boundary. Tests
are co-located with the behavior they establish; no later task is used to
excuse unverified code.
