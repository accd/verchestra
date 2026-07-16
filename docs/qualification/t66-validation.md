# T66 Hermetic Distribution Bundle Validation

## Scope

- Task: T66 — Implement Hermetic Distribution Bundle builder
- Requirements: VES-RLS-001…002 and VES-CLI-001…004
- Commit target: `feat(distribution): build hermetic release bundles`
- Focused evidence: 50 build and security cases
- Required minimum: 30 cases
- Spec deviations: none

T66 establishes the closed release-candidate boundary used by later update, staging, and activation tasks. The builder accepts one exact release and target view, validates every component, creates a canonically ordered offline closure, and derives a content-addressed release identity. The closure contains the pinned Node runtime, compiled code, schemas, migrations, policies, Cedar/WASM and native SQLite assets, Drivers, Connectors, Skills, licenses, SBOM, provenance, evaluation evidence, and both launchers.

The bundle carries no URL, package range, install script, credential, local path, or runtime resolver authority. T66 does not activate the candidate: VES-CLI-004 activation and rollback behavior remains assigned to T68. It prevents an invalid candidate from reaching that boundary.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/build/hermetic-bundle.test.mjs tests/security/hermetic-bundle-security.test.mjs` | PASS — 50 passed, 0 failed/skipped |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm gate:security` | PASS — format, lint, typecheck/build, unit/property, contract, integration, E2E, architecture, qualification, security, and 176 fault cases |

## Spec-anchored adequacy matrix

| Requirements / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| VES-RLS-001 complete hermetic closure | `tests/build/hermetic-bundle.test.mjs` complete-closure and per-kind omission cases | Every mandatory runtime, code, policy, data, evidence, and launcher kind is present or build fails closed | PASS |
| VES-RLS-002 one verified release view | `tests/security/hermetic-bundle-security.test.mjs` mixed-release, target, digest, and identity cases | Components cannot cross release, platform, architecture, or semantic identity boundaries | PASS |
| Offline execution authority | `tests/build/hermetic-bundle.test.mjs` runtime-resolver case; security URL/range/install-script cases | The bundle contains no resolver or fetch authority and cannot defer dependency selection to runtime | PASS |
| Licensed and attested contents | `tests/security/hermetic-bundle-security.test.mjs` license and attestation reference cases | Executable/runtime contents resolve to bundled licenses and provenance/evaluation evidence | PASS |
| VES-CLI-001…003 dual launchers | `tests/build/hermetic-bundle.test.mjs` canonical-launcher and omission cases | Exact `vestra` and `verchestra` launchers are members of the same target closure | PASS |
| VES-CLI-004 activation precondition | Complete closure, target, digest, and launcher cases across both suites | Only a structurally complete, content-addressed candidate may be presented to T68 activation | PASS — activation itself deferred to T68 |
| Safe portable closure paths | `tests/security/hermetic-bundle-security.test.mjs` traversal, absolute, Windows, reserved-name, separator, and duplicate-path cases | Bundle materialization cannot escape or ambiguously address its target root | PASS |
| Deterministic release identity | `tests/build/hermetic-bundle.test.mjs` ordering and digest-change cases; forged-digest security case | Equivalent closures have one identity and any semantic content change changes or invalidates it | PASS |

## Independent discrimination sensor

The standalone TLC Verifier copied the complete uncommitted T66 implementation into a detached disposable worktree, installed the locked graph offline, committed an isolated verifier baseline, injected one behavior fault at a time, restored after every run, reran all 50 focused cases, and safely removed the scratch tree. The active implementation worktree was never mutated.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Bypass a missing mandatory component-kind rejection | KILLED |
| M2 | Accept a target-platform mismatch | KILLED |
| M3 | Permit runtime dependency resolution authority | KILLED |
| M4 | Permit an unlicensed executable component | KILLED |
| M5 | Replace semantic release identity with a constant digest | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The manifest schema and every component schema are closed; unknown fields cannot smuggle installation authority.
- Required component kinds are checked independently, so a generic file list cannot masquerade as a complete runtime.
- Platform-specific assets must exactly match the requested platform and architecture; portable assets are explicitly `any/any`.
- Every component repeats the exact release identity, preventing a self-consistent manifest from mixing releases.
- License and attestation references resolve by component identity and permitted evidence kind rather than by unverified labels.
- Canonical component ordering makes bundle identity independent of input order while remaining sensitive to component content.
- The returned manifest and nested closure are deeply immutable.
- Paths are relative POSIX bundle paths and reject traversal, absolute paths, drive-qualified paths, backslashes, reserved device names, and ambiguous separators.
- The bundle contains both canonical launchers as ordinary verified closure members, not special unmeasured files.

## Verdict

PASS for T66. Verchestra now builds one deterministic, content-addressed, licensed, attested, target-specific, offline release closure with both launchers and no runtime resolution authority. Missing, mixed-release, wrong-platform, unlicensed, unattested, unsafe, or forged inputs fail closed before update staging or activation.
