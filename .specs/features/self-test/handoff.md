---
schema: verchestra-feature-handoff/v1
feature: self-test
issue: 10
status: in_progress
branch: feat/t69-self-test-t2
baseRevision: c8d224be7dfff5f597435dae1a08ba4bd4ee6bf6
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm gate:security
updatedAt: 2026-08-01T16:00:00Z
---

# Scope

T69: the isolated Self-Test trust domain. Specification, design, and tasks are
written from verified code reading recorded in the design document; no product
code exists yet.

# Next Exact Action

T3: the adapter facts in `packages/self-test/` — disposable-root
provisioning and path-fact probing (realpath, junction, device and inode),
sentinel capture, the bounded fixture factory, cleanup with residue
reporting, quarantine mechanics, and test-only key material — implementing
the `SelfTestPorts` fact contracts from
`packages/application/src/self-test/self-test.ts`. Security tests: symlink
and junction escape captured in `linkChain`, production-material rejection.

# T2 evidence

30 unit cases in `tests/unit/self-test-rules.test.mjs` covering TST-01
(device/inode, containment both directions, link-chain escape, sibling
prefix negative, missing-fact fail-closed), TST-02, TST-03, TST-04, TST-05,
TST-06, and the orchestrator's no-mutation-on-overlap guarantee. Sensor:
path-containment forced fail-open, 4 tests killed it, restore ran 30/30.
`gate:quick` and `gate:security` PASS.

# Blockers

None. T68d is complete and the resolver reads T69 next.

# Decisions

- Profile ids reuse the sealed support-bundle enum; crash-recovery is a mode
  of `full`, never a fifth id.
- Ports return facts; overlap and sentinel verdicts are pure rules in
  application.
- No report JSON schema before T72.
