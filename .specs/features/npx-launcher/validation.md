# npx Launcher Validation

## Current verdict

**PARTIAL - T1, T2, T3 PASS; #36 remains open.** The verified active-launcher
bridge, the observed activation health gate, the shell-free handoff, the
publishable package's artifact contract, and the activation closure that tarball
now carries are implemented and verified. The bootstrap completes a real
resolve, verify, activate, and handoff end to end against a signed TUF
repository holding an executable release. The clean-machine journey is still not
claimed: the package carries no T76-owned trust root, source URLs, or executable
candidate release, and the npm name is unconfirmed.

## T1 evidence

| Outcome | Assertion evidence | Result |
| --- | --- | --- |
| Bundle-owned launcher path | `active launcher resolution revalidates the bundle-owned logical path` uses `tools/vestra-direct`, proving no `bin/vestra.cmd` assumption | PASS |
| Immutable authority result | The same case proves the resolution and nested active pointer are frozen | PASS |
| Active pointer required | `active launcher resolution requires an authoritative active pointer` | PASS |
| Pointer/bundle identity bound | `active launcher resolution rejects pointer and installed release identity drift` | PASS |
| Installed bytes rehashed | `active launcher resolution rehashes installed launcher bytes` | PASS |
| Path containment | `active launcher resolution rejects a launcher path junction` | PASS |
| Closed launcher identity | Existing Hermetic Bundle build/security cases reject missing, duplicate, wrong-kind, and incomplete launcher closure | PASS |

Command:

`node --test tests/integration/transactional-activation.test.mjs tests/security/transactional-activation-security.test.mjs`

Result: 44 passed, 0 failed, 0 skipped, 0 todo. Before implementation, the
five additive resolution tests failed because the method did not exist.

## T2 evidence (NPX-05, NPX-06, NPX-07)

Implementation: `packages/platform-node/src/activation-launcher-adapters.ts`
and `packages/platform-node/src/activation-launcher-errors.ts`. The port is
declared by `packages/distribution`, but an adapter may not import a sibling
adapter, so `NodeActivationHealthGate` satisfies `ActivationHealthGatePort`
structurally. Conformance is proved behaviorally rather than by a type
assertion: a case drives the real `TransactionalActivationManager` with the
real gate and the manager's own `validateHealth` accepts the result.

| Requirement | Assertion evidence | Result |
| --- | --- | --- |
| NPX-05 observed from real bytes | `the observed health gate runs both canonical launchers from the staged bytes`; `the behavior digest is derived from launcher output, not from the manifest`; `the observed behavior digest is computed over exactly what the launcher printed` recomputes the expected digest independently | PASS |
| NPX-05 accepted by activation | `transactional activation accepts the observed evidence and records it with the release` | PASS |
| NPX-05 deterministic | `the same observed launcher output produces the same evidence twice` | PASS |
| NPX-06 no shell | `the launcher adapters never open a shell and never build a command string` (static, over the adapter source); `shell metacharacters in user arguments reach the launcher as data and expand nothing` (behavioral, asserts no side-effect file) | PASS |
| NPX-06 exact propagation | `the verified handoff preserves the argument vector and propagates the launcher's exact exit status` compares the child's own record of `process.argv` to the injected vector | PASS |
| NPX-07 host contract | `the supported-host contract accepts exactly the qualified platform and architecture pairs`; `an unsupported host is refused deterministically before any process or filesystem effect` | PASS |
| NPX-07 public errors | `the activation launcher public error contract is closed and schema-valid`; `every observed launcher failure renders a public code without a machine-local path` | PASS |
| Fail-closed release shape | `a launcher component path that escapes the release root is refused before any process starts`; `a runtime component path that escapes the release root is refused`; `a release without a unique runtime or both canonical launchers is refused` | PASS |
| Fail-closed identity | `a launcher that reports another identity or another release version is refused`; `canonical launchers that observe different behavior or different checks are refused`; `a health check that did not pass never becomes passing evidence` | PASS |
| Exit, signal, timeout, bound, cleanup | `a launcher that exits non-zero...`; `a launcher that terminates abnormally...`; `a launcher that never returns is stopped at the health budget`; `a timed-out launcher leaves no descendant process behind`; `a launcher that floods its output is stopped at the output bound`; `a launcher whose report is unreadable or incomplete never becomes evidence`; `a release whose hermetic runtime cannot start fails closed instead of falling back` | PASS |

