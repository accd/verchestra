import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import { probePlan } from "../helpers/probe-worker-fixture.mjs";
import { admitted } from "../helpers/spawned-probe-worker-fixture.mjs";

// why: a worker that records every call the supervisor makes on it and answers
// as the admitted worker would, so a refusal is the supervisor's own.
function recordingWorker(trust) {
  const calls = [];
  const worker = {
    launchedComponentDigest: trust.componentDigest,
    launchDigest: trust.launchDigest,
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
    verifyIdentity: async (plan) => {
      calls.push("identity");
      return { databaseId: plan.databaseId, principalReadOnly: true, principalFingerprint: `sha256:${"2".repeat(64)}` };
    },
    configureReadOnlySession: async (plan) => {
      calls.push("session");
      return { planDigest: plan.planDigest, sessionReadOnly: true, transactionReadOnly: true };
    },
    async *execute() {
      calls.push("execute");
      yield [{ id: 1 }];
    },
    cancel: async () => calls.push("cancel"),
    terminate: async () => calls.push("terminate")
  };
  return { calls, worker };
}

function supervisor(plan, trust, worker) {
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(plan.operation.protectedRequestRef, new TextEncoder().encode('{"status":"paid"}'));
  return new ProbeWorkerSupervisor({
    worker,
    parameters,
    results: new MemoryProbeResultSink(),
    plan,
    workspaceTrust: trust,
    maximumMessageBytes: 65_536
  });
}

test("the supervisor refuses a plan whose grant is not the admitted one", async () => {
  const { trust } = await admitted({ workspaceId, grantOverrides: { grantRef: "grant-a" } });
  assert.equal(trust.grantRef, "grant-a");

  const refused = recordingWorker(trust);
  const otherPlan = await probePlan({ grantRef: "grant-b" });
  assert.throws(() => supervisor(otherPlan, trust, refused.worker), { code: "VES_PROBE_WORKSPACE_TRUST_GRANT" });
  assert.deepEqual(refused.calls, [], "no worker call is made for a plan granted to another grant");

  const proceeding = recordingWorker(trust);
  const result = await supervisor(await probePlan({ grantRef: "grant-a" }), trust, proceeding.worker).execute();
  assert.equal(result.status, "complete");
  assert.equal(result.grantRef, "grant-a");
  assert.equal(result.rowCount, 1);
  assert.deepEqual(proceeding.calls, ["handshake", "identity", "session", "execute"]);
});
