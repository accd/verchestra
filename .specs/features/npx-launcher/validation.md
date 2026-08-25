# npx Launcher Validation

## Current verdict

**PARTIAL - T1, T2 PASS; T3's artifact contract PASS; #36 remains open.** The
verified active-launcher bridge, the observed activation health gate, the
shell-free handoff, and the publishable package's artifact contract are
implemented and verified. The clean-machine journey is not claimed: the public
tarball still carries no activation closure, and its T76-owned trust root,
source URLs, and executable candidate release do not exist.

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

NPX-01 is **not** claimed. The tarball builds, packs, and runs, but it carries
no activation closure and no reviewed trust root, so no repository-free command
resolves a release today.

## Repository gates

| Command | Result |
| --- | --- |
| `corepack pnpm agent:check` | PASS |
| `corepack pnpm gate:quick` | PASS - 164 cases, 0 failed, 0 skipped, 0 todo |
| `corepack pnpm gate:build` | PASS - every stage green |
| `corepack pnpm gate:security` | FAIL - one census registration is owed; see below |

`gate:build` per-stage counters, all with 0 failed, 0 skipped, 0 todo:

| Stage | Tests |
| --- | --- |
| `test:unit` | 2103 |
| `test:contract` | 497 |
| `test:integration` | 639 |
| `test:e2e` | 165 |
| `test:architecture` | 46 |
| `test:build` | 62 |
| `test:qualification` | 251 |

### The one open gate failure

`tests/security/canonical-json-census.test.mjs` reports three `missingPaths`.
`docs/canonical-json-census.json` must classify every product source that emits
a canonical-JSON signal, and this change adds three such sources. That census
file is owned by concurrent work and was deliberately left untouched, so the
entries below are owed rather than applied. They are mechanical: the signal
counts are exactly what `collectCensusCandidates` measures today.

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

Nothing else in `gate:security` failed. `test:security` ran 1107 cases with this
single failure, and its earlier stages (`test:unit` 2103, `test:contract` 497,
`test:e2e` 165, `test:architecture` 46, `test:qualification` 251) were all green
with 0 skipped and 0 todo. The gate stopped before `test:fault`, which is
therefore recorded on its own.

## Remaining completion evidence

- Real TUF root, fixed source URLs, and source identity from T76, supplied to
  `build:vestra-launcher --release-inputs`.
- An owner decision on how the qualified TUF and activation closure is emitted
  into a public tarball without a workspace import: an approved bundler, or a
  pinned public runtime dependency on `tuf-js`.
- T76 launchers that answer `--activation-health` with the version 1 report
  this feature's health gate consumes.
- Owner control or republication of the npm name `vestra`.
- Repository-free `npm pack` installation and supported-platform evidence (T4).

Fixtures are not accepted as substitutes for any of these items.
