# npx Launcher Design

**Spec:** `.specs/features/npx-launcher/spec.md`
**Status:** Approved by AD-016; release-input integration remains blocked by T76

## Architecture

The public `vestra` package is a second, narrowly scoped composition root. Its
ambient-Node process performs only host validation, TUF resolution, staging,
activation, active-launcher resolution, and process handoff. Product behavior
runs exclusively inside the activated bundle.

Flow: `npx verchestra` -> bundled root/config -> `TufUpdateClient` ->
`TransactionalActivationManager` -> verified active launcher -> embedded
runtime/CLI.

## Reuse Analysis

| Component                   | Location                                                | Reuse                                                                                         |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| TUF client and HTTPS source | `packages/distribution/src/tuf-update-client.ts`        | Resolve and stage the exact host release with pinned trust.                                   |
| Transactional activation    | `packages/distribution/src/transactional-activation.ts` | Reverify, health-gate, publish, recover, and switch `active.json`.                            |
| State-root conventions      | `packages/platform-node/src/state-root.ts`              | Derive an OS-qualified machine-local parent; launcher state remains separate from workspaces. |
| Safe child-process contract | `packages/platform-node/src/gate-commit-adapters.ts`    | Follow argument-array, `shell: false`, timeout, bounded-output, and process cleanup patterns. |
| Hermetic bundle manifest    | `packages/distribution/src/hermetic-bundle.ts`          | Select components by identity and verified logical path.                                      |

## Components

### Verified active-launcher resolver

- **Location:** `packages/distribution/src/transactional-activation.ts`
- **Interface:** `resolveActiveLauncher()`; the method intentionally resolves
  only the canonical `launcher:vestra` identity.
- **Behavior:** validate `active.json`; reopen and verify the installed bundle
  and every component; bind pointer identity to the bundle; select exactly one
  `launcher:vestra`; return an immutable pointer plus contained executable
  path. No execution and no hard-coded filename.

### Activation health gate

- **Location:** public launcher composition, exact file pending T76 executable
  health protocol.
- **Behavior:** run the staged closure before publication and produce the exact
  migration/native/driver plus dual-launcher evidence required by
  `ActivationHealthGatePort`.
- **Constraint:** evidence is observed, never synthesized. This component
  cannot be completed against today's placeholder bundle bytes.

### Publishable launcher package

- **Location:** planned `apps/vestra-launcher/`, npm name `vestra`.
- **Artifact:** one compiled self-contained ESM bootstrap plus bin, public
  root/config assets, README, license, and manifest.
- **Constraint:** no runtime workspace package import. The build/bundle method
  must use an existing approved dependency or receive explicit dependency
  approval; the current repository is `noEmit` and source-only.

### Handoff executor

- **Behavior:** spawn the verified launcher directly with an argument vector,
  inherited standard streams, no shell, and exact child termination
  propagation. A `.cmd`-only Windows candidate is not accepted without a
  separately specified and injection-tested execution contract.

## Data and Authority Boundaries

`active.json` is a small authority pointer, not a path. The release path is
derived from its SHA-256 digest under `installRoot/releases/`; `release.json`
is then verified and supplies the launcher's logical path. TUF trust bytes and
source URLs are immutable package inputs. Environment variables may select no
trust root, repository, executable, or release.

## Error Strategy

| Scenario                        | Outcome                                                 |
| ------------------------------- | ------------------------------------------------------- |
| Unsupported host                | Stable public error before effects                      |
| TUF or activation failure       | Preserve canonical error code; execute nothing          |
| Missing/tampered active release | Integrity error; execute nothing                        |
| Ambiguous/missing launcher      | Closed launcher-resolution error                        |
| Child non-zero/signal           | Propagate the child's observable result                 |
| Missing T76 inputs              | Package build/release fails; never substitutes fixtures |

## Decisions

| Decision          | Choice                                             | Rationale                                          |
| ----------------- | -------------------------------------------------- | -------------------------------------------------- |
| Entry point       | `npx verchestra`                                   | AD-016 owner decision                              |
| Active path       | Reopen verified installed manifest                 | `active.json` intentionally contains no path       |
| Launcher identity | `componentId === "launcher:vestra"`                | Logical paths are bundle-owned and target-specific |
| Execution         | Direct process, `shell: false`                     | Prevent argument interpolation/injection           |
| Real trust/config | Generated or supplied by T76                       | Fixtures are not release authority                 |
| Completion        | Remains open until clean-machine platform evidence | Avoid installer/readiness claims before T76        |