Commands and results:

- `node --test tests/unit/activation-launcher-contract.test.mjs` - 7 passed, 0
  failed, 0 skipped, 0 todo.
- `node --test tests/integration/activation-health-gate.test.mjs` - 5 passed, 0
  failed, 0 skipped, 0 todo.
- `node --test tests/security/activation-launcher-security.test.mjs` - 10
  passed, 0 failed, 0 skipped, 0 todo.
- `node --test tests/fault-injection/activation-launcher-faults.test.mjs` - 7
  passed, 0 failed, 0 skipped, 0 todo.

Platform note: the abnormal-termination case asserts
`VES_LAUNCHER_SIGNAL_TERMINATED` on POSIX and `VES_LAUNCHER_EXIT_NONZERO` on
Windows. Windows has no signal delivery - `TerminateProcess` surfaces as exit
status 1 with a null signal - so the assertion is platform-exact rather than
loosened to a set.

## T3 evidence (NPX-01, NPX-02, NPX-08, NPX-10)

Implementation: `apps/vestra-launcher/` plus
`scripts/build-vestra-launcher.mjs`.

| Requirement | Assertion evidence | Result |
| --- | --- | --- |
| NPX-08 exact allowlist | `the emitted package is exactly the declared file allowlist`; `npm pack --dry-run reports exactly the declared allowlist`; `the packed tarball itself contains exactly the declared allowlist` (reads the real `.tgz` with a dependency-free tar reader) | PASS |
| NPX-08 compiled code only | `every public launcher source imports only Node built-ins and its own siblings`; `the tracked bin shim resolves only compiled sibling JavaScript`; the build itself refuses a workspace reference, a `.ts` import, a `node_modules` path, or a machine-local path in any emitted `.js`/`.mjs` | PASS |
| NPX-08 no install script | `the publish manifest declares one bin, no scripts, and no dependency`, and the build refuses a rendered manifest carrying scripts or dependencies | PASS |
| NPX-10 no workspace import | `the public launcher may import no workspace package at all, not even inward`; `a third-party import in the public launcher is a boundary violation` | PASS |
| NPX-02 pinned credential-free source | `a source location that is not credential-free HTTPS is refused` (nine rejected forms); `a target location is held to the same pinned public contract` | PASS |
| NPX-02 pinned trust root | `a trust root that is substituted or is not a TUF root role is refused`; the build refuses inputs whose `rootDigest` does not match the root bytes | PASS |
| NPX-02 no environment substitution | `no environment variable can select a different root, repository, or release`, which also asserts no launcher source reads `process.env` | PASS |
| Determinism | `two builds from identical pinned inputs emit byte-identical files` | PASS |
| Fail-closed build | `the build refuses to emit without reviewed pinned release inputs`; `the build refuses to overwrite an existing output tree` | PASS |
| Deterministic public failure | `the emitted bootstrap runs, fails closed, and reports a stable public code` (exit 70, `VES_VESTRA_ACTIVATION_UNAVAILABLE`, empty stdout) | PASS |

Commands and results:

- `node --test tests/architecture/vestra-launcher-boundaries.test.mjs` - 7
  passed, 0 failed, 0 skipped, 0 todo.
- `node --test tests/build/vestra-launcher-package.test.mjs` - 8 passed, 0
  failed, 0 skipped, 0 todo.
- `node --test tests/security/vestra-launcher-package-security.test.mjs` - 10
  passed, 0 failed, 0 skipped, 0 todo.
