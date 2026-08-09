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

**Status:** Blocked by the T76 executable launcher/health protocol.

**What:** Add the real health gate and shell-free child executor used by the
bootstrap.
**Where:** launcher composition sources and focused tests.
**Depends on:** T1 and T76's directly spawnable launcher/health protocol.
**Reuses:** `ActivationHealthGatePort` and the safe process contract.
**Requirements:** NPX-05, NPX-06, NPX-07.
**Tests:** unit + integration + security + fault.
**Gate:** `pnpm gate:security`.

Done when:

- [ ] All health evidence is observed from real staged bytes.
- [ ] Arguments never enter a shell command string.
- [ ] Exit, signal, timeout, output bound, and process cleanup cases pass.

### T3: Build the publishable `vestra` package

**What:** Add the minimal public composition root and deterministic tarball.
**Where:** planned `apps/vestra-launcher/`, architecture/gate-selection maps,
package metadata, pinned public assets, and pack tests.
**Depends on:** T2; T76 root/URLs/source identity; owner confirmation of npm
name control; explicit approval if a build dependency is required.
**Reuses:** TUF/activation APIs at build time; no workspace import at runtime.
**Requirements:** NPX-01, NPX-02, NPX-08, NPX-10.
**Tests:** architecture + build + security.
**Gate:** `pnpm gate:build` and `pnpm gate:security`.

Done when:

- [ ] `npm pack --dry-run` and tar inspection match the exact allowlist.
- [ ] The artifact contains compiled code and pinned public inputs only.
- [ ] No private/workspace/source import or install script remains.

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
| T2 | T1 + T76 protocol | T1 -> T2 | Match |
| T3 | T2 + release/registry inputs | T2 -> T3 | Match |
| T4 | T3 + T76 candidate | T3 -> T4 | Match |

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
