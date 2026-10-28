# Pi runtime 1.4.0 validation

**Date:** 2026-10-28
**Diff:** branch `build/563-pi-1-4` over `main` `b5819c6`
**Verifier:** primary agent local verification on Windows x64, Node 24.14.0;
GitHub required checks and the fleet remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PI-01 | `package.json:67-68` pin `1.4.0`, moved with `pnpm add -E -w -D`; `tests/agent-readiness/dependency-policy.test.mjs:13-14` (manifest) and `:21` (lockfile) assert exactly `1.4.0`. The lockfile moves the two packages, `pi-telemetry` and `@anthropic-ai/sdk` (exact dependencies of `pi-ai`), removes `chord`, `diff`, `ignore` and `yaml`, and dedupes `@google/genai`'s `ws` 8.21.3 → 8.22.0. pnpm also re-resolved `legacy-javascript` 0.0.3 to 0.0.4; that hunk was reverted, and `pnpm install --frozen-lockfile` passes | PASS |
| PI-02 | `packages/drivers/src/pi-driver.ts:18`; `tests/contract/pi-driver.test.mjs:20` pins the live probe to `1.4.0`, `:41` keeps `0.83.0` refused, and `:245` refuses `1.4.1`, `1.5.0`, `2.0.0` and `1.4.0-beta.1` as drift | PASS |
| PI-03 | With only the pins moved: `qualify:pi` 26 of 26 before the new case; `tests/contract/pi-driver.test.mjs`, `tests/integration/pi-driver-{agent-release,lifecycle}.test.mjs` and the dependency-policy test 43 of 43; `tests/contract/driver-lifecycle-matrix.test.mjs`, `tests/integration/driver-session-runner-drivers.test.mjs` and every test using the cancel-order and child-run fixtures 112 of 112 | PASS |
| PI-04 | `docs/qualification/pi-runtime-1.4.0.md`: changelogs 0.99.2 to 1.4.0, the published `0.99.1` and `1.4.0` packages compared file by file for every module the root entry loads, and the transitive changes | PASS |
| PI-05 | `spikes/pi-runtime/test/pi-boundary.test.mjs`, "refuses a tool call with malformed arguments before authorization or execution": 0 authorizations, 0 executions, the model sees an error result | PASS |
| PI-06 | See "Gates" | PASS locally; pending externally |

## Module graph

A resolve hook recorded every module that `import("@earendil-works/pi-agent-core")`
loads. `0.99.1`: 78 `pi-agent-core`, 26 `pi-ai`, 3 `pi-telemetry` and 1
`chord` modules (108), plus `typebox`, `yaml`, `diff`, `ignore` and
`partial-json`. `1.4.0`: 6, 28 and 4 (38), plus `typebox` and `partial-json`.
`pi-ai` drops `utils/assistant-message-frame.js` and adds `telemetry.js`,
`utils/identity.js` and `utils/version.js`; `pi-telemetry` adds `metrics.js`.
Twelve shared `pi-ai` modules and three `pi-telemetry` modules differ; each is
classified in the report. A scan of the 38 found no network, filesystem or
process handle opened at import.

## Control run

The malformed-arguments case was run twice outside the suite with the same
call: with `argumentsError` it was neither authorized nor executed; without
it, it was authorized once and executed once. The arguments satisfy the tool's
schema, so the `argumentsError` rule alone decides the refusal.

## Identity observation

A 1.4.0 `Agent` built like the driver's passes its stream function
`options.identity = { attribution: { name: "pi", url: "https://pi.dev",
categories: ["cli-agent"] } }`. The driver supplies that function from the
execution, so the decision to send attribution stays with it.

## Gates

- `qualify:pi`: 27 of 27, 0 skipped (26 before, plus the malformed-arguments case).
- `gate:quick`: PASS: `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit` 3169 of 3169, `test:agent-readiness` 401 of 401, `test:census` 13 of 13; 0 skipped.
- `agent:check`: PASS.

## External verification

Quality gate, Site quality and CodeQL must pass on the exact pushed head, and
the fleet runs `gate=full` on it. No production-readiness claim is made.
