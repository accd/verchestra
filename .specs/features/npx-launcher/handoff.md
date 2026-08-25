---
schema: verchestra-feature-handoff/v1
feature: npx-launcher
issue: 36
status: in_progress
branch: npx-36
baseRevision: 6e413246605d2ea0023aba4e967837225692f51f
lastCompletedTask: T3
nextTask: T4 after T76 supplies the candidate release and reviewed pinned inputs, and the owner confirms the npm name
lastGate: gate:quick, gate:build, and gate:security all PASS end-to-end with the bundled activation closure
updatedAt: 2026-08-25T00:00:00Z
---

# Task State

T1, T2, and T3 are complete, including T3's activation closure. The owner
approved a build-time bundler, so `esbuild` is a pinned root devDependency and
`scripts/build-vestra-launcher.mjs` inlines the qualified TUF and activation
code into the single emitted `lib/bootstrap.js`. The published manifest still
declares no dependencies; `npx verchestra` downloads the tarball and nothing else.

`VES_VESTRA_ACTIVATION_UNAVAILABLE` is no longer unconditional. It now fires
only when activation genuinely cannot complete, and it carries the canonical
upstream code as a bounded diagnostic detail.

What remains for #36 is external: T76's candidate release and reviewed pinned
inputs, and owner confirmation of the npm name. Nothing in the code path is
still waiting on a decision.

# Scope

Deliver AD-016's `npx verchestra` bootstrap over the qualified TUF and
transactional-activation path. Ambient Node is bootstrap-only; product control
passes to the activated bundle's `launcher:vestra` and embedded Node 24.14.0.

# Current Evidence

- T1 adds `TransactionalActivationManager.resolveActiveLauncher()`: it reads the
  closed active pointer, reopens the installed bundle, verifies every component
  byte, binds pointer identity to the bundle, selects exactly
  `launcher:vestra`, and returns an immutable path result without execution.
- T2 adds the real activation health gate and the shell-free handoff, both in
  `packages/platform-node/src/activation-launcher-adapters.ts`, with the closed
  public error contract in
  `packages/platform-node/src/activation-launcher-errors.ts`. The gate spawns
  both canonical launchers from the staged release through that release's own
  `node-runtime` component, never ambient Node and never a shell, and derives
  every digest from what those processes printed. 29 focused unit, integration,
  security, and fault cases pass with zero skipped or todo.
- T2 also fixes the protocol T76 must answer: `--activation-health` prints one
  JSON object with exactly `schemaVersion`, `report`, `componentId`,
  `semanticVersion`, `checks`, and `behavior`. A launcher does not report its
  release digest - that digest covers a manifest containing the launcher's own
  content digest, and the installed `release.json` does not exist at
  pre-publication health time - so the gate binds the evidence to the release it
  actually ran.
- T3 adds `apps/vestra-launcher/` and `scripts/build-vestra-launcher.mjs`. The
  emitted tarball is exactly ten paths, verified three ways: the build's own
  allowlist check, `npm pack --dry-run --json`, and a dependency-free reader
  over the real `.tgz`. 25 focused architecture, build, and security cases pass
  with zero skipped or todo.
- `apps/vestra-launcher` is registered in `EXPECTED_PACKAGES` (not
  `NON_PRODUCT_WORKSPACES`), denied every workspace edge with
  `VES_ARCH_PUBLIC_LAUNCHER_ISOLATED`, held to the inward core's third-party
  import rule, routed to `gate:release` and `gate:build`, measured by the
  complexity ratchet, and documented in `docs/repository-map.md`.
- `tests/build/` was orphaned: nine suites that no gate stage executed. A
  `test:build` stage now runs in `gate:build` and `gate:release`, and
  `tests/build/` selects `gate:build`. That puts 54 previously unexecuted
  assertions under the gates.
- T3's activation closure now exists. `apps/vestra-launcher/src/bootstrap.ts`
  states what it needs as `ActivationClosurePort` and stays free of every
  workspace import; `apps/vestra-launcher/closure/node-activation-closure.ts` is
  a **build input** that composes `TufUpdateClient`,
  `TransactionalActivationManager`, the real `NodeActivationHealthGate`, and
  `NodeVerifiedLauncherHandoff` against machine-local roots derived from
  `homedir()` alone. `closure/bootstrap-entry.ts` is the bundle entry and the
  only wiring a tarball performs.
