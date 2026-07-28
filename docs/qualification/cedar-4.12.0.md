# Cedar Policy Boundary Requalification

**Maintenance scope:** dependency refresh after T68  
**Status:** Qualified for the existing T06 contract  
**Qualified package:** `@cedar-policy/cedar-wasm/nodejs` 4.12.0  
**Cedar engine / SDK:** 4.12.0  
**Cedar language:** 4.5 (unchanged)

## Qualification boundary

This report supersedes the engine-version identity recorded by the original
T06 qualification without changing its architecture or advancing the product
roadmap. Cedar remains the authorization oracle behind the Policy port and
owns no Verchestra workflow, artifact, Approval, or durable state. T68 remains
complete and T69 remains the next product task.

The **language version stays 4.5**. Only the engine and SDK move, so no policy
in the frozen corpus changes meaning and no policy text was edited.

## Why the pin had to move

Unlike a driver floor, the Cedar expectation is an exact equality: the oracle
denies when `getCedarVersion()` or `getCedarSDKVersion()` differs from the
expected engine version. `@cedar-policy/cedar-wasm` is a direct runtime
dependency of `packages/policy`, so the shipped engine and the expected version
must match exactly or every authorization fails closed. The pin therefore moves
with the package, in `packages/policy/src/cedar-policy.ts` and in the spike
oracle.

The deliberately mismatched version used to prove fail-closed behavior
(`tests/helpers/policy-fixture.mjs`, `engine-version` scenario) stays 4.11.1,
which remains different from the real engine and so still exercises the deny
path.

## Proven behavior

- Both official loaders report engine 4.12.0, language 4.5, and SDK 4.12.0.
- The ESM and Node loader differential corpus agrees on allow, implicit deny,
  forbid-wins, egress allow, and egress deny.
- Release-form selection still chooses the official Node WASM form only when
  every release condition passes, and fails closed when none does.
- The frozen policy oracle reproduces every recorded outcome: approval,
  staleness, capability, evidence, claim, and action checks, plus forbid at the
  builtin, organization, workspace, project, user, and run layers, and the rule
  that a lower layer cannot permit what a higher layer forbids.

## Evidence

`corepack pnpm qualify:cedar` — 50 tests, 0 failures, 0 skipped.
`pnpm gate:security` PASS across format:check, lint, typecheck, build,
test:unit, test:architecture, test:qualification, test:security, and
test:fault. No policy decision changed; only the version identity moved.
