// T69 T2: the Self-Test trust domain rules. Every verdict is a pure rule over
// facts, so every acceptance criterion in the spec is provable here without a
// filesystem (TST-01..06; .specs/features/self-test/spec.md).
import assert from "node:assert/strict";
import test from "node:test";
import {
  QuarantineMachine,
  SELF_TEST_REPORT_FIELDS,
  SMOKE_CHECK_IDS,
  SelfTestOrchestrator,
  assertDisjointRoot,
  assertReportPayload,
  assertTestOnlyMaterials,
  diffSentinels,
  resolveSelfTestProfile
} from "../../packages/application/src/index.ts";

function passingChecks(checkIds) {
  return checkIds.map((checkId) => ({ checkId, requirement: "T70 coverage fixture", status: "pass" }));
}

function rootFacts(overrides = {}) {
  return {
    canonicalPath: "/tmp/selftest/run-1",
    realPath: "/private/tmp/selftest/run-1",
    deviceId: "dev-1",
    inodeId: "inode-100",
    linkChain: [],
    ...overrides
  };
}

const guardedWorkspace = Object.freeze({
  canonicalPath: "/work/verchestra",
  realPath: "/work/verchestra",
  deviceId: "dev-1",
  inodeId: "inode-1",
  linkChain: []
});

// --- TST-03: closed profile registry ---

test("all four sealed profiles resolve with the remove-or-quarantine cleanup policy", () => {
  for (const profileId of ["smoke", "full", "workspace", "drivers"]) {
    const profile = resolveSelfTestProfile(profileId);
    assert.equal(profile.profileId, profileId);
    assert.equal(profile.cleanupPolicy, "remove-or-quarantine");
    assert.ok(profile.maxFixtureBytes > 0 && profile.maxDurationMs > 0);
  }
});

test("an unknown profile fails closed naming the closed registry", () => {
  assert.throws(
    () => resolveSelfTestProfile("crash-recovery"),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_UNKNOWN_PROFILE");
      assert.match(error.message, /smoke, full, workspace, drivers/u);
      return true;
    }
  );
});

// --- TST-01: non-overlap over RootFacts ---

test("a disjoint root on another device passes", () => {
  assertDisjointRoot(rootFacts({ deviceId: "dev-2", inodeId: "inode-9" }), [guardedWorkspace]);
});

test("device and inode identity is an overlap even when paths look different", () => {
  assert.throws(
    () => assertDisjointRoot(rootFacts({ deviceId: "dev-1", inodeId: "inode-1" }), [guardedWorkspace]),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_ROOT_OVERLAP");
      assert.match(error.message, /device and inode/u);
      return true;
    }
  );
});

test("a candidate inside a guarded root overlaps by canonical path", () => {
  assert.throws(
    () => assertDisjointRoot(rootFacts({ canonicalPath: "/work/verchestra/tmp/x", inodeId: "i2" }), [guardedWorkspace]),
    { code: "VES_SELFTEST_ROOT_OVERLAP" }
  );
});

test("a guarded root inside the candidate overlaps in the other direction", () => {
  assert.throws(
    () =>
      assertDisjointRoot(rootFacts({ canonicalPath: "/work", realPath: "/work", inodeId: "i2" }), [guardedWorkspace]),
    { code: "VES_SELFTEST_ROOT_OVERLAP" }
  );
});

test("a link-chain hop through a guarded root is an overlap even with a disjoint resolved path", () => {
  const escaping = rootFacts({ inodeId: "i2", linkChain: ["/tmp/alias", "/work/verchestra/link"] });
  assert.throws(
    () => assertDisjointRoot(escaping, [guardedWorkspace]),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_ROOT_OVERLAP");
      assert.match(error.message, /\/work\/verchestra\/link/u);
      return true;
    }
  );
});

test("a sibling path sharing only a prefix string is not an overlap", () => {
  assertDisjointRoot(
    rootFacts({ canonicalPath: "/work/verchestra-tmp", realPath: "/work/verchestra-tmp", inodeId: "i2" }),
    [guardedWorkspace]
  );
});

test("missing device or inode facts fail closed instead of assuming disjoint", () => {
  assert.throws(() => assertDisjointRoot(rootFacts({ deviceId: "" }), [guardedWorkspace]), {
    code: "VES_SELFTEST_ROOT_FACTS_INVALID"
  });
  assert.throws(() => assertDisjointRoot(rootFacts(), [{ ...guardedWorkspace, inodeId: "" }]), {
    code: "VES_SELFTEST_ROOT_FACTS_INVALID"
  });
});

// --- TST-02: production material rejection ---

