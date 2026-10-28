import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coordinator,
  handoffPorts,
  prepareInput,
  preparedFixture,
  publishInput,
  sha
} from "../helpers/handoff-fixture.mjs";

// Unit-level publication of a prepared Handoff: the order of its durable
// steps, each resume point a retry starts from, and the first check each
// refusal fails.

const publicationCalls = (state, from) => state.calls.slice(from).filter((call) => call !== "package:verify");

test("a remote publication approves, publishes, disposes, and checkpoints in order", async () => {
  const { state, ports, prepared } = await preparedFixture();
  const from = state.calls.length;
  const published = await coordinator(ports).publish(publishInput(prepared));
  assert.equal(published.status, "HANDED_OFF");
  assert.deepEqual(publicationCalls(state, from), [
    "artifact:open",
    "workflow:REQUEST_HANDOFF_PUBLICATION_APPROVAL",
    "effect:publish",
    "claim:release",
    "progress:PRETERMINAL_READY",
    "workflow:COMPLETE_HANDOFF",
    "progress:TERMINAL_COMMITTED",
    "capsule:seal",
    "progress:CAPSULE_SEALED",
    "final:save"
  ]);
  const record = state.finals.get(published.handoffRef);
  assert.deepEqual(record.publication, {
    receiptRef: "receipt:handoff-publication:001",
    receiptDigest: sha("publication-receipt")
  });
  assert.deepEqual(state.progress.get(published.handoffRef).capsule, record.capsule);
});

test("a local publication records the package as its receipt and asks for no approval", async () => {
  const { state, ports } = handoffPorts();
  const prepared = await coordinator(ports).prepare(
    prepareInput({
      destination: { kind: "local", targetRef: "destination:local-cas", destinationDigest: sha("local") }
    })
  );
  const from = state.calls.length;
  const published = await coordinator(ports).publish(publishInput(prepared, { publicationApproval: undefined }));
  assert.deepEqual(state.finals.get(published.handoffRef).publication, {
    receiptRef: "receipt:local-publication",
    receiptDigest: sha("execution-package")
  });
  assert.equal(publicationCalls(state, from).includes("effect:publish"), false);
  assert.equal(publicationCalls(state, from).includes("workflow:REQUEST_HANDOFF_PUBLICATION_APPROVAL"), false);
});

test("a retry after the pre-terminal checkpoint resumes from it without publishing again", async () => {
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
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), /acknowledgement lost/u);
  const from = fixture.state.calls.length;
  const published = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.equal(published.status, "HANDED_OFF");
  assert.deepEqual(publicationCalls(fixture.state, from), [
    "artifact:open",
    "workflow:COMPLETE_HANDOFF",
    "progress:TERMINAL_COMMITTED",
    "capsule:seal",
    "progress:CAPSULE_SEALED",
    "final:save"
  ]);
});

test("a retry after the terminal checkpoint seals the capsule without a second transition", async () => {
  let seals = 0;
  const fixture = await preparedFixture();
  const seal = fixture.ports.capsules.seal;
  fixture.ports.capsules.seal = async (request) => {
    if (seals++ === 0) throw new Error("capsule store unavailable");
    return seal(request);
  };
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), /capsule store/u);
  const from = fixture.state.calls.length;
  await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.deepEqual(publicationCalls(fixture.state, from), [
    "artifact:open",
    "capsule:seal",
    "progress:CAPSULE_SEALED",
    "final:save"
  ]);
});

test("a retry after the capsule checkpoint saves the final record from the saved capsule", async () => {
  const fixture = await preparedFixture();
  const saveFinal = fixture.ports.records.saveFinal;
  let failed = false;
  fixture.ports.records.saveFinal = async (record) => {
    if (!failed) {
      failed = true;
      throw new Error("final store unavailable");
    }
    return saveFinal(record);
  };
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), /final store/u);
  const from = fixture.state.calls.length;
  const published = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.deepEqual(publicationCalls(fixture.state, from), ["artifact:open", "final:save"]);
  assert.equal(published.capsuleRef, "run-capsule:handoff:001");
  assert.equal(fixture.state.capsules, 1);
});

