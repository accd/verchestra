# npx Launcher Validation

## Current verdict

**PARTIAL - T1 PASS; #36 remains open.** The verified active-launcher bridge is
implemented. The public npm package and clean-machine journey are not claimed
because their T76-owned authority and executable inputs do not yet exist.

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

## Repository gates

| Command | Result |
| --- | --- |
| `corepack pnpm agent:check` | PASS |
| `corepack pnpm gate:quick` | PASS |
| `corepack pnpm test:security` | PASS: 1001 passed, 0 failed, 0 skipped, 0 todo |
| `corepack pnpm gate:build` | INCONCLUSIVE locally: two runs reached integration and then reported 5 and 4 Windows `EBUSY` cleanup failures in disposable self-test fixture roots; all T1 cases passed |
| `gate:build` repository workflow | PASS on `bfab60355942e5a19259a0ee3dc40c9a377778be`: [run 31332661966](https://github.com/accd/verchestra/actions/runs/31332661966) |
| `gate:security` repository workflow | PASS on `bfab60355942e5a19259a0ee3dc40c9a377778be`: [run 31332772835](https://github.com/accd/verchestra/actions/runs/31332772835) |

The local build gate is not recorded as a pass. Its deterministic code checks
completed, and the repository workflow passed the same gate on the exact
review commit, confirming the remaining local result was environment-specific.

## Remaining completion evidence

- Real TUF root, fixed source URLs and source identity from T76.
- Executable bundle bytes and an observed activation health protocol.
- Approved deterministic JavaScript package build with an exact tar allowlist.
- Owner control/republication of the npm name `vestra`.
- Repository-free `npm pack` installation and supported-platform evidence.

Fixtures are not accepted as substitutes for any of these items.