- `node --test tests/architecture/*.test.mjs` - 46 passed, 0 failed, 0 skipped,
  0 todo.
- `node --test tests/build/*.test.mjs` - 62 passed, 0 failed, 0 skipped, 0 todo
  (54 of which no gate stage previously executed).

NPX-01 is **not** claimed at this point in the record. The counters above are
the artifact-contract pass; the closure section below supersedes the per-file
totals.

## T3 activation-closure evidence (NPX-03, NPX-08)

Implementation: `apps/vestra-launcher/src/activation-closure.ts`,
`apps/vestra-launcher/src/bootstrap.ts`,
`apps/vestra-launcher/closure/node-activation-closure.ts`,
`apps/vestra-launcher/closure/bootstrap-entry.ts`, and the esbuild stage of
`scripts/build-vestra-launcher.mjs`.

| Requirement | Assertion evidence | Result |
| --- | --- | --- |
| NPX-03 real resolve, stage, and transactional activation | `the bootstrap resolves, activates, and runs the pinned release end to end` - a signed filesystem TUF repository holding a release with a real Node runtime and two launchers; `active.json` afterwards equals the published bundle's pointer exactly | PASS |
| NPX-03 pinned release binding | `a release that is not the pinned release is refused before activation` - `VES_TUF_RELEASE_VIEW_MIXED`, no `active.json` written | PASS |
| NPX-03 integrity fail-closed | `a tampered component byte stops the bootstrap before anything is activated` - exit 70, canonical TUF code preserved, no `active.json` written | PASS |
| NPX-03 revalidation on reuse | `a second run revalidates the active release and still executes it` - and a committed activation leaves no journal behind | PASS |
| NPX-06 argument fidelity | The activated launcher recorded its own `process.argv` and it equals the given vector byte for byte, including `$(echo pwned)` and `; echo pwned`; `the argument vector reaches the closure exactly as it was given`; `an argument vector carrying a null byte never reaches the closure` | PASS |
| NPX-06 exit propagation | `a clean child exit becomes the bootstrap's own exit status`; `a child terminated by signal is reported the way a shell reports one`; `an unusable termination status is a launch failure, never a success`; end to end, `--exit=3` produced status 3 and `--exit=7` produced status 7 | PASS |
| NPX-08 zero runtime dependencies | `the emitted bootstrap is one bundled module that imports only Node built-ins` - every static specifier in the emitted `lib/bootstrap.js` starts with `node:`; the build asserts the same before writing a receipt | PASS |
| NPX-08 no runtime resolution at all | `the bundle's require shim serves Node built-ins and refuses every package` - the shipped shim resolves `node:path` and `util` and throws for `tuf-js`, a relative path, and two absolute paths | PASS |
| NPX-08 the closure is real, not declared | `the emitted bootstrap fails from inside a real activation closure` - the emitted tarball's failure carries `(VES_TUF_TRUST_ROOT_INVALID)`, which only the bundled anchoring check can raise, and never says "carries no activation closure" | PASS |
| NPX-08 no leak through the bundler | `the emitted bundle leaks no machine-local path, account name, or dependency path` - scans the real emitted bytes for the repository root, `homedir()`, `tmpdir()`, the account name, `node_modules`, `.pnpm`, `sourceMappingURL`, POSIX and Windows home paths, and `@verchestra/` | PASS |
| NPX-07 closed public error set | `an upstream failure contributes only a bare canonical code to the public line` - six smuggling attempts and six malformed shapes all yield no detail; the upstream message and path never render | PASS |
| Boundary preserved | `the build-time closure reaches the workspace only by repository path, never by package name`; `no published launcher source reaches into the build-time closure`; `the published tree carries neither source directory and declares no dependency` | PASS |
| Determinism preserved | `two builds from identical pinned inputs emit byte-identical files` still passes, unchanged, with the bundler in the path | PASS |
| No side effect on failure | The emitted `bin/vestra.mjs`, run with `HOME`/`USERPROFILE` redirected to an empty directory, exits 70 and leaves that directory empty: the anchoring check runs before any root is derived, any directory is created, or any name is resolved | PASS |

