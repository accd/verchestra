---
schema: verchestra-feature-handoff/v1
feature: self-test
issue: 10
status: in_progress
branch: feat/t69-self-test-t3
baseRevision: c6cb743f4c7b1683655dc0f783b6d6f1143b200c
lastCompletedTask: T3
nextTask: T4
lastGate: pnpm gate:security
updatedAt: 2026-08-01T16:45:00Z
---

# Scope

T69: the isolated Self-Test trust domain. Specification, design, and tasks are
written from verified code reading recorded in the design document; no product
code exists yet.

# Next Exact Action

T4: `apps/vestra-cli/src/self-test-composition.ts` — the only place that
constructs TEST-ONLY instances of the sibling adapters and hands them to the
orchestrator as the subject port; the `SupportCodeRegistry` for
`VES_SELFTEST_*` codes; and the sealed report through the evidence boundary
signed by the test-domain identity. Fault tests: sentinel mutation,
incomplete cleanup, quarantine failure, unknown profiles, prohibited report
content.

# T3 evidence

12 cases (8 unit adapter + 4 security) in
`tests/unit/self-test-adapter.test.mjs` and
`tests/security/self-test-escape.test.mjs`: complete root facts, proven
removal, quarantine marker mechanics, quarantine of a missing root reports
false, fixture budget and escape fail closed, sentinel digests including
absence, TEST-ONLY key roundtrip, and the symlink/junction escape exposed in
`linkChain` and refused by the rule (junction on win32, dir symlink on
POSIX). Sensor: link hops hidden in `collectLinkChain`, the escape security
test killed it, restore ran 4/4. `gate:quick` and `gate:security` PASS.

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