- The build now typechecks `src/` and `closure/` together, then bundles
  `closure/bootstrap-entry.ts` with esbuild `0.28.2` into one ESM module:
  `--platform=node --format=esm --target=node24.14.0 --minify --keep-names
--legal-comments=none`, `cwd` at the repository root, no source map. The
  allowlist shrank from ten paths to seven — `lib/pinned-inputs.js`,
  `lib/public-errors.js`, and `lib/supported-host.js` are now inside
  `lib/bootstrap.js` — and all three verifications (the build's own allowlist
  check, `npm pack --dry-run --json`, and a dependency-free reader over the real
  `.tgz`) still agree exactly.
- `tests/e2e/vestra-launcher-activation.test.mjs` proves the bootstrap completes
  a real activation: a signed filesystem TUF repository holding a release with a
  genuinely executable Node runtime and two launchers, resolved, staged,
  verified, activated behind the observed health gate, and handed control. The
  activated launcher's exit status became the command's status and it recorded
  the argument vector verbatim, including `$(echo pwned)` and `; echo pwned`.
- The npm registry reports `vestra` as unpublished on 2026-07-25; owner control
  or reclaim must be confirmed before release. Nothing here publishes.

# Review Item Before Merge

This change adds three product sources that emit canonical-JSON signals, so
`docs/canonical-json-census.json` had to classify them. That file is owned by
concurrent work, so this task did not edit it; the entries landed in commit
`d8893a2`, which this task did not author. `test:security` is now 1113 of 1113
green and `docs/canonical-json-compatibility.md` needs no change. The closure
work added no census candidate: `collectCensusCandidates` still reports exactly
`apps/vestra-launcher/src/pinned-inputs.ts` and
`scripts/build-vestra-launcher.mjs` for this feature, with the same signals, so
`census:refresh` produces no diff and `test:security` is now 1117 of 1117 green.

At `d8893a2` one classification was wrong:
`apps/vestra-launcher/src/pinned-inputs.ts` was recorded as
`pending-versioned-migration` with the placeholder reason "New candidate;
classification not yet reviewed." That source digests the trust root's raw
bytes and uses `JSON.stringify` only to compare a key set, so `raw-byte-digest`
is accurate. Concurrent work has since corrected it in the working tree; that
correction is uncommitted, so confirm it survives into the merged history. The
other two entries were accurate as landed. `validation.md` carries the
analysis.

# Next Exact Action

The activation-closure build path is decided and implemented, so T4 now waits on
exactly two owner-owned inputs:

1. **T76's reviewed pinned inputs**: a real `root.json` and a
   `release-source.json` naming the fixed credential-free HTTPS metadata and
   target bases, passed as
   `corepack pnpm build:vestra-launcher -- --release-inputs <dir> --out <dir>`.
   The `release-source.json` is now load-bearing beyond configuration: its
   `releaseId` and `semanticVersion` are asserted against the resolved release,
   so they must name the exact release T76 publishes.
2. **Owner confirmation of the npm name `vestra`.**

Once those exist, T4 installs the packed tarball into repository-free temporary
homes and records help, version, portability, recovery, and cleanup evidence per
supported platform. The tarball built here is already functional; only its
pinned inputs are still fixtures.

# Blockers

T1, T2, and T3 are complete. T4 remains blocked on the two inputs above. They
block closing #36; they do not block the work already landed.

# Decisions

- Never hard-code `bin/vestra.cmd`; that name belongs to a Windows test fixture.
  The health gate and handoff run `bin/*.mjs` through the release's own
  `node-runtime` component, which is what makes Windows work without a shell.
- Never synthesize activation health evidence or ship a test TUF root. The
  packaged trust root is a build input; a fixture root lives only in `mkdtemp`.
- Resolve through pointer -> verified release manifest -> component identity.
- No shell interpolation of user arguments, on any platform.
- Do not claim a public installer, clean-machine pass, or issue completion
  until T76-owned inputs and platform evidence exist.
- Bundle at build time; never declare a runtime dependency. `esbuild` is a root
  devDependency pinned to `0.28.2`, and the publish manifest template must keep
  declaring no `dependencies`.
- `src/` is the published surface and `closure/` is a build input. `src/` may
  import only Node built-ins and its own siblings; `closure/` may reach the
  workspace only by repository-relative path, never by package name, so
  `apps/vestra-launcher` declares no dependency edge.
- The public error set stays closed. An upstream TUF or activation failure
  contributes only its `code`, and only when it matches `^VES_[A-Z0-9_]{1,64}$`;
  its message, path, and URL never reach the rendered line.