Commands and results:

- `node --test tests/unit/vestra-launcher-bootstrap.test.mjs` - 7 passed, 0
  failed, 0 skipped, 0 todo.
- `node --test tests/architecture/vestra-launcher-boundaries.test.mjs` - 10
  passed, 0 failed, 0 skipped, 0 todo.
- `node --test tests/build/vestra-launcher-package.test.mjs` - 11 passed, 0
  failed, 0 skipped, 0 todo.
- `node --test tests/security/vestra-launcher-package-security.test.mjs` - 14
  passed, 0 failed, 0 skipped, 0 todo.
- `node --test tests/e2e/vestra-launcher-activation.test.mjs` - 5 passed, 0
  failed, 0 skipped, 0 todo.

47 focused cases in total. No existing assertion was weakened, deleted, skipped,
or retried; the 25 cases the artifact contract already carried all still pass as
written, including the byte-identical-rebuild assertion.

### The dependency decision and how determinism is held

`esbuild` is a root **devDependency** pinned to the exact version `0.28.2`, with
no range. It was already in the lockfile transitively through `vitest`/`vite`,
so `corepack pnpm install --frozen-lockfile=false` added three lines and
downloaded nothing. The published `publish/package.template.json` still declares
no `dependencies`, `devDependencies`, or `scripts`, and both the build and an
architecture case assert that.

Determinism is held by four properties, not by luck:

1. The option vector is fixed in source and the Node target is read from the
   repository's own `engines.node`, so it cannot drift from the pinned runtime.
2. No source map, metafile, or timestamp option is passed; esbuild emits none by
   default, and a source map would embed build-machine paths.
3. `cwd` is the repository root, so every path esbuild could record is
   repository-relative rather than machine-local.
4. `--minify` removes esbuild's per-module provenance comments and CommonJS
   wrapper names, which are the only place `node_modules/.pnpm/...` paths would
   otherwise appear. Without it the build's own pre-existing forbidden-content
   check rejects the output — which is how the requirement was discovered rather
   than assumed. `--keep-names` is kept so class and function identity survives.

### What the bundle reads from the environment, stated exactly

`no launcher source, published or build-time, reads an environment value` is
asserted over `apps/vestra-launcher/src/` and `apps/vestra-launcher/closure/`,
and it holds. The **bundle** is a larger statement and a weaker one: it inlines
the qualified adapters and their vendored dependencies, and those do read the
environment. A scan of the emitted `lib/bootstrap.js` finds exactly four keys —
`DEBUG` and one unnamed dynamic read from the vendored `debug` and
`supports-color`, `TEMP` from `TufUpdateClient`'s scratch directory for a target
download, and `__MINIMATCH_TESTING_PLATFORM__`, a test hook inside the
`minimatch` that `@tufjs/models` uses for delegated path matching.

None of them can select a trust root, a repository, a release, or a state root,
which is the property NPX-02 actually requires and which
`no environment variable can select a different root, repository, or release`
asserts behaviorally. `TEMP` chooses a scratch directory whose contents are TUF
verified before use. `__MINIMATCH_TESTING_PLATFORM__` is recorded rather than
dismissed: it can change glob platform semantics inside delegated-path matching,
and while every metadata file remains signature- and threshold-verified
regardless, a reviewer evaluating T76's delegated repository layout should know
it is reachable.

NPX-01 is still **not** claimed. The tarball now builds, packs, runs, resolves,
verifies, activates, and hands off — but only against inputs a test supplies. Its
packaged trust root and source URLs are still fixtures, so no repository-free
command resolves a real release today.

## Repository gates

