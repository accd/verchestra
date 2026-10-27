import assert from "node:assert/strict";
import { test } from "node:test";

import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import * as extensionHost from "../../packages/extension-host/src/index.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor,
  WorkspaceProbeAdmission,
  authorizeSkillExecution
} from "../../packages/extension-host/src/index.ts";
import { authorizeSkillExecution as qualifiedAuthorizeSkillExecution } from "../../spikes/isolation/src/isolation-policy.mjs";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import { probePlan } from "../helpers/probe-worker-fixture.mjs";
import { grillSkill, lock, skill, verifier } from "../helpers/skill-registry-fixture.mjs";
import {
  LAUNCH_DIGEST,
  MemoryApprovals,
  admitted,
  approvalFor,
  extensionLock,
  extensionRegistry,
  extensionSkill,
  resolvedExtension
} from "../helpers/spawned-probe-worker-fixture.mjs";

function registry() {
  return new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT"]
  });
}

const DIGEST = `sha256:${"9".repeat(64)}`;
const REQUEST = {
  skillId: "acme-orders-probe",
  extensionId: "plugin:acme-orders-probe",
  entryPath: "probe/worker.mjs"
};

test("the registry resolves a locked, approved, digest-pinned executable extension", async () => {
  const extension = await resolvedExtension();
  assert.equal(extension.extensionRef.kind, "plugin");
  assert.equal(extension.extensionRef.approvalRef, "approval:probe-worker:001");
  assert.match(extension.entry.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(extension.lockDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("the registry refuses an executable entry whose lock has no approved extensionRef", async () => {
  const value = lock({
    skills: [
      skill(),
      grillSkill(),
      extensionSkill({ entryPath: REQUEST.entryPath, digest: DIGEST, extensionRef: null })
    ]
  });
  await assert.rejects(registry().resolveExecutableExtension(value, REQUEST), {
    code: "VES_SKILL_EXECUTION_UNAUTHORIZED"
  });
});

test("the registry refuses an extensionRef with an empty approval reference", async () => {
  const value = lock({
    skills: [
      skill(),
      grillSkill(),
      extensionSkill({
        entryPath: REQUEST.entryPath,
        digest: DIGEST,
        extensionRef: { kind: "plugin", id: REQUEST.extensionId, approvalRef: "" }
      })
    ]
  });
  await assert.rejects(registry().resolveExecutableExtension(value, REQUEST), {
    code: "VES_SKILL_EXECUTION_UNAUTHORIZED"
  });
});

test("the registry refuses a different extension id, an unknown skill, and a non-executable entry", async () => {
  const value = lock({
    skills: [
      skill(),
      grillSkill(),
      extensionSkill({
        entryPath: REQUEST.entryPath,
        digest: DIGEST,
        extensionRef: { kind: "plugin", id: REQUEST.extensionId, approvalRef: "approval:1" }
      })
    ]
  });
  await assert.rejects(registry().resolveExecutableExtension(value, { ...REQUEST, extensionId: "plugin:other" }), {
    code: "VES_SKILL_EXECUTION_UNAUTHORIZED"
  });
  await assert.rejects(registry().resolveExecutableExtension(value, { ...REQUEST, skillId: "absent" }), {
    code: "VES_SKILL_UNKNOWN"
  });
  await assert.rejects(registry().resolveExecutableExtension(value, { ...REQUEST, entryPath: "SKILL.md" }), {
    code: "VES_SKILL_EXTENSION_ENTRY_UNKNOWN"
  });
});

test("the registry refuses a tampered lock before any extension resolves", async () => {
  const value = lock({
    skills: [
      skill(),
      grillSkill(),
      extensionSkill({
        entryPath: REQUEST.entryPath,
        digest: DIGEST,
        extensionRef: { kind: "plugin", id: REQUEST.extensionId, approvalRef: "approval:1" }
      })
    ]
  });
  await assert.rejects(
    registry().resolveExecutableExtension({ ...value, lockDigest: `sha256:${"0".repeat(64)}` }, REQUEST),
    { code: "VES_SKILL_LOCK_TAMPERED" }
  );
});

// invariant: #569, PHC-03. Admission resolves the extension itself; a caller can
// no longer hand it one, so an extension that never came from a verified lock
// has no way in.
test("admission takes no extension value: without a lock nothing resolves", async () => {
  assert.equal("admitWorkspaceProbeWorker" in extensionHost, false, "the value-taking admission is gone");
  const admission = new WorkspaceProbeAdmission({ extensions: extensionRegistry(), approvals: new MemoryApprovals() });
  await assert.rejects(admission.admit({ workspaceId, extension: await resolvedExtension() }), {
    code: "VES_SKILL_LOCK_INVALID"
  });
});

test("admission resolves through the registry, which refuses a tampered lock", async () => {
  const { lock: value, request } = extensionLock();
  const approvals = new MemoryApprovals();
  const admission = new WorkspaceProbeAdmission({ extensions: extensionRegistry(), approvals });
  await assert.rejects(admission.admit({ workspaceId, lock: { ...value, lockDigest: DIGEST }, request }), {
    code: "VES_SKILL_LOCK_TAMPERED"
  });
  assert.deepEqual(approvals.lookups, [], "no approval is looked up for an unverified lock");
});

// invariant: #569, PHC-04. The approval reference is looked up, and the record
// must name the resolved extension, its entry bytes and a launch.
test("admission looks the approval up and refuses one that is not on record", async () => {
  const approvals = new MemoryApprovals();
  await assert.rejects(admitted({ workspaceId, approvals }), { code: "VES_PROBE_WORKSPACE_TRUST_APPROVAL" });
  assert.deepEqual(approvals.lookups, ["approval:probe-worker:001"]);
});

for (const [label, overrides] of [
  ["another approval reference", { approvalRef: "approval:someone-else" }],
  ["another extension", { extensionId: "plugin:other" }],
  ["other entry bytes", { componentDigest: DIGEST }],
  ["no launch", { launchDigest: undefined }],
  ["a malformed launch", { launchDigest: "sha256:launch" }]
]) {
  test(`an approval that names ${label} does not admit the worker`, async () => {
    const extension = await resolvedExtension();
    const approvals = { lookup: async () => approvalFor(extension, LAUNCH_DIGEST, overrides) };
    await assert.rejects(admitted({ workspaceId, approvals }), { code: "VES_PROBE_WORKSPACE_TRUST_APPROVAL" });
  });
}

test("admission without a controller grant is refused even with an approved extension", async () => {
  await assert.rejects(admitted({ workspaceId, grant: null }), { code: "VES_EXECUTION_GRANT_REQUIRED" });
});

for (const [label, overrides, code] of [
  ["another Workspace", { workspaceId: "workspace_foreign" }, "VES_PROBE_WORKSPACE_TRUST_WORKSPACE"],
  ["another approval", { approvalRef: "approval:someone-else" }, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
  ["another executable digest", { componentDigest: DIGEST }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["another launch than the approval", { launchDigest: DIGEST }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["another extension", { extensionId: "plugin:other" }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["another lock", { lockDigest: DIGEST }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["a stronger isolation grade", { isolationProfile: "native-restricted" }, "VES_ISOLATION_PROFILE_UNAVAILABLE"],
  ["a high-risk untrusted classification", { risk: "high-untrusted-executable" }, "VES_STRONG_ISOLATION_UNAVAILABLE"],
  ["no risk classification", { risk: undefined }, "VES_PROBE_WORKSPACE_TRUST_INVALID"],
  ["a write capability", { capabilities: ["database-write"] }, "VES_PROBE_WORKSPACE_TRUST_CAPABILITY"],
  ["no capability", { capabilities: [] }, "VES_PROBE_WORKSPACE_TRUST_CAPABILITY"]
]) {
  test(`a grant bound to ${label} does not admit the worker`, async () => {
    await assert.rejects(admitted({ workspaceId, grantOverrides: overrides }), { code });
  });
}

// why: defense in depth. The registry already refuses both; admission still
// checks what its registry port answers rather than trusting it.
for (const [label, reference, code] of [
  ["no approval reference", { approvalRef: "" }, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
  ["a Skill that was not reclassified as a Tool or Plugin", { kind: "skill" }, "VES_SKILL_EXECUTION_RECLASSIFY"]
]) {
  test(`a registry answer with ${label} is refused`, async () => {
    const extension = await resolvedExtension();
    const extensions = {
      resolveExecutableExtension: async () => ({
        ...extension,
        extensionRef: { ...extension.extensionRef, ...reference }
      })
    };
    await assert.rejects(admitted({ workspaceId, extensions }), { code });
  });
}

test("a workspace extension cannot claim the product component namespace", async () => {
  await assert.rejects(
    admitted({
      workspaceId,
      extensionRef: { kind: "plugin", id: "probe-worker:postgresql", approvalRef: "approval:probe-worker:001" }
    }),
    { code: "VES_PROBE_WORKSPACE_TRUST_NAMESPACE" }
  );
});

test("an admitted trust is frozen and binds the approval, grant, lock, digest and launch", async () => {
  const { extension, trust } = await admitted({ workspaceId });
  assert.equal(Object.isFrozen(trust), true);
  assert.deepEqual(
    [
      trust.componentId,
      trust.componentDigest,
      trust.launchDigest,
      trust.approvalRef,
      trust.lockDigest,
      trust.capabilities
    ],
    [
      extension.extensionRef.id,
      extension.entry.digest,
      LAUNCH_DIGEST,
      extension.extensionRef.approvalRef,
      extension.lockDigest,
      ["database-read"]
    ]
  );
});

test("the supervisor refuses a forged workspace trust with the admitted shape", async () => {
  const { trust: genuine } = await admitted({ workspaceId });
  const plan = await probePlan();
  assert.throws(
    () =>
      new ProbeWorkerSupervisor({
        worker: {},
        parameters: new MemoryProtectedParameterBroker(),
        results: new MemoryProbeResultSink(),
        plan,
        workspaceTrust: { ...genuine },
        maximumMessageBytes: 65_536
      }),
    { code: "VES_PROBE_WORKSPACE_TRUST_DENIED" }
  );
});

test("the supervisor refuses an admission minted for another Workspace's plan", async () => {
  const { trust } = await admitted({ workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0000000000ff" });
  const plan = await probePlan();
  assert.throws(
    () =>
      new ProbeWorkerSupervisor({
        worker: {},
        parameters: new MemoryProtectedParameterBroker(),
        results: new MemoryProbeResultSink(),
        plan,
        workspaceTrust: trust,
        maximumMessageBytes: 65_536
      }),
    { code: "VES_PROBE_WORKSPACE_TRUST_WORKSPACE" }
  );
});

async function measuredWorker(trust, measured) {
  const calls = [];
  const worker = {
    ...measured,
    handshake: async () => {
      calls.push("handshake");
      return {
        protocol: "verchestra-probe/1",
        supportedSchemas: ["probe.plan/1", "probe.result/1"],
        component: { id: trust.componentId, digest: trust.componentDigest },
        capabilities: ["database-read"],
        maximumMessageBytes: 65_536
      };
    },
    verifyIdentity: async () => calls.push("identity"),
    cancel: async () => calls.push("cancel"),
    terminate: async () => calls.push("terminate")
  };
  const results = new MemoryProbeResultSink();
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters: new MemoryProtectedParameterBroker(),
    results,
    plan: await probePlan(),
    workspaceTrust: trust,
    maximumMessageBytes: 65_536
  });
  return { calls, results, supervisor };
}

test("a launched worker whose host-measured digest differs from the approval never reaches identity", async () => {
  const { trust } = await admitted({ workspaceId });
  const { calls, results, supervisor } = await measuredWorker(trust, {
    launchedComponentDigest: DIGEST,
    launchDigest: trust.launchDigest
  });
  await assert.rejects(supervisor.execute(), { code: "VES_PROBE_WORKSPACE_TRUST_DIGEST", revokeGrant: true });
  assert.deepEqual(calls, ["handshake", "cancel"]);
  assert.equal(results.commits, 0);
});

test("a launched worker whose host-measured launch differs from the approval never reaches identity", async () => {
  const { trust } = await admitted({ workspaceId });
  const { calls, results, supervisor } = await measuredWorker(trust, {
    launchedComponentDigest: trust.componentDigest,
    launchDigest: DIGEST
  });
  await assert.rejects(supervisor.execute(), { code: "VES_PROBE_WORKSPACE_TRUST_LAUNCH", revokeGrant: true });
  assert.deepEqual(calls, ["handshake", "cancel"]);
  assert.equal(results.commits, 0);
});

test("the product port of authorizeSkillExecution matches the qualified isolation rule", () => {
  const cases = [
    { kind: "skill", requestsExecution: false, explicitGrant: false },
    { kind: "skill", requestsExecution: true, explicitGrant: true },
    { kind: "tool", requestsExecution: true, explicitGrant: false },
    { kind: "tool", requestsExecution: true, explicitGrant: true },
    { kind: "plugin", requestsExecution: true, explicitGrant: true }
  ];
  const outcome = (fn, input) => {
    try {
      return { ...fn(input) };
    } catch (error) {
      return { code: error.code };
    }
  };
  for (const input of cases)
    assert.deepEqual(outcome(authorizeSkillExecution, input), outcome(qualifiedAuthorizeSkillExecution, input));
});