- The launcher's machine-local roots come from `homedir()` and the platform
  alone. Each pinned trust root anchors in its own directory keyed by the root
  digest, so a reviewed root rotation never collides with the refusal that
  protects an installed bootstrap root from replacement.

# Open Review Items

- The safe process-tree termination routine now exists twice: in
  `gate-commit-adapters.ts` (T59) and in `activation-launcher-adapters.ts`.
  `design.md` says to follow that pattern, and refactoring a qualified security
  adapter was out of scope, so it was followed. Extracting one shared helper is
  a reasonable follow-up.
- `NodeActivationHealthGate` satisfies `ActivationHealthGatePort` structurally,
  because an adapter may not import the sibling adapter that declares the port.
  Conformance is proved behaviorally through the real activation manager rather
  than by a compile-time assertion. Adding `@verchestra/distribution` to
  `apps/vestra-cli` for a typed composition point was deliberately not done,
  since it is a new dependency edge and a lockfile change.
- No publish workflow was added. `npm publish` stays a human step.
- **`docs/repository-map.md` needs one line changed and this task could not make
  it.** Its `apps/vestra-launcher` row says "None; no workspace package may be
  imported", which is still exactly true of the published `src/` surface but no
  longer describes the whole directory: `closure/` reaches
  `packages/distribution` and `packages/platform-node` by repository-relative
  path at build time. The row should distinguish the two. The file was outside
  this task's declared edit scope, so the discrepancy is recorded rather than
  silently fixed.
- The build now typechecks `apps/vestra-launcher/closure/` through
  `tsconfig.build.json`, which runs inside `build:vestra-launcher` and therefore
  under `gate:build` and `gate:release`. The root `tsconfig.json` still includes
  only `apps/*/src/**`, so `pnpm typecheck` alone does not cover `closure/`.
  Widening the root include is a reasonable follow-up; it was not taken here
  because the root tsconfig was outside this task's edit scope.
- `apps/vestra-launcher/closure/node-activation-closure.ts` accepts its
  `ActivationEnvironmentFactory` as a required constructor argument rather than
  defaulting to `machineLocalEnvironment`, so the published wiring is one
  greppable expression and tests can supply a filesystem repository without a
  hidden default. A security case asserts `bootstrap-entry.ts` constructs
  exactly one closure and passes exactly `machineLocalEnvironment`.
- No launcher source reads an environment value, but the **bundle** does,
  through the vendored dependencies it inlines: `DEBUG` and one dynamic read
  from `debug`/`supports-color`, `TEMP` from `TufUpdateClient`'s target scratch
  directory, and `__MINIMATCH_TESTING_PLATFORM__` inside the `minimatch` that
  `@tufjs/models` uses for delegated path matching. None can select a trust
  root, repository, release, or state root. The last one is recorded rather than
  dismissed: it can change glob platform semantics in delegated-path matching,
  so it is worth a look when T76 fixes its delegated repository layout.
- The end-to-end test drives a filesystem TUF repository, not an HTTPS one. The
  published wiring pins HTTPS through `HttpsDistributionSource`, and no test may
  reach the public network or trust a self-signed certificate, so the HTTPS
  construction itself is covered by the pinned-input contract rather than by a
  live fetch. T4's clean-machine evidence closes that last gap.

# Files Intentionally Left Unchanged

- `.specs/STATE.md`, `docs/canonical-json-census.json`, and
  `docs/canonical-json-compatibility.md`; concurrent work owns them.
- `docs/repository-map.md` and the root `tsconfig.json`; both are outside this
  task's edit scope and both carry a recorded follow-up above.
- Qualification-chain reports and derived status surfaces.
- `AGENTS.md`; the launcher's stricter rule is recorded in
  `docs/repository-map.md`, which `AGENTS.md` already points to.

# Pinned Source Schema Version 2

`config/release-source.json` moved from one global `metadataBaseUrl` and
`targetBaseUrl` pair to a `targets` map keyed by `<platform>-<arch>`, because
the one published tarball must resolve every fleet platform (win32-x64,
linux-x64, linux-arm64, darwin-x64, darwin-arm64). No version-1 file was ever
published — nothing has been released at any schema version — so the launcher
accepts version 2 only and carries no compatibility path: the version bump is
the migration. `selectPinnedTarget` in the activation closure picks the host's
entry lazily at first source use (deriving a layout still decides and creates
nothing), and a qualified host the map does not name fails closed as
`VES_VESTRA_HOST_UNSUPPORTED` (exit 64) rather than borrowing another
platform's locations.
