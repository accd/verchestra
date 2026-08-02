---
schema: verchestra-feature-handoff/v1
feature: self-test
issue: 10
status: complete
branch: docs/t69-qualification-report
baseRevision: c2202dde3a949852c5cb23d8a9e7062b9eced8da
lastCompletedTask: T5
nextTask: T70 begins under issue #11
lastGate: pnpm gate:security
updatedAt: 2026-08-02T10:00:00Z
---

# Scope

T69: the isolated Self-Test trust domain. Specification, design, and tasks are
written from verified code reading recorded in the design document; no product
code exists yet.

# Next Exact Action

T69 is complete: `docs/qualification/t69-validation.md` binds the merged
implementation revision with externally dispatched gate runs. The chain
advances to T70 (#11): the smoke and workspace Self-Test profiles, which
declare `gate:full` rather than `gate:security`, so their cases belong in
`tests/contract/`, `tests/integration/`, `tests/e2e/`, and
`tests/fault-injection/`.

# T5 evidence

53 cases across four suites against a declared minimum of 35; 13 of 13
mutations killed with none surviving (M11 survived its first run and the
suite was strengthened rather than the mutation dropped); `gate:quick` and
`gate:security` externally dispatched at `d0513ae` and both PASS. A defect
in `full-validation.yml` surfaced and was repaired first (#177/#178): the
shallow candidate fetch destroyed the ancestry proof every post-T68 report
needs.

# T4 evidence

10 fault-injection cases in
`tests/fault-injection/self-test-composition-faults.test.mjs`: sealed report
verifies against its trust root and refuses a swapped registry binding,
unknown profile provisions nothing, sentinel mutation and sentinel deletion
both quarantine, reported failure codes seal a FAIL verdict, unregistered
codes and prohibited content fail before sealing, the registry is complete,
and the subject only ever receives test-only material. Sensor: registry
check bypassed, the unregistered-code test killed it, restore ran 10/10.
`gate:quick` and `gate:security` PASS.

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
