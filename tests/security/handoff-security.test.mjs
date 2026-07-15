import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptInput,
  continueInput,
  coordinator,
  handoffPorts,
  prepareInput,
  preparedFixture,
  publishInput,
  publishedFixture,
  sha
} from "../helpers/handoff-fixture.mjs";

for (const field of [
  "provider",
  "backend",
  "model",
  "session",
  "transcript",
  "credential",
  "secretValue",
  "localPath"
]) {
  test(`portable Handoff rejects prohibited ${field} material`, async () => {
    const input = prepareInput();
    input.package[field] = field === "localPath" ? "C:\\secret\\repo" : "private-value";
    const { state, ports } = handoffPorts();
    await assert.rejects(coordinator(ports).prepare(input), { code: "VES_HANDOFF_PRIVATE_MATERIAL" });
    assert.equal(state.calls.length, 0);
  });
}

test("cross-Workspace artifact cannot be inspected or accepted", async () => {
  const fixture = await publishedFixture();
  const foreign = "workspace_018f0b6d-7b1a-7abc-8def-999999999999";
  await assert.rejects(
    coordinator(fixture.ports).inspect({
      schemaVersion: 1,
      workspaceId: foreign,
      handoffRef: fixture.published.handoffRef,
      handoffDigest: fixture.published.handoffDigest
    }),
    { code: "VES_HANDOFF_WORKSPACE_MISMATCH" }
  );
  await assert.rejects(coordinator(fixture.ports).accept(acceptInput(fixture.published, { workspaceId: foreign })), {
    code: "VES_HANDOFF_WORKSPACE_MISMATCH"
  });
});

test("source-state drift blocks Handoff preparation", async () => {
  const { state, ports } = handoffPorts();
  await assert.rejects(coordinator(ports).prepare(prepareInput({ currentSourceStateDigest: sha("changed") })), {
    code: "VES_HANDOFF_SOURCE_STALE"
  });
  assert.equal(state.artifacts.size, 0);
});

test("invalid package proof blocks preparation before artifact persistence", async () => {
  const { state, ports } = handoffPorts({ packages: { verify: async () => ({ valid: false }) } });
  await assert.rejects(coordinator(ports).prepare(prepareInput()), { code: "VES_HANDOFF_PACKAGE_INVALID" });
  assert.equal(state.artifacts.size, 0);
});

test("forged Handoff digest blocks publication", async () => {
  const fixture = await preparedFixture();
  await assert.rejects(
    coordinator(fixture.ports).publish(publishInput(fixture.prepared, { handoffDigest: sha("forged") })),
    { code: "VES_HANDOFF_ARTIFACT_INVALID" }
  );
  assert.equal(fixture.state.effects, 0);
});

test("publication Approval cannot be replaced by execution Approval", async () => {
  const fixture = await preparedFixture({
    publicationApproval: {
      verify: async () => ({
        valid: true,
        action: "execution",
        approvalRef: "approval:handoff-publication:001",
        bindingDigest: sha("publication-binding")
      })
    }
  });
  await assert.rejects(coordinator(fixture.ports).publish(publishInput(fixture.prepared)), {
    code: "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID"
  });
  assert.equal(fixture.state.effects, 0);
});

test("invalid capsule blocks receiver acceptance", async () => {
  const fixture = await publishedFixture({ capsules: { verify: async () => ({ valid: false }) } });
  await assert.rejects(coordinator(fixture.ports).accept(acceptInput(fixture.published)), {
    code: "VES_HANDOFF_CAPSULE_INVALID"
  });
  assert.equal(fixture.state.claimsAcquired, 0);
});

test("otherwise valid capsule cannot inherit receiver Approval", async () => {
  const fixture = await publishedFixture({
    capsules: {
      verify: async (request) => ({
        valid: true,
        status: "HANDED_OFF",
        sourceRunId: request.artifact.sourceRunId,
        successorRunId: request.artifact.successorRunId,
        packageRef: request.artifact.package.packageRef,
        packageDigest: request.artifact.package.packageDigest,
        sourceStateDigest: request.artifact.package.sourceStateDigest,
        receiverApprovalInherited: true
      })
    }
  });
  await assert.rejects(coordinator(fixture.ports).accept(acceptInput(fixture.published)), {
    code: "VES_HANDOFF_CAPSULE_INVALID"
  });
  assert.equal(fixture.state.claimsAcquired, 0);
});

test("semantic obligations cannot be substituted during preparation", async () => {
  const { state, ports } = handoffPorts();
  await assert.rejects(
    coordinator(ports).prepare(prepareInput({ semanticObligationsDigest: sha("different-obligations") })),
    { code: "VES_HANDOFF_PACKAGE_INVALID" }
  );
  assert.equal(state.artifacts.size, 0);
});

test("stored artifact content tamper fails even when the store claims validity", async () => {
  const fixture = await preparedFixture();
  const stored = fixture.state.artifacts.get(fixture.prepared.handoffRef);
  fixture.state.artifacts.set(fixture.prepared.handoffRef, {
    ...stored,
    artifact: {
      ...stored.artifact,
      destination: { ...stored.artifact.destination, targetRef: "destination:attacker" }
    }
  });
  await assert.rejects(
    coordinator(fixture.ports).inspect({
      schemaVersion: 1,
      workspaceId: fixture.prepared.workspaceId,
      handoffRef: fixture.prepared.handoffRef,
      handoffDigest: fixture.prepared.handoffDigest
    }),
    { code: "VES_HANDOFF_ARTIFACT_INVALID" }
  );
});

test("receiver cannot substitute the linked successor identity", async () => {
  const fixture = await publishedFixture();
  await assert.rejects(
    coordinator(fixture.ports).accept(
      acceptInput(fixture.published, { successorRunId: "run_018f0b6d-7b1a-7abc-8def-812345678901" })
    ),
    { code: "VES_HANDOFF_SUCCESSOR_MISMATCH" }
  );
  assert.equal(fixture.state.claimsAcquired, 0);
});

test("stale local Execution Approval cannot authorize continuation", async () => {
  const fixture = await publishedFixture();
  const accepted = await coordinator(fixture.ports).accept(acceptInput(fixture.published));
  await assert.rejects(
    coordinator(fixture.ports).continue(
      continueInput(accepted, {
        executionApproval: {
          approvalRef: "approval:execution:receiver:001",
          approvalDigest: sha("receiver-execution-approval"),
          bindingDigest: sha("stale")
        }
      })
    ),
    { code: "VES_HANDOFF_EXECUTION_APPROVAL_INVALID" }
  );
});