| Command | Result |
| --- | --- |
| `corepack pnpm agent:check` | PASS |
| `corepack pnpm gate:quick` | PASS - 164 cases, 0 failed, 0 skipped, 0 todo |
| `corepack pnpm gate:build` | PASS end-to-end on `d8893a2` |
| `corepack pnpm gate:security` | PASS end-to-end on `d8893a2` |

Both gates were re-run to completion on `d8893a2`, the current HEAD, after the
tree moved beneath earlier runs. Every stage: 0 failed, 0 skipped, 0 todo.

| Stage | `gate:build` | `gate:security` |
| --- | --- | --- |
| `test:unit` | 2103 | 2103 |
| `test:contract` | 503 | 503 |
| `test:integration` | 642 | - |
| `test:e2e` | 165 | 165 |
| `test:architecture` | 46 | 46 |
| `test:build` | 62 | - |
| `test:qualification` | 251 | 251 |
| `test:security` | - | 1113 |
| `test:fault` | - | 291 |

### Gates after the activation closure

All three gates were re-run to completion with the bundled closure in place.
Every stage: 0 failed, 0 skipped, 0 todo. `complexity:check` reported PASS with
179 baselined hotspot keys and nothing above 10 unaccounted, so
`complexity-baseline.json` needed no change.

| Command | Result |
| --- | --- |
| `corepack pnpm gate:quick` | PASS |
| `corepack pnpm gate:build` | PASS |
| `corepack pnpm gate:security` | PASS |

| Stage | `gate:quick` | `gate:build` | `gate:security` | Delta |
| --- | --- | --- | --- | --- |
| `test:unit` | 2110 | 2110 | 2110 | +7 |
| `test:agent-readiness` | 169 | - | - | 0 |
| `test:contract` | - | 503 | 503 | 0 |
| `test:integration` | - | 642 | - | 0 |
| `test:e2e` | - | 170 | 170 | +5 |
| `test:architecture` | - | 49 | 49 | +3 |
| `test:build` | - | 65 | - | +3 |
| `test:qualification` | - | 251 | 251 | 0 |
| `test:security` | - | - | 1117 | +4 |
| `test:fault` | - | - | 291 | 0 |

Every delta is an addition. No case was removed, renamed away, or merged: the
22 new cases are 7 unit, 5 e2e, 3 architecture, 3 build, and 4 security.

The `test:fault` flake recorded below did not reproduce on this run: 291 of 291
passed with nothing skipped.

### A moving tree during verification

Five commits landed on this branch while this task ran: `07c5433`, `61d3142`,
`49a1e07`, and `4e7c81c` from concurrent #58/#77 work, plus `d8893a2`, which
packaged this task's files and which this task did not author. This task used
read-only Git throughout and ran no commit, push, or history-changing command.

Gate counters belong to a tree state, not only to a command, so the earlier
runs are superseded rather than merged into the table above. Their count deltas
(`test:contract` 497 -> 503, `test:integration` 639 -> 642, `test:security`
1107 -> 1113) are the concurrent commits' own tests, not this change's.

### The census registration

`tests/security/canonical-json-census.test.mjs` initially reported three
`missingPaths`: `docs/canonical-json-census.json` must classify every product
source that emits a canonical-JSON signal, and this change adds three such
sources. That census file is owned by concurrent work, so this task left it
untouched and recorded the owed entries here instead.

The entries landed in commit `d8893a2`, which this task did not author.
`tests/security/canonical-json-census.test.mjs` is 10 of 10 green and
`test:security` is 1113 of 1113 green.

At `d8893a2` one of the three classifications disagreed with the analysis
below: `apps/vestra-launcher/src/pinned-inputs.ts` was recorded as
`pending-versioned-migration` with the placeholder reason "New candidate;
classification not yet reviewed." That asserts a structured portable identity
awaiting a versioned migration, which this source does not produce: its two
`createHash` uses digest the trust root's **raw bytes**, and its two
`JSON.stringify` uses compare a key set and are never hashed. Concurrent work
has since corrected it in the working tree to `raw-byte-digest` with the
reviewed reason, matching the analysis below. That correction is uncommitted at
the time of writing, so a reviewer should confirm it survives into the merged
history.

