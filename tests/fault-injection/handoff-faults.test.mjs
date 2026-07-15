import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptInput,
  coordinator,
  preparedFixture,
  publishInput,
  publishedFixture,
  sha
} from "../helpers/handoff-fixture.mjs";

test("unknown remote publication outcome requires reconciliation before retry", async () => {
  const { state, ports, prepared } = await preparedFixture({
    effects: { publish: async () => ({ status: "uncertain", idempotencyKey: "sha256:" + "a".repeat(64) }) }
  });
  await assert.rejects(coordinator(ports).publish(publishInput(prepared)), {
    code: "VES_HANDOFF_RECONCILIATION_REQUIRED"
  });
  assert.equal(state.capsules, 0);
  assert.equal(state.finals.size, 0);
});

for (const status of ["applied", "not-applied", "unknown"]) {
  test(`publication reconciliation classifies ${status} without blind retry`, async () => {
    const { ports, prepared } = await preparedFixture({
      effects: {
        reconcile: async (request) => ({
          status,
          idempotencyKey: request.idempotencyKey,
          ...(status === "applied"
            ? { receiptRef: "receipt:handoff-publication:001", receiptDigest: "sha256:" + "b".repeat(64) }
            : {})
        })
      }
    });
    const result = await coordinator(ports).reconcile({
      schemaVersion: 1,
      workspaceId: prepared.workspaceId,
      handoffRef: prepared.handoffRef,
      handoffDigest: prepared.handoffDigest
    });
    assert.equal(
      result.status,
      status === "unknown" ? "RECONCILIATION_REQUIRED" : status === "applied" ? "READY_TO_RESUME" : "READY_TO_RETRY"
    );
  });
}

for (const [name, override] of [
  [
    "publication Approval outage",
    {
      publicationApproval: {
        verify: async () => {
          throw new Error("approval unavailable");
        }
      }
    }
  ],
  [
    "publication adapter failure",
    {
      effects: {
        publish: async () => {
          throw new Error("remote failed");
        }
      }
    }
  ],
  [
    "claim disposition failure",
    {
      claims: {
        dispose: async () => {
          throw new Error("claim failed");
        }
      }
    }
  ]
]) {
  test(`${name} creates no final Handoff record`, async () => {
    const fixture = await preparedFixture(override);
    await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)));
    assert.equal(fixture.state.finals.size, 0);
    assert.equal(fixture.state.capsules, 0);
  });
}

test("terminal workflow failure creates no final Handoff record", async () => {
  const fixture = await preparedFixture();
  fixture.ports.workflow.apply = async () => ({ accepted: false, code: "VES_WORKFLOW_COMMAND_REJECTED" });
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)));
  assert.equal(fixture.state.finals.size, 0);
  assert.equal(fixture.state.capsules, 0);
});

test("crash before preterminal checkpoint resumes without repeating remote publication or claim", async () => {
  const fixture = await preparedFixture();
  const save = fixture.ports.records.saveProgress;
  let crash = true;
  fixture.ports.records.saveProgress = async (record) => {
    const saved = await save(record);
    if (crash) {
      crash = false;
      throw new Error("checkpoint acknowledgement lost");
    }
    return saved;
  };
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)));
  const result = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.equal(result.status, "HANDED_OFF");
  assert.equal(fixture.state.effects, 1);
  assert.equal(fixture.state.claimsDisposed, 1);
});

test("capsule failure after terminal checkpoint resumes without repeating terminal transition", async () => {
  let attempts = 0;
  const fixture = await preparedFixture({
    capsules: {
      seal: async (request) => {
        if (attempts++ === 0) throw new Error("capsule store unavailable");
        return {
          capsuleRef: "run-capsule:handoff:001",
          capsuleDigest: sha(JSON.stringify(request)),
          status: "HANDED_OFF",
          sourceRunId: request.source.runId,
          successorRunId: request.source.successorRunId,
          packageRef: request.artifact.package.packageRef,
          packageDigest: request.artifact.package.packageDigest,
          receiverApprovalInherited: false
        };
      }
    }
  });
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)));
  const completeCalls = fixture.state.calls.filter((call) => call === "workflow:COMPLETE_HANDOFF").length;
  const result = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.equal(result.status, "HANDED_OFF");
  assert.equal(fixture.state.calls.filter((call) => call === "workflow:COMPLETE_HANDOFF").length, completeCalls);
  assert.equal(fixture.state.effects, 1);
});

test("final-record acknowledgement loss converges to the stored terminal result", async () => {
  const fixture = await preparedFixture();
  const save = fixture.ports.records.saveFinal;
  let acknowledge = false;
  fixture.ports.records.saveFinal = async (record) => {
    const saved = await save(record);
    if (!acknowledge) {
      acknowledge = true;
      throw new Error("final acknowledgement lost");
    }
    return saved;
  };
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)));
  const result = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.equal(result.status, "HANDED_OFF");
  assert.equal(fixture.state.effects, 1);
  assert.equal(fixture.state.capsules, 1);
});

for (const [name, override, code] of [
  [
    "local Passport resolution",
    { bindings: { resolve: async () => ({ ready: false }) } },
    "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
  ],
  [
    "logical secret rebinding",
    { secrets: { rebind: async () => ({ ready: false }) } },
    "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
  ],
  [
    "integration rebinding",
    { integrations: { rebind: async () => ({ ready: false }) } },
    "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
  ],
  ["receiver policy", { policy: { reevaluate: async () => ({ allowed: false }) } }, "VES_HANDOFF_POLICY_DENIED"],
  ["receiver claim", { claims: { acquire: async () => ({ acquired: false }) } }, "VES_HANDOFF_CLAIM_REQUIRED"]
]) {
  test(`${name} failure creates no successor`, async () => {
    const fixture = await publishedFixture(override);
    await assert.rejects(coordinator(fixture.ports).accept(acceptInput(fixture.published)), { code });
    assert.equal(fixture.state.acceptances.size, 0);
  });
}
