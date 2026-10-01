# Pi runtime 0.87.1 validation

**Date:** 2026-09-29
**Diff:** `requal/pi-0.85.1` from `cb563611da8b1ff80aa204536138f9440a0bff91`
**Verifier:** primary agent local verification; GitHub required checks remain authoritative

## Root cause

Both #415 failures are the exact-pin probe at
`packages/drivers/src/pi-driver.ts:14` rejecting the new installed version.
`tests/contract/pi-driver.test.mjs:14` observed `VES_PI_VERSION_UNSUPPORTED`;
`tests/contract/driver-lifecycle-matrix.test.mjs:136` observed the same probe as
`available: false`. After the pin moved,
`tests/integration/pi-driver-lifecycle.test.mjs:7` observed `visible:2` because
Pi 0.86.0 declares tools through a leading transcript system message. The
upstream review is in `docs/qualification/pi-runtime-0.87.1.md`.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PI-01 | `tests/agent-readiness/dependency-policy.test.mjs:13-14` asserts both manifest pins; `:21` asserts the only lock entries are `0.87.1`; `spikes/pi-runtime/test/pi-boundary.test.mjs:31-32` repeats the manifest pin | PASS |
| PI-02 | `tests/contract/pi-driver.test.mjs:14-23` expects the observed `0.87.1` with capabilities; `:37-49` rejects a drifted `0.83.0`; `tests/contract/driver-lifecycle-matrix.test.mjs:132-142` requires the configured probe to be available | PASS |
| PI-03 | Fresh transcript `tests/integration/pi-driver-lifecycle.test.mjs:38-40` (exact provider-visible transcript per start) and `spikes/pi-runtime/test/pi-boundary.test.mjs:168`; tool mediation `pi-boundary.test.mjs:61,83` and `tests/contract/pi-driver.test.mjs:193,209`; abort `pi-boundary.test.mjs:104` and `pi-driver-lifecycle.test.mjs:63`; usage `pi-boundary.test.mjs:40` and `pi-driver.test.mjs:52`; privacy `pi-boundary.test.mjs:158` and `pi-driver.test.mjs:232` | PASS |
| PI-04 | `docs/qualification/pi-runtime-0.87.1.md` "Upstream change review" and "Transitive dependency changes" | PASS |
| PI-05 | `corepack pnpm qualify:pi` 12/12; Pi contract, lifecycle matrix, and integration 51/51; `pnpm test:qualification` 254/254; `pnpm gate:quick`, `pnpm gate:full`, `pnpm gate:security` PASS; faux provider only | PASS locally; pending externally |

## Test change

`tests/integration/pi-driver-lifecycle.test.mjs:7` keeps its original
`["visible:1", "visible:1"]` assertion, now counted over non-system messages,
and adds an exact assertion that each start's provider-visible transcript is one
system message with an empty prompt declaring only `vestra_read`, followed by a
single user message. Before 0.86.0 the equivalent shape was `[user]`; the new
assertion also rejects a leaked system prompt or an unauthorized tool
declaration.

## Discrimination sensor

| Mutant | Result |
| --- | --- |
| Driver reuses one Pi `Agent` across starts and skips `reset()` at close | Killed: freshness test observed `visible:3` on the second start |
| Probe manifest reports `0.84.2`, `0.85.1`, or `0.86.1` | Killed: `VES_PI_VERSION_UNSUPPORTED` for each; only `0.87.1` accepted |

## External verification

The Linux Quality and Site jobs, CodeQL, and the required review rule must pass
on the exact pushed head before merge. This report makes no production-readiness
or 1.0 claim.
