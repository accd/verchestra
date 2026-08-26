---
schema: verchestra-feature-handoff/v1
feature: npx-launcher
issue: 36
status: complete
branch: docs/npx-clean-machine-evidence
baseRevision: 5514322cb19a4bf89d1db16e750ea71019cb6eba
lastCompletedTask: T4
nextTask: none for this feature; republish the launcher once the #370 self-test working-directory fix ships, so the portability demo also passes from a default home directory
lastGate: gate:quick, agent:check, test:agent-readiness, and the site unit/astro/build/built-site checks all PASS for the T4 documentation change
updatedAt: 2026-08-26T00:00:00Z
---

# Task State

T1 through T4 are complete. T1, T2, and T3 delivered the verified
active-launcher resolution, the observed activation health gate and shell-free
handoff, and the publishable tarball with its build-time activation closure.
The owner approved a build-time bundler, so `esbuild` is a pinned root
devDependency and `scripts/build-vestra-launcher.mjs` inlines the qualified TUF
and activation code into the single emitted `lib/bootstrap.js`. The published
manifest still declares no dependencies; `npx verchestra` downloads the tarball
and nothing else.

`VES_VESTRA_ACTIVATION_UNAVAILABLE` is no longer unconditional. It now fires
only when activation genuinely cannot complete, and it carries the canonical
upstream code as a bounded diagnostic detail.

Both external inputs arrived. T76 published the reproducible candidate release
and its reviewed pinned inputs, and the owner settled the npm name on
2026-08-25: the package is **`verchestra`**, with **`vestra`** kept only as the
short bin alias. `verchestra@0.0.0-qualification` is published on the public
npm registry with dist-tag `latest` and resolves a live signed release. T4's
clean-machine evidence is recorded below.

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
- The `--activation-health` protocol T2 defined is now implemented by the
  product (2026-08-26): T76's candidate builder bundles
  `apps/vestra-cli/closure/{vestra,verchestra}-entry.ts` into the sealed
  `bin/*.mjs`, and `apps/vestra-cli/src/sealed-launcher.ts` answers the
  protocol with honest migration/native/driver observations while delegating
  every other argument vector to the real CLI `main()`. The previous
  candidates sealed the development shims verbatim and failed activation
  health on a live install (`ERR_MODULE_NOT_FOUND` on `release/src/main.ts`);
  `tests/build/sealed-launcher-closure.test.mjs` now runs the real gate over
  the real bundled launchers from a realistic staged layout - closing, for
  this surface, the fixture-realism gap this handoff's synthetic launcher
  fixtures left open. See `.specs/features/t76-tuf-publication/` (TP-10).
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
- The npm name is settled. The published package is **`verchestra`**, chosen by
  the owner on 2026-08-25 and verified free at the time; **`vestra`** survives
  only as the short bin alias, because it carried ten published versions before
  being unpublished on 2026-07-25 and npm reserves an unpublished name to its
  original publisher, who is not this repository's owner. The full analysis is
  in `spec.md`, "Current External Inputs". Nothing in this repository publishes;
  `npm publish` remains a human step, performed by the owner under 2FA on
  2026-08-26.
- T4 proved the clean-machine journey against the published registry package.
  Every run started from `npx -y verchestra` against
  `verchestra@0.0.0-qualification` (dist-tag `latest`, shasum
  `c6a482d25b59ebae93c4094974b7de5b85ca467a`); no repository checkout took part
  in any of them.
  - **linux-x64**, clean container (`docker run --rm --platform linux/amd64
    node:24`), cwd the container's home directory, `git version 2.39.5` on
    `PATH`: `--help` renders the activated CLI's real command surface (`init`,
    `self-test`, `doctor`); `--version` prints `0.0.0-qualification` and exits
    `0`; `self-test --profile smoke` returns `self_test.verdict: PASS` with
    `check_count: 6`, `duration_ms: 151`, `failure_codes: []`,
    `evidence_refs: []`, `redaction_count: 0`. A cold `--version` on an
    identical container completed in 1 m 46 s including TUF resolution,
    download, staging, the activation health gate, and the verified handoff.
  - **win32-x64**, native Windows 11 with the managed state root wiped
    beforehand, cwd a normal project directory: the same help surface; a cold
    `--version` in 2 m 39 s; `self-test --profile smoke` returns
    `self_test.verdict: PASS` with `check_count: 6`, `duration_ms: 1070`,
    `failure_codes: []`, `evidence_refs: []`, `redaction_count: 0`.
  - **Recovery** was exercised rather than only described: the win32-x64 run
    began from a wiped managed state root and reactivated from scratch.
    **Cleanup** followed the documented path — the Windows managed state root
    (`%LOCALAPPDATA%\Verchestra`) was removed, and the linux-x64 containers
    were `--rm`, so nothing persisted.
