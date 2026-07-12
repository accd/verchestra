# T01 Validation — Node Runtime and Launchers

**Gate:** `corepack pnpm@10.34.5 gate:build`  
**Result:** 16 passed, 0 failed, 0 skipped, 0 todo  
**SPEC_DEVIATION:** none

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Node patch is exact | `spikes/node-runtime/test/bundle.test.mjs:40` — `assert.equal(pkg.engines.node, "24.14.0")` | Node 24.14.0 is pinned | Yes |
| Executed runtime matches the pin | `bundle.test.mjs:41` — `assert.equal(process.versions.node, pkg.engines.node)` | Gate runs on the pinned patch | Yes |
| pnpm release is exact | `bundle.test.mjs:46` — `assert.equal(pkg.packageManager, "pnpm@10.34.5")` | pnpm 10.34.5 is pinned | Yes |
| Bundle is platform-bound | `bundle.test.mjs:51` — `assert.equal(manifest.platform, process.platform)` | Manifest records the actual platform | Yes |
| Bundle is architecture-bound | `bundle.test.mjs:52` — `assert.equal(manifest.arch, process.arch)` | Manifest records the actual architecture | Yes |
| Canonical command is `vestra` | `bundle.test.mjs:57` — `assert.equal(manifest.canonicalCommand, "vestra")` | Canonical executable name is exact | Yes |
| Alias is `verchestra` | `bundle.test.mjs:58` — `assert.deepEqual(manifest.compatibilityAliases, ["verchestra"])` | One declared compatibility alias | Yes |
| Windows launcher templates are identical | `bundle.test.mjs:62-63` — both files equal `renderWindowsLauncher()` | Both names execute the same Windows body | Yes |
| POSIX launcher templates are identical | `bundle.test.mjs:67-68` — both files equal `renderUnixLauncher()` | Both names execute the same POSIX body | Yes |
| Human version semantics match | `bundle.test.mjs:74-77` — both status `0`, stdout/stderr equal | VES-CLI-001/002 equivalence | Yes |
| JSON version semantics match | `bundle.test.mjs:83-84` — status `0`, parsed payloads deep-equal | VES-CLI-002/005 equivalence | Yes |
| Help semantics match | `bundle.test.mjs:90-91` — status `0`, stdout equal | Canonical help is alias-independent | Yes |
| Unknown input failure is stable | `bundle.test.mjs:97-99` — both status `64`, stderr equal | Stable usage error with identical effects | Yes |
| Ambient Node/PATH is unnecessary | `bundle.test.mjs:105-106` — status `0`, output matches qualified version | Bundled relative runtime executes with empty PATH | Yes |
| Tampered application is rejected | `bundle.test.mjs:114-115` — status `70`, exact integrity-class message | Partial/corrupt candidate cannot activate | Yes |
| Wrong platform is rejected | `bundle.test.mjs:124-125` — status `70`, exact platform mismatch | Wrong-platform candidate fails closed | Yes |
| Release digest is exact | `bundle.test.mjs:131-132` — status `0`, payload digest equals file SHA-256 | Version output identifies the release view | Yes |
| Runtime digest is exact | `bundle.test.mjs:138` — manifest digest equals bundled runtime SHA-256 | Runtime is bound into the release manifest | Yes |
| Bundle has no ambient package tree | `bundle.test.mjs:144` — `assert.equal(...includes("node_modules"), false)` | Hermetic spike resolves no runtime dependency | Yes |

Native Windows execution is covered on this host. POSIX launcher semantics are covered by deterministic template assertions; native Linux/macOS execution remains explicitly assigned to the release platform matrix and is not misreported here.

## Check B — Non-shallow litmus

- Every alias test asserts exit status and output/error value, not call count.
- Integrity tests modify the real generated bundle and assert the exact failure class.
- The empty-PATH test executes the generated launcher and bundled runtime rather than inspecting configuration only.
- A wrong implementation using ambient Node, divergent alias logic, no digest check, or permissive platform loading fails at least one test.

## Check C — Necessary tests

| Test behavior | Maps to | Keep |
| --- | --- | --- |
| Node/pnpm pins | T01 Done-when; VES-CLI-001 | Keep |
| Platform/arch manifest | T01 Done-when; VES-RLS-001/002 | Keep |
| Command/alias metadata and templates | VES-CLI-001/002 | Keep |
| Human/JSON/help/unknown equivalence | VES-CLI-001/002/003/005 | Keep |
| Empty PATH | T01 hermetic-runtime criterion; VES-RLS-002 | Keep |
| Tamper/platform rejection | VES-CLI-004; VES-RLS-001/002 | Keep |
| Release/runtime hashes | VES-CLI-001/004; VES-RLS-002 | Keep |
| No `node_modules` | T01 no ambient resolution criterion; VES-RLS-002 | Keep |

## Check D — Guideline conformance

Tests follow `.specs/features/verchestra-1.0/tasks.md` T01 and its contract/build coverage matrix. No pre-existing implementation repository guidelines existed.

## Verdict

PASS — all T01 criteria are covered by spec-anchored, discriminating, necessary assertions. No test was weakened, deleted, skipped, or deferred.
