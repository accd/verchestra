import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptInput,
  continueInput,
  coordinator,
  handoffPorts,
  prepareInput,
  publishInput,
  sha,
  workspaceId
} from "../helpers/handoff-fixture.mjs";

async function journey(overrides = {}) {
  const { state, ports } = handoffPorts(overrides);
  const service = coordinator(ports);
  const prepared = await service.prepare(prepareInput());
  const published = await service.publish(publishInput(prepared));
  const accepted = await service.accept(acceptInput(published));
  return { state, ports, service, prepared, published, accepted };
}

test("Claude-profile source continues under local OpenCode Qwen bindings", async () => {
  const result = await journey();
  const continued = await result.service.continue(continueInput(result.accepted));
  assert.equal(continued.status, "EXECUTION_AUTHORIZED");
  assert.equal(continued.firstPendingTaskId, "T61");
});

test("receiver backend profile is local and absent from portable artifact", async () => {
  const result = await journey();
  const artifact = result.state.artifacts.get(result.prepared.handoffRef).artifact;
  const portable = JSON.stringify(artifact).toLowerCase();
  for (const forbidden of ["claude", "qwen", "opencode", "provider", "backend", "session", "transcript"])
    assert.equal(portable.includes(forbidden), false);
});

test("acceptance invalidates source Approval and continuation requires a new local one", async () => {
  const result = await journey();
  assert.equal(result.accepted.successor.approval, undefined);
  const continued = await result.service.continue(continueInput(result.accepted));
  assert.equal(continued.successor.approval.bindingDigest, result.accepted.localBindingDigest);
});

test("complete journey creates exactly one source terminal and one successor", async () => {
  const result = await journey();
  await result.service.continue(continueInput(result.accepted));
  assert.equal(result.state.finals.size, 1);
  assert.equal(result.state.acceptances.size, 1);
  assert.equal(result.state.capsules, 1);
  assert.equal(result.state.claimsAcquired, 1);
});

test("prepare retry returns one portable artifact", async () => {
  const { state, ports } = handoffPorts();
  const service = coordinator(ports);
  const one = await service.prepare(prepareInput());
  const two = await service.prepare(prepareInput());
  assert.equal(one.handoffDigest, two.handoffDigest);
  assert.equal(state.artifacts.size, 1);
});

test("publish retry returns the same final record and capsule", async () => {
  const { state, ports } = handoffPorts();
  const service = coordinator(ports);
  const prepared = await service.prepare(prepareInput());
  const one = await service.publish(publishInput(prepared));
  const two = await service.publish(publishInput(prepared));
  assert.equal(one.recordDigest, two.recordDigest);
  assert.equal(one.capsuleDigest, two.capsuleDigest);
  assert.equal(state.capsules, 1);
});

test("accept retry returns the same linked successor receipt", async () => {
  const result = await journey();
  const two = await result.service.accept(acceptInput(result.published));
  assert.equal(two.acceptanceDigest, result.accepted.acceptanceDigest);
  assert.equal(result.state.claimsAcquired, 1);
});

test("continue retry converges on one authorized successor state", async () => {
  const result = await journey();
  const one = await result.service.continue(continueInput(result.accepted));
  const two = await result.service.continue(continueInput(result.accepted));
  assert.deepEqual(two, one);
});

test("semantic obligations and pending work remain identical across backend change", async () => {
  const result = await journey();
  assert.equal(result.accepted.semanticObligationsDigest, sha("semantic-obligations"));
  assert.deepEqual(result.accepted.pendingTaskIds, ["T61", "T62"]);
});

test("local-only journey reaches successor without a publication authority", async () => {
  const { state, ports } = handoffPorts();
  const service = coordinator(ports);
  const prepared = await service.prepare(
    prepareInput({
      destination: { kind: "local", targetRef: "destination:local-cas", destinationDigest: sha("local") }
    })
  );
  const published = await service.publish(publishInput(prepared, { publicationApproval: undefined }));
  const accepted = await service.accept(acceptInput(published));
  assert.equal(accepted.successor.state, "EXECUTION_READY");
  assert.equal(state.effects, 0);
  assert.equal(accepted.workspaceId, workspaceId);
});
