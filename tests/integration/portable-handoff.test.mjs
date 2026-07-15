import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptInput,
  coordinator,
  handoffPorts,
  prepareInput,
  preparedFixture,
  publishInput,
  publishedFixture,
  sha,
  successorRunId
} from "../helpers/handoff-fixture.mjs";

test("prepare verifies package before persisting a portable handoff", async () => {
  const { state, ports } = handoffPorts();
  await coordinator(ports).prepare(prepareInput());
  assert.deepEqual(state.calls.slice(0, 3), ["package:verify", "artifact:save", "workflow:PREPARE_HANDOFF"]);
});

test("prepare clears source Approval and binds the successor", async () => {
  const { ports } = handoffPorts();
  const result = await coordinator(ports).prepare(prepareInput());
  assert.equal(result.source.state, "HANDOFF_PREPARING");
  assert.equal(result.source.approval, undefined);
  assert.equal(result.source.successorRunId, successorRunId);
});

test("portable artifact binds package source obligations destination and claim", async () => {
  const { state, ports } = handoffPorts();
  const result = await coordinator(ports).prepare(prepareInput());
  const artifact = state.artifacts.get(result.handoffRef).artifact;
  assert.equal(artifact.package.sourceStateDigest, sha("source-state"));
  assert.equal(artifact.semanticObligationsDigest, sha("semantic-obligations"));
  assert.equal(artifact.destination.kind, "remote");
  assert.equal(artifact.claim.disposition, "release");
});

test("remote publish verifies publication-only Approval before effect", async () => {
  const { state, ports, prepared } = await preparedFixture();
  await coordinator(ports).publish(publishInput(prepared));
  assert.ok(
    state.calls.indexOf("workflow:REQUEST_HANDOFF_PUBLICATION_APPROVAL") < state.calls.indexOf("effect:publish")
  );
  assert.ok(state.calls.indexOf("effect:publish") < state.calls.indexOf("workflow:COMPLETE_HANDOFF"));
});

test("local publish requires no remote Approval or effect", async () => {
  const { state, ports } = handoffPorts();
  const prepared = await coordinator(ports).prepare(
    prepareInput({
      destination: { kind: "local", targetRef: "destination:local-cas", destinationDigest: sha("local") }
    })
  );
  const published = await coordinator(ports).publish(publishInput(prepared, { publicationApproval: undefined }));
  assert.equal(published.status, "HANDED_OFF");
  assert.equal(state.effects, 0);
});

for (const disposition of ["release", "transfer"]) {
  test(`source claim ${disposition} produces exact capsule evidence`, async () => {
    const { state, ports } = handoffPorts();
    const prepared = await coordinator(ports).prepare(
      prepareInput({ claim: { claimRef: "claim:source:001", disposition } })
    );
    const published = await coordinator(ports).publish(publishInput(prepared));
    assert.equal(published.source.state, "HANDED_OFF");
    assert.ok(state.calls.includes(`claim:${disposition}`));
    assert.equal(state.capsules, 1);
  });
}

test("published record binds capsule package receipt claim and terminal source", async () => {
  const { state, published } = await publishedFixture();
  const record = state.finals.get(published.handoffRef);
  assert.equal(record.source.state, "HANDED_OFF");
  assert.equal(record.publication.receiptRef, "receipt:handoff-publication:001");
  assert.equal(record.claim.claimDispositionRef, "claim-disposition:001");
  assert.equal(record.capsule.capsuleRef, "run-capsule:handoff:001");
});

test("accept resolves local bindings secrets integrations policy then claim", async () => {
  const { state, ports, published } = await publishedFixture();
  await coordinator(ports).accept(acceptInput(published));
  assert.deepEqual(state.calls.slice(-6), [
    "bindings:resolve",
    "secrets:rebind",
    "integrations:rebind",
    "policy:reevaluate",
    "claim:acquire",
    "acceptance:save"
  ]);
});

test("accept creates linked execution-ready successor with no inherited Approval", async () => {
  const { ports, published } = await publishedFixture();
  const accepted = await coordinator(ports).accept(acceptInput(published));
  assert.equal(accepted.successor.state, "EXECUTION_READY");
  assert.equal(accepted.successor.predecessorRunId, published.source.runId);
  assert.equal(accepted.successor.approval, undefined);
  assert.equal(accepted.firstPendingTaskId, "T61");
});

test("inspect returns bounded portable metadata and verify authenticates closure", async () => {
  const { ports, published } = await publishedFixture();
  const service = coordinator(ports);
  const inspected = await service.inspect({
    schemaVersion: 1,
    workspaceId: published.source.runId.replace(/^run_.+$/, "workspace_018f0b6d-7b1a-7abc-8def-512345678901"),
    handoffRef: published.handoffRef,
    handoffDigest: published.handoffDigest
  });
  const verified = await service.verify(acceptInput(published));
  assert.deepEqual(Object.keys(inspected).sort(), [
    "destinationKind",
    "firstPendingTaskId",
    "handoffDigest",
    "handoffRef",
    "sourceRunId",
    "successorRunId"
  ]);
  assert.equal(verified.valid, true);
});
