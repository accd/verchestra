# Pi runtime 0.99.1 validation

**Date:** 2026-10-03
**Diff:** `deps/pi-runtime-0-99-1` from `9448f139f51780ae39bb08aafe023c5217128f94`
**Verifier:** primary agent local verification; GitHub required checks remain authoritative

## Root cause

The #490 Quality failure is the exact-pin probe at
`packages/drivers/src/pi-driver.ts:19` rejecting the new installed version:
`tests/contract/pi-driver.test.mjs:16` observed `VES_PI_VERSION_UNSUPPORTED`
with `version: "0.99.1"`. After the pin moved, no other assertion failed. The
upstream review is in `docs/qualification/pi-runtime-0.99.1.md`.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PI-01 | `tests/agent-readiness/dependency-policy.test.mjs:13-14` asserts both manifest pins; `:21` asserts the only lock entries are `0.99.1`; `spikes/pi-runtime/test/pi-boundary.test.mjs:31-32` repeats the manifest pin; the lockfile was written by `pnpm add -D -w --save-exact` and `pnpm install --frozen-lockfile` reports it up to date | PASS |
| PI-02 | `tests/contract/pi-driver.test.mjs:14-23` expects the observed `0.99.1` with capabilities; `:37-50` rejects a drifted `0.83.0`; `:245-260` rejects `0.99.2`, `0.100.0`, `1.0.0`, and `0.99.1-beta.1`; `tests/contract/driver-lifecycle-matrix.test.mjs:132-142` requires the configured probe to be available | PASS |
| PI-03 | Fresh transcript `tests/integration/pi-driver-lifecycle.test.mjs:38-40` (exact provider-visible transcript per start) and `spikes/pi-runtime/test/pi-boundary.test.mjs:196`; tool mediation `pi-boundary.test.mjs:61,83` and `tests/contract/pi-driver.test.mjs:193,209`; abort `pi-boundary.test.mjs:132` and `pi-driver-lifecycle.test.mjs:63`; usage `pi-boundary.test.mjs:40` and `pi-driver.test.mjs:52`; privacy `pi-boundary.test.mjs:186` and `pi-driver.test.mjs:232`; agent release `tests/integration/pi-driver-agent-release.test.mjs:44-87`; cancel order and usage rule `spikes/pi-runtime/test/pi-driver-cancel-order.test.mjs` and `pi-driver-usage.test.mjs`. None of these files changed | PASS |
| PI-04 | `docs/qualification/pi-runtime-0.99.1.md` "Upstream change review", "Event sequence comparison", and "Transitive dependency changes" | PASS |
| PI-05 | `spikes/pi-runtime/test/pi-boundary.test.mjs:107-130` asserts one execution, exactly one `tool.completed` with `isError: true`, and that the model saw `isError: true`; killed against the `0.87.1` runtime (sensor below) | PASS |
| PI-06 | Gate results below; faux provider only | PASS locally; pending externally |

## Gate results

All on `ec45bd5` (the implementation commit), run one at a time.

| Command | Result |
| --- | --- |
| Focused Pi suites: `tests/contract/pi-driver.test.mjs`, `tests/contract/driver-lifecycle-matrix.test.mjs`, `tests/integration/pi-driver-agent-release.test.mjs`, `tests/integration/pi-driver-lifecycle.test.mjs`, `tests/integration/driver-session-runner-drivers.test.mjs`, `tests/agent-readiness/dependency-policy.test.mjs` | PASS, 147/147 |
| `pnpm qualify:pi` | PASS, 26/26 |
| `pnpm gate:quick` | PASS; unit 2666/2666, agent-readiness 331/331, census 13/13 |
| `pnpm test:architecture` | PASS, 122/122 |
| `pnpm test:contract` | PASS, 806/806 |
| `pnpm test:integration` | PASS, 1142/1142 |
| `pnpm test:qualification` | PASS, 348/348 |
| `pnpm gate:build` | PASS; adds e2e 275/275 and build 172/172 |
| `pnpm gate:security` | PASS; adds security 1324/1324 and fault 309/309 |

No test was skipped, marked todo, or cancelled.

## Test changes

- Pin moves only: `tests/agent-readiness/dependency-policy.test.mjs:13-14,21`,
  `spikes/pi-runtime/test/pi-boundary.test.mjs:31-32`,
  `tests/contract/pi-driver.test.mjs:20`, and the spike identity at
  `spikes/pi-runtime/src/pi-boundary.mjs:18`.
- `tests/contract/pi-driver.test.mjs:245` moves the drift cases with the pin.
  Each keeps its role: next patch `0.87.2` → `0.99.2` (now a published
  release), next minor `0.88.0` → `0.100.0`, major `1.0.0` unchanged, and the
  prerelease `0.87.1-beta.1` → `0.99.1-beta.1`.
- Added `spikes/pi-runtime/test/pi-boundary.test.mjs:107-130` for the new
  runtime behaviour. No test was deleted or loosened.

Intentionally unchanged: `tests/unit/driver-version-probe.test.mjs` uses
`0.87.1` as the exact requirement of its own fixture profile ("Fixture CLI"),
not as the Pi pin; it tests the version probe module at its interface, and
`.specs/features/architecture-deepening/validation-c3.md` cites it by name.
The historical Pi reports and feature records that name `0.87.1` are evidence
for their own revisions and are not rewritten.

## Discrimination sensor

| Mutant | Result |
| --- | --- |
| `node_modules` repointed at the `0.87.1` runtime (restored afterwards) | Killed: "completes a tool that reports its own failure as an error" failed; the other 12 spike boundary cases passed |
| Probe manifest reports the previously qualified `0.87.1` | Killed: `VES_PI_VERSION_UNSUPPORTED` |
| Probe manifest reports the published `0.99.0` | Killed: `VES_PI_VERSION_UNSUPPORTED` |
| Probe manifest reports the published `0.99.2` | Killed: `VES_PI_VERSION_UNSUPPORTED`; only `0.99.1` accepted |

## External verification

The Linux Quality and Site jobs, CodeQL, and the required review rule must pass
on the exact pushed head before merge. This report makes no production-readiness
or 1.0 claim.