test("production material is rejected with a distinct error naming the material", () => {
  assert.throws(
    () =>
      assertTestOnlyMaterials([
        { materialId: "key:test-1", kind: "key", testOnly: true },
        { materialId: "key:team-execution-2026", kind: "key", testOnly: false }
      ]),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_PRODUCTION_MATERIAL");
      assert.match(error.message, /key:team-execution-2026/u);
      return true;
    }
  );
});

test("an all-test-only composition passes", () => {
  assertTestOnlyMaterials([{ materialId: "workspace:disposable", kind: "workspace", testOnly: true }]);
});

// --- TST-04: sentinel set comparison ---

test("byte-identical sentinel sets compare identical", () => {
  const before = [
    { sentinelId: "workspace.db", digest: "sha256:aa" },
    { sentinelId: "policy.store", digest: "sha256:bb" }
  ];
  const diff = diffSentinels(before, [...before].reverse());
  assert.equal(diff.identical, true);
  assert.deepEqual([...diff.mutated, ...diff.added, ...diff.removed], []);
});

test("mutated, added, and removed sentinels are each named", () => {
  const diff = diffSentinels(
    [
      { sentinelId: "a", digest: "1" },
      { sentinelId: "b", digest: "2" }
    ],
    [
      { sentinelId: "a", digest: "changed" },
      { sentinelId: "c", digest: "3" }
    ]
  );
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.mutated, ["a"]);
  assert.deepEqual(diff.added, ["c"]);
  assert.deepEqual(diff.removed, ["b"]);
});

test("duplicate sentinel ids fail closed as malformed facts", () => {
  const duplicated = [
    { sentinelId: "a", digest: "1" },
    { sentinelId: "a", digest: "2" }
  ];
  assert.throws(() => diffSentinels(duplicated, []), { code: "VES_SELFTEST_SENTINEL_FACTS_INVALID" });
});

// --- TST-05: quarantine state machine ---

test("the proven-removal path walks provisioned, in-use, cleanup-pending, removed", () => {
  const machine = new QuarantineMachine();
  for (const state of ["in-use", "cleanup-pending", "removed"]) machine.transition(state);
  assert.equal(machine.state, "removed");
});

test("removed and quarantined are terminal", () => {
  const removed = new QuarantineMachine();
  for (const state of ["in-use", "cleanup-pending", "removed"]) removed.transition(state);
  assert.throws(() => removed.transition("provisioned"), {
    code: "VES_SELFTEST_QUARANTINE_TRANSITION",
    message: /removed -> provisioned/u
  });
  const quarantined = new QuarantineMachine();
  for (const state of ["in-use", "quarantined"]) quarantined.transition(state);
  assert.throws(() => quarantined.transition("removed"), { code: "VES_SELFTEST_QUARANTINE_TRANSITION" });
});

test("a root cannot skip from provisioned straight to removed", () => {
  assert.throws(() => new QuarantineMachine().transition("removed"), {
    code: "VES_SELFTEST_QUARANTINE_TRANSITION",
    message: /provisioned -> removed/u
  });
});

// --- TST-06: report allowlist ---

function validPayload(overrides = {}) {
  return {
    "self_test.check_count": 12,
    "self_test.duration_ms": 900,
    "self_test.evidence_refs": ["evidence:run-1"],
    "self_test.failure_codes": [],
    "self_test.profile": "smoke",
    "self_test.redaction_count": 0,
    "self_test.verdict": "PASS",
    ...overrides
  };
}

test("a complete allowlisted payload passes", () => {
  assertReportPayload(validPayload());
});

test("a field outside the sealed allowlist fails closed", () => {
  assert.throws(() => assertReportPayload(validPayload({ "self_test.transcript": "x" })), {
    code: "VES_SELFTEST_REPORT_FIELD_UNKNOWN"
  });
});

test("a missing required field fails closed", () => {
  const payload = validPayload();
  delete payload["self_test.verdict"];
  assert.throws(() => assertReportPayload(payload), { code: "VES_SELFTEST_REPORT_FIELD_UNKNOWN" });
});

test("a value matching a prohibited content class fails closed, while VES_ codes pass", () => {
  assert.throws(() => assertReportPayload(validPayload({ "self_test.evidence_refs": ["environment dump"] })), {
    code: "VES_SELFTEST_REPORT_CONTENT_PROHIBITED"
  });
  assertReportPayload(
    validPayload({ "self_test.failure_codes": ["VES_SELFTEST_QUARANTINE_FAILED"], "self_test.verdict": "FAIL" })
  );
});

test("an unregistered profile or unknown verdict is prohibited content", () => {
  assert.throws(() => assertReportPayload(validPayload({ "self_test.profile": "custom" })), {
    code: "VES_SELFTEST_REPORT_CONTENT_PROHIBITED"
  });
  assert.throws(() => assertReportPayload(validPayload({ "self_test.verdict": "OK" })), {
    code: "VES_SELFTEST_REPORT_CONTENT_PROHIBITED"
  });
});