All three entries as analysed, with the signal counts `collectCensusCandidates`
measures today:

```json
{
  "path": "apps/vestra-launcher/src/pinned-inputs.ts",
  "classification": "raw-byte-digest",
  "signals": { "canonicalizer": 0, "digest": 2, "localeCompare": 0, "serialization": 2 },
  "reason": "The reviewed source hashes raw bytes or a fixed primitive, not structured JSON."
}
```

```json
{
  "path": "packages/platform-node/src/activation-launcher-adapters.ts",
  "classification": "migrated-v2",
  "signals": { "canonicalizer": 6, "digest": 2, "localeCompare": 0, "serialization": 0 },
  "reason": "The reviewed source uses the declared V2 canonical contract."
}
```

```json
{
  "path": "scripts/build-vestra-launcher.mjs",
  "classification": "raw-byte-digest",
  "signals": { "canonicalizer": 0, "digest": 2, "localeCompare": 0, "serialization": 4 },
  "reason": "The reviewed source hashes raw bytes or a fixed primitive, not structured JSON."
}
```

The classifications are truthful rather than convenient. The health gate digests
`canonicalizeJsonV2` output, so it is `migrated-v2`. The launcher's pinned-input
loader digests the trust root's raw bytes and uses `JSON.stringify` only to
compare a key set, and the build script digests emitted file bytes and renders a
manifest, so both are `raw-byte-digest`. Neither is a presentation exception,
and `docs/canonical-json-compatibility.md` needs no change: its test asserts
structural mentions, not a per-source row.

Nothing else in `gate:security` failed. On the failing run `test:security` was
1106 of 1107 with only this case red, and its earlier stages (`test:unit` 2103,
`test:contract` 497, `test:e2e` 165, `test:architecture` 46,
`test:qualification` 251) were all green with 0 skipped and 0 todo. The gate
stopped before `test:fault`, which is therefore recorded on its own.

### `test:fault` and one observed flake

`corepack pnpm test:fault` was run twice.

| Run | Result |
| --- | --- |
| First | 291 cases, 290 passed, 1 failed, 0 skipped, 0 todo |
| Second | 291 cases, 291 passed, 0 failed, 0 skipped, 0 todo |

The first run's failure was `the production crash matrix satisfies the closed
application verdict` in the pre-existing
`tests/fault-injection/self-test-full-crash-matrix.test.mjs`. That file passes
23 of 23 in isolation and passed in the second full run, so it is a load- and
timing-dependent flake in a disposable Self-Test fixture root, matching the
Windows fixture flakiness this feature's T1 handoff already recorded. It is not
attributable to this change: nothing here touches Self-Test, and all seven new
activation-launcher fault cases passed in both runs.

The flake is reported rather than suppressed. No assertion was weakened,
retried, or skipped to obtain the green run.

## Remaining completion evidence

- Real TUF root, fixed source URLs, and source identity from T76, supplied to
  `build:vestra-launcher --release-inputs`. The `releaseId` and
  `semanticVersion` in that `release-source.json` are now asserted against the
  resolved release, so they must name the exact release T76 publishes.
- T76 launchers that answer `--activation-health` with the version 1 report
  this feature's health gate consumes.
- Owner control or republication of the npm name `vestra`.
- Repository-free `npm pack` installation and supported-platform evidence (T4).
- One live resolution over the pinned HTTPS source. The end-to-end evidence
  above drives a filesystem TUF repository, because no test may reach the public
  network or trust a self-signed certificate. `HttpsDistributionSource` is
  qualified by its own suites and by the pinned-input contract, but the
  composed `npx vestra` -> HTTPS -> activation path is proved only by T4's
  clean-machine run.

Fixtures are not accepted as substitutes for any of these items.
