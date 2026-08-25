---
schema: verchestra-feature-handoff/v1
feature: npx-launcher
issue: 36
status: in_progress
branch: npx-36
baseRevision: 6e413246605d2ea0023aba4e967837225692f51f
lastCompletedTask: T3
nextTask: T4 after T76 supplies the candidate release, reviewed pinned inputs, and the owner decides the activation-closure build path
lastGate: gate:quick PASS, gate:build PASS, gate:security FAIL on one owed canonical-JSON census registration
updatedAt: 2026-08-25T00:00:00Z
---

# Task State

T1, T2, and T3's artifact contract are complete. T3's activation closure is not:
the emitted tarball fails closed with `VES_VESTRA_ACTIVATION_UNAVAILABLE`
because no approved build path yet emits the qualified TUF and activation code
into a public package. `lastCompletedTask: T3` therefore means "T3's declared
`Done when` boxes are all evidenced", not "the public launcher resolves a
release".

# Scope

Deliver AD-016's `npx vestra` bootstrap over the qualified TUF and
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
- The npm registry reports `vestra` as unpublished on 2026-07-25; owner control
  or reclaim must be confirmed before release. Nothing here publishes.

# Immediate Blocking Action

`corepack pnpm gate:security` fails on exactly one assertion:
`tests/security/canonical-json-census.test.mjs` reports three `missingPaths`.
`docs/canonical-json-census.json` must classify every product source emitting a
canonical-JSON signal, and this change adds three. That file is owned by
concurrent work and was deliberately left untouched, so the registration is
owed. `validation.md` carries the three ready-to-paste entries with their exact
measured signal counts and truthful classifications
(`packages/platform-node/src/activation-launcher-adapters.ts` is `migrated-v2`;
the other two are `raw-byte-digest`). `docs/canonical-json-compatibility.md`
needs no change. Nothing else in `gate:security` failed, and `gate:build` is
fully green.

# Next Exact Action

T4 cannot start until three owner-owned inputs exist:

1. **The activation-closure build path.** A functional bootstrap must reach
   `TufUpdateClient` and `TransactionalActivationManager`, which need
   `@verchestra/domain` and `tuf-js` at runtime. Emitting that into a public
   tarball needs either an approved bundler (a new dependency) or a pinned
   public runtime dependency on `tuf-js`. Until one is approved, the bootstrap
   fails closed with `VES_VESTRA_ACTIVATION_UNAVAILABLE` (exit 70) rather than
   approximating a resolve.
2. **T76's reviewed pinned inputs**: a real `root.json` and a
   `release-source.json` naming the fixed credential-free HTTPS metadata and
   target bases, passed as
   `corepack pnpm build:vestra-launcher -- --release-inputs <dir> --out <dir>`.
3. **Owner confirmation of the npm name `vestra`.**

Once those exist, T4 installs the packed tarball into repository-free temporary
homes and records help, version, portability, recovery, and cleanup evidence per
supported platform.

# Blockers

T1, T2, and T3's artifact contract are complete. T3's activation closure and all
of T4 remain blocked on the three inputs above. These block closing #36; they do
not block the work already landed.

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

# Files Intentionally Left Unchanged

- `.specs/STATE.md`, `docs/canonical-json-census.json`, and
  `docs/canonical-json-compatibility.md`; concurrent work owns them.
- Qualification-chain reports and derived status surfaces.
- `AGENTS.md`; the launcher's stricter rule is recorded in
  `docs/repository-map.md`, which `AGENTS.md` already points to.