- T4's user documentation landed with that evidence: `README.md` gained an
  "Install and run" section, the documentation portal gained
  `docs/install-and-run`, and `apps/vestra-launcher/README.md` — the README
  inside the published tarball — was corrected from its "not published" status
  block and given the concrete recovery and cleanup paths.

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

Nothing in this feature is outstanding. The one remaining action for the demo's
worst case is a republication, not a code or documentation task: once the #370
fix ships — `self-test` refusing when the working directory is an ancestor of
the OS temporary directory — rebuild and republish the launcher so
`npx verchestra self-test --profile smoke` also passes from a default Windows
home directory. Until then the documented instruction is to run the demo from a
project directory, which every supported platform satisfies today.

# Closed Blockers

T1 through T4 are complete. Both former blockers are resolved: T76 supplied the
candidate release and reviewed pinned inputs, and the owner settled the npm
name as `verchestra` on 2026-08-25 and published the package on 2026-08-26.
Neither #370 nor T77 blocks this feature: #370 is a product defect reproducible
from a repository checkout, and T77's acceptance decision is out of scope here.

# Decisions

- Never hard-code `bin/vestra.cmd`; that name belongs to a Windows test fixture.
  The health gate and handoff run `bin/*.mjs` through the release's own
  `node-runtime` component, which is what makes Windows work without a shell.
- Never synthesize activation health evidence or ship a test TUF root. The
  packaged trust root is a build input; a fixture root lives only in `mkdtemp`.
- Resolve through pointer -> verified release manifest -> component identity.
- No shell interpolation of user arguments, on any platform.
- Do not claim a public installer, clean-machine pass, or issue completion
  until T76-owned inputs and platform evidence exist. Satisfied on 2026-08-26:
  the inputs exist, the package is published, and the per-platform evidence is
  recorded above. Production readiness and 1.0 stay unclaimed; that is T77.
- AD-032 (owner, 2026-08-26): `npx verchestra self-test --profile smoke` is the
  clean-machine portability demonstration #36 requires, superseding R13's
  repository-bound two-minute demo
  (`docs/qualification/t68a-validation.md:61-83`).
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
  live fetch. Closed by T4: the clean-machine runs resolved the real release
  over the published HTTPS bases, on two platforms, from `npx -y verchestra`
  alone.
- `self-test` refuses when the working directory is an ancestor of the OS
  temporary directory, because the whole working directory is declared
  production state and the disposable enclave under `tmpdir()` then reads as an
  overlap. On Windows the default home directory is such an ancestor, so the
  demo fails there with `VES_CLI_COMMAND_FAILED`. Tracked as
  [#370](https://github.com/accd/verchestra/issues/370) and documented plainly
  in `README.md`, the `docs/install-and-run` portal page, and the published
  tarball's README. It is a product defect, not a packaging one: a repository
  checkout reproduces it identically, and the published bundle passes from any
  other directory. Linux is unaffected because `/tmp` is not inside the home
  directory.

# Files Intentionally Left Unchanged

Left unchanged by T1–T3:

- `docs/canonical-json-census.json` and
  `docs/canonical-json-compatibility.md`; concurrent work owns them.
- `docs/repository-map.md` and the root `tsconfig.json`; both are outside those
  tasks' edit scope and both carry a recorded follow-up above.
- Qualification-chain reports and derived status surfaces.

Left unchanged by T4:

- `docs/qualification/t68a-validation.md`. R13's repository-bound two-minute
  demo stays exactly as recorded: it is a dated report and its transcript is
  still true of the revision it names. AD-032 supersedes the demo going
  forward; it does not rewrite the evidence.
- `apps/site/src/data/product.ts`'s `installable: false` flag, the homepage
  status note in `apps/site/src/pages/index.astro` that expresses it, and the
  `installable: false` assertion in
  `apps/site/tests/unit/product-contract.test.mjs`. The public homepage posture
  is an owner decision and is deliberately not flipped here, so the homepage
  still reads as pre-installer while the documentation portal and `README.md`
  describe the published package. That divergence is recorded for the owner
  rather than resolved unilaterally.

T4 does change `AGENTS.md` and `.specs/STATE.md`, which T1–T3 had left alone:
the mission line's installer prohibition became false when the package was
published, and AD-032 is the decision that records the demo mapping.

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
