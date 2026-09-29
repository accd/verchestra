import assert from "node:assert/strict";
import { test } from "node:test";

import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor,
  admitWorkspaceProbeWorker,
  authorizeSkillExecution
} from "../../packages/extension-host/src/index.ts";
import { authorizeSkillExecution as qualifiedAuthorizeSkillExecution } from "../../spikes/isolation/src/isolation-policy.mjs";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import { probePlan } from "../helpers/probe-worker-fixture.mjs";
import { grillSkill, lock, skill, verifier } from "../helpers/skill-registry-fixture.mjs";
import { controllerGrant, extensionSkill, resolvedExtension } from "../helpers/spawned-probe-worker-fixture.mjs";

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

test("admission is denied by default when no locked extension is supplied", () => {
  assert.throws(() => admitWorkspaceProbeWorker({ workspaceId }), { code: "VES_PROBE_WORKSPACE_TRUST_DENIED" });
});

test("admission without a controller grant is refused even with an approved extension", async () => {
  const extension = await resolvedExtension();
  assert.throws(() => admitWorkspaceProbeWorker({ workspaceId, extension }), {
    code: "VES_EXECUTION_GRANT_REQUIRED"
  });
});

test("admission without an approval reference is refused", async () => {
  const extension = await resolvedExtension();
  const unapproved = { ...extension, extensionRef: { ...extension.extensionRef, approvalRef: "" } };
  assert.throws(
    () =>
      admitWorkspaceProbeWorker({ workspaceId, extension: unapproved, grant: controllerGrant(extension, workspaceId) }),
    { code: "VES_PROBE_WORKSPACE_TRUST_APPROVAL" }
  );
});

for (const [label, overrides, code] of [
  ["another Workspace", { workspaceId: "workspace_foreign" }, "VES_PROBE_WORKSPACE_TRUST_WORKSPACE"],
  ["another approval", { approvalRef: "approval:someone-else" }, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
  ["another executable digest", { componentDigest: DIGEST }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["another extension", { extensionId: "plugin:other" }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["another lock", { lockDigest: DIGEST }, "VES_EXECUTION_GRANT_REQUIRED"],
  ["a stronger isolation grade", { isolationProfile: "native-restricted" }, "VES_ISOLATION_PROFILE_UNAVAILABLE"],
  ["a high-risk untrusted classification", { risk: "high-untrusted-executable" }, "VES_STRONG_ISOLATION_UNAVAILABLE"],
  ["no risk classification", { risk: undefined }, "VES_PROBE_WORKSPACE_TRUST_INVALID"],
  ["a write capability", { capabilities: ["database-write"] }, "VES_PROBE_WORKSPACE_TRUST_CAPABILITY"],
  ["no capability", { capabilities: [] }, "VES_PROBE_WORKSPACE_TRUST_CAPABILITY"]
]) {
  test(`a grant bound to ${label} does not admit the worker`, async () => {
    const extension = await resolvedExtension();
    assert.throws(
      () =>
        admitWorkspaceProbeWorker({
          workspaceId,
          extension,
          grant: controllerGrant(extension, workspaceId, overrides)
        }),
      { code }
    );
  });
}

test("an executable that is not reclassified as a Tool or Plugin is refused", async () => {
  const extension = await resolvedExtension();
  const skillKind = { ...extension, extensionRef: { ...extension.extensionRef, kind: "skill" } };
  assert.throws(
    () =>
      admitWorkspaceProbeWorker({ workspaceId, extension: skillKind, grant: controllerGrant(extension, workspaceId) }),
    { code: "VES_SKILL_EXECUTION_RECLASSIFY" }
  );
});

test("a workspace extension cannot claim the product component namespace", async () => {
  const extension = await resolvedExtension({
    extensionRef: { kind: "plugin", id: "probe-worker:postgresql", approvalRef: "approval:probe-worker:001" }
  });
  assert.throws(
    () => admitWorkspaceProbeWorker({ workspaceId, extension, grant: controllerGrant(extension, workspaceId) }),
    { code: "VES_PROBE_WORKSPACE_TRUST_NAMESPACE" }
  );
});

test("an admitted trust is frozen and binds the approval, grant, lock, and digest", async () => {
  const extension = await resolvedExtension();
  const trust = admitWorkspaceProbeWorker({ workspaceId, extension, grant: controllerGrant(extension, workspaceId) });
  assert.equal(Object.isFrozen(trust), true);
  assert.deepEqual(
    [trust.componentId, trust.componentDigest, trust.approvalRef, trust.lockDigest, trust.capabilities],
    [
      extension.extensionRef.id,
      extension.entry.digest,
      extension.extensionRef.approvalRef,
      extension.lockDigest,
      ["database-read"]
    ]
  );
});

test("the supervisor refuses a forged workspace trust with the admitted shape", async () => {
  const extension = await resolvedExtension();
  const genuine = admitWorkspaceProbeWorker({ workspaceId, extension, grant: controllerGrant(extension, workspaceId) });
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
  const extension = await resolvedExtension();
  const foreign = "workspace_018f0b6d-7b1a-7abc-8def-0000000000ff";
  const trust = admitWorkspaceProbeWorker({
    workspaceId: foreign,
    extension,
    grant: controllerGrant(extension, foreign)
  });
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

test("a launched worker whose host-measured digest differs from the approval never reaches identity", async () => {
  const extension = await resolvedExtension();
  const trust = admitWorkspaceProbeWorker({ workspaceId, extension, grant: controllerGrant(extension, workspaceId) });
  const calls = [];
  const worker = {
    launchedComponentDigest: DIGEST,
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
  const parameters = new MemoryProtectedParameterBroker();
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan: await probePlan(),
    workspaceTrust: trust,
    maximumMessageBytes: 65_536
  });
  await assert.rejects(supervisor.execute(), { code: "VES_PROBE_WORKSPACE_TRUST_DIGEST", revokeGrant: true });
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