test("a publication that already has a final record returns it without new effects", async () => {
  const fixture = await preparedFixture();
  const first = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  const from = fixture.state.calls.length;
  const again = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  assert.deepEqual(again, first);
  assert.deepEqual(publicationCalls(fixture.state, from), ["artifact:open"]);
});

test("publication progress saved for other Handoff content fails closed", async () => {
  const fixture = await preparedFixture();
  fixture.state.progress.set(fixture.prepared.handoffRef, {
    workspaceId: prepareInput().workspaceId,
    handoffRef: fixture.prepared.handoffRef,
    handoffDigest: sha("other-handoff")
  });
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), {
    code: "VES_HANDOFF_FINAL_RECORD_INVALID"
  });
  assert.equal(fixture.state.effects, 0);
});

test("a publish input with another schema version fails closed before the artifact is opened", async () => {
  const { state, ports, prepared } = await preparedFixture();
  const from = state.calls.length;
  await assert.rejects(coordinator(ports).publish(publishInput(prepared, { schemaVersion: 2 })), {
    code: "VES_HANDOFF_INPUT_INVALID"
  });
  assert.deepEqual(publicationCalls(state, from), []);
});

test("a publication Approval for another action fails closed before the effect", async () => {
  const { state, ports, prepared } = await preparedFixture({
    publicationApproval: {
      verify: async () => ({
        valid: true,
        action: "execution",
        approvalRef: "approval:handoff-publication:001",
        bindingDigest: sha("publication-binding")
      })
    }
  });
  await assert.rejects(coordinator(ports).publish(publishInput(prepared)), {
    code: "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID"
  });
  assert.equal(state.effects, 0);
});

test("a publication effect that answers for another idempotency key fails closed", async () => {
  const { state, ports, prepared } = await preparedFixture({
    effects: {
      publish: async () => ({
        status: "completed",
        idempotencyKey: sha("another-publication"),
        receiptRef: "receipt:handoff-publication:001",
        receiptDigest: sha("publication-receipt")
      })
    }
  });
  await assert.rejects(coordinator(ports).publish(publishInput(prepared)), {
    code: "VES_HANDOFF_PUBLICATION_INVALID"
  });
  assert.equal(state.claimsDisposed, 0);
});

test("an uncertain publication effect requires reconciliation", async () => {
  const { ports, prepared } = await preparedFixture({
    effects: { publish: async () => ({ status: "uncertain", idempotencyKey: sha("unknown") }) }
  });
  await assert.rejects(coordinator(ports).publish(publishInput(prepared)), {
    code: "VES_HANDOFF_RECONCILIATION_REQUIRED"
  });
});

test("an invalid claim disposition fails closed before the pre-terminal checkpoint", async () => {
  const { state, ports, prepared } = await preparedFixture({
    claims: {
      dispose: async () => ({
        valid: false,
        claimDispositionRef: "claim-disposition:001",
        claimDispositionDigest: sha("claim-disposition")
      })
    }
  });
  await assert.rejects(coordinator(ports).publish(publishInput(prepared)), { code: "VES_HANDOFF_CLAIM_INVALID" });
  assert.equal(state.progress.size, 0);
});

test("a sealed capsule that inherits receiver Approval fails closed before its checkpoint", async () => {
  const fixture = await preparedFixture();
  const seal = fixture.ports.capsules.seal;
  fixture.ports.capsules.seal = async (request) => ({ ...(await seal(request)), receiverApprovalInherited: true });
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), {
    code: "VES_HANDOFF_CAPSULE_INVALID"
  });
  assert.equal(fixture.state.calls.includes("progress:CAPSULE_SEALED"), false);
});

test("a source run that does not match the prepared Handoff fails closed", async () => {
  const { ports, prepared } = await preparedFixture();
  await assert.rejects(
    coordinator(ports).publish(
      publishInput(prepared, {
        source: { ...prepared.source, successorRunId: "run_018f0b6d-7b1a-7abc-8def-812345678901" }
      })
    ),
    { code: "VES_HANDOFF_ARTIFACT_INVALID" }
  );
});