test("the sealed field list is frozen and exact", () => {
  assert.equal(SELF_TEST_REPORT_FIELDS.length, 7);
  assert.ok(Object.isFrozen(SELF_TEST_REPORT_FIELDS));
});

// --- Orchestrator over fake ports ---

function fakePorts(overrides = {}) {
  const calls = { cleanup: 0, quarantine: 0, provision: 0, run: 0 };
  const sentinels = [{ sentinelId: "workspace.db", digest: "sha256:stable" }];
  const ports = {
    guardedRoots: async () => [guardedWorkspace],
    roots: {
      provision: async () => {
        calls.provision += 1;
        return rootFacts({ deviceId: "dev-2", inodeId: "inode-9" });
      },
      cleanup: async () => {
        calls.cleanup += 1;
        return { removed: true, residue: [] };
      },
      quarantine: async () => {
        calls.quarantine += 1;
        return { quarantined: true };
      }
    },
    sentinels: { capture: async () => sentinels },
    subject: {
      materials: async () => [{ materialId: "key:test", kind: "key", testOnly: true }],
      run: async () => {
        calls.run += 1;
        return {
          checkCount: 3,
          durationMs: 40,
          evidenceRefs: [],
          failureCodes: [],
          redactionCount: 0,
          checks: passingChecks(SMOKE_CHECK_IDS)
        };
      }
    },
    ...overrides
  };
  return { ports, calls };
}

test("a clean run ends removed with a PASS allowlisted payload", async () => {
  const { ports, calls } = fakePorts();
  const result = await new SelfTestOrchestrator(ports).run("smoke");
  assert.equal(result.rootState, "removed");
  assert.equal(result.payload["self_test.verdict"], "PASS");
  assert.equal(result.payload["self_test.profile"], "smoke");
  assert.deepEqual(calls, { cleanup: 1, quarantine: 0, provision: 1, run: 1 });
});

test("an unknown profile fails before any provisioning happens", async () => {
  const { ports, calls } = fakePorts();
  await assert.rejects(new SelfTestOrchestrator(ports).run("nope"), { code: "VES_SELFTEST_UNKNOWN_PROFILE" });
  assert.equal(calls.provision, 0);
});

test("an overlapping root fails without cleanup or quarantine ever touching it", async () => {
  const { ports, calls } = fakePorts();
  ports.roots.provision = async () => {
    calls.provision += 1;
    return rootFacts({ canonicalPath: "/work/verchestra/nested", inodeId: "i2" });
  };
  await assert.rejects(new SelfTestOrchestrator(ports).run("smoke"), { code: "VES_SELFTEST_ROOT_OVERLAP" });
  assert.equal(calls.cleanup, 0);
  assert.equal(calls.quarantine, 0);
  assert.equal(calls.run, 0);
});

test("production material stops the run before the subject executes", async () => {
  const { ports, calls } = fakePorts();
  ports.subject.materials = async () => [{ materialId: "key:prod", kind: "key", testOnly: false }];
  await assert.rejects(new SelfTestOrchestrator(ports).run("smoke"), { code: "VES_SELFTEST_PRODUCTION_MATERIAL" });
  assert.equal(calls.run, 0);
});

test("a sentinel mutation quarantines the root and fails the run naming the sentinel", async () => {
  const { ports, calls } = fakePorts();
  let capture = 0;
  ports.sentinels.capture = async () => {
    capture += 1;
    return [{ sentinelId: "workspace.db", digest: capture === 1 ? "sha256:before" : "sha256:after" }];
  };
  await assert.rejects(new SelfTestOrchestrator(ports).run("smoke"), (error) => {
    assert.equal(error.code, "VES_SELFTEST_SENTINEL_MUTATION");
    assert.match(error.message, /workspace\.db/u);
    return true;
  });
  assert.equal(calls.quarantine, 1);
  assert.equal(calls.cleanup, 0);
});

test("unproven cleanup quarantines instead of leaking silently", async () => {
  const { ports, calls } = fakePorts();
  ports.roots.cleanup = async () => {
    calls.cleanup += 1;
    return { removed: false, residue: ["fixtures/a.tmp"] };
  };
  const result = await new SelfTestOrchestrator(ports).run("smoke");
  assert.equal(result.rootState, "quarantined");
  assert.equal(calls.quarantine, 1);
});

test("a quarantine that cannot prove itself fails closed", async () => {
  const { ports } = fakePorts();
  ports.roots.cleanup = async () => ({ removed: false, residue: [] });
  ports.roots.quarantine = async () => ({ quarantined: false });
  await assert.rejects(new SelfTestOrchestrator(ports).run("smoke"), { code: "VES_SELFTEST_QUARANTINE_FAILED" });
});
