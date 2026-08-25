# npx Launcher Specification

## Problem Statement

Verchestra's qualified distribution path can resolve a TUF release and activate
it transactionally, but no stable command maps the authoritative
`installRoot/active.json` pointer back to the activated `launcher:vestra`
component. The source CLI is private and imports TypeScript directly, so it is
not a publishable clean-machine entry point.

AD-016 fixes the 1.0 shape as `npx vestra`: ambient Node performs bootstrap
only, then control transfers to the activated hermetic bundle and its embedded
Node 24.14.0 runtime.

## Goals

- Provide a thin, publishable npm package named `vestra` with one `vestra` bin.
- Reuse the qualified TUF staging and transactional activation path.
- Resolve the active launcher from verified installed metadata, never from a
  hard-coded fixture path.
- Prove a repository-free clean-machine journey and deterministic failures.

## Out of Scope

| Item | Reason |
| --- | --- |
| Per-target single binary | Explicitly deferred post-1.0 by AD-016. |
| A second updater or installer | TUF resolution and transactional activation are canonical. |
| Publishing or promoting 1.0 | T76 creates the candidate; T77 decides acceptance. |
| Runtime package/dependency resolution inside the activated bundle | The hermetic bundle contract fixes `runtimeResolver: false`. |

## User Stories

### P1: Clean-machine entry point

As a user on a supported machine, I want `npx vestra` to resolve, activate,
and run the verified CLI without cloning or building the repository.

Acceptance criteria:

1. WHEN `npx vestra` runs on a supported platform and architecture THEN the
   bootstrap SHALL resolve the pinned release through the bundled TUF trust
   root, activate it transactionally, and execute its `launcher:vestra` with
   the original arguments.
2. WHEN a release is already active THEN the bootstrap SHALL revalidate its
   installed manifest and component bytes before executing it.
3. WHEN control transfers THEN the activated launcher's exit status and
   standard streams SHALL be the command's observable result.
4. WHEN `--help`, `--version`, or the portability demo is requested THEN output
   SHALL describe only composed behavior and the activated release identity.

### P1: Fail-closed bootstrap

As a security reviewer, I want every authority and platform ambiguity to stop
before unverified code executes.

Acceptance criteria:

1. WHEN the host is unsupported THEN the bootstrap SHALL fail deterministically
   before network, staging, activation, or child execution.
2. WHEN the trust root, TUF view, active pointer, installed manifest, component
   bytes, launcher identity, or health evidence is missing or invalid THEN no
   launcher SHALL execute.
3. WHEN user arguments cross the process boundary THEN they SHALL remain an
   argument vector; shell interpolation SHALL NOT be used.
4. WHEN an error is rendered THEN it SHALL expose a stable public code and
   actionable message without credentials, secret values, or machine-local
   paths.

### P1: Auditable npm artifact

As a release verifier, I want the tarball itself to prove that ambient Node is
only a bootstrap boundary.

Acceptance criteria:

1. WHEN `npm pack` runs THEN the tarball SHALL contain only compiled bootstrap
   code, the bin, pinned public configuration and TUF root, package metadata,
   license, and user documentation.
2. WHEN the tarball is inspected THEN it SHALL contain no TypeScript source
   imports, workspace dependency, install script, credential, private key,
   machine-local path, or unpinned runtime downloader.
3. WHEN release configuration changes THEN the trust root, source identity,
   metadata URL, and target URL SHALL change through reviewed tracked inputs,
   never environment substitution.

### P2: Cleanup and recovery

As an operator, I want documented cleanup and safe retry behavior.

Acceptance criteria:

1. WHEN staging or activation is interrupted THEN a retry SHALL converge using
   the qualified TUF and activation recovery contracts.
2. WHEN cleanup is requested THEN documentation SHALL distinguish npm cache,
   managed install state, and user-owned workspace data.

## Edge Cases

- A valid pointer names a missing, mixed, symlinked, or byte-tampered release.
- A manifest contains no `launcher:vestra`, contains duplicates, or maps it to
  a non-launcher component.
- The activated child exits non-zero or terminates by signal.
- Windows bundle launchers are command files rather than directly spawnable
  executables; passthrough arguments must never force `shell: true`.
- The npm name is unavailable or not controlled by the repository owner.

## Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| NPX-01 | One repository-free `npx vestra` command on every supported target | Blocked by T76 artifacts |
| NPX-02 | Pinned in-package TUF root and fixed credential-free HTTPS source | Blocked by T76 inputs |
| NPX-03 | Qualified resolve, stage, and transactional activation reuse | Done |
| NPX-04 | Read-only verified active-launcher resolution | Done |
| NPX-05 | Real pre-publication activation health gate | Blocked by T76 launcher protocol |
| NPX-06 | Shell-free argument-preserving handoff and exact exit propagation | Pending |
| NPX-07 | Deterministic supported-host and public-error contract | Pending |
| NPX-08 | Minimal compiled npm tarball with no workspace/runtime-resolution leak | Done |
| NPX-09 | Help, version, portability demo, cleanup, and per-platform evidence | Blocked by T76 candidate |
| NPX-10 | No clone, source build, credential, or hidden authority prerequisite | Pending |

Coverage: 10 requirements; 10 mapped in `tasks.md`; 0 unmapped.

## Current External Inputs

T76 issue #17 owns the real candidate closure, TUF root and delegated
metadata, online/offline views, executable launchers, and rollback target.
Those artifacts do not exist in the repository at the start of this feature.
The npm registry reports that `vestra` was unpublished on 2026-07-25; the
repository owner must confirm control/republication before a public release.
Neither condition blocks the verified active-launcher bridge, but both block a
truthful completion claim for #36.

## Success Criteria

- The active pointer can be resolved to exactly one reverified
  `launcher:vestra` without executing it.
- A packed launcher runs help, version, and the portability demo from a clean
  supported machine using T76's real release inputs.
- `pnpm gate:build` passes with no skipped or weakened test.
- #36 closes only with clean-machine, per-platform evidence tied to T76.
