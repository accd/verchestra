import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FileExecutionPackageStore, canonicalizeJson, sha256Digest } from "../../packages/evidence/src/index.ts";
import { currentState, digest, executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";

for (const field of [
  "provider",
  "providerId",
  "backend",
  "backendId",
  "model",
  "modelId",
  "sessionId",
  "threadId",
  "turnId",
  "transcript",
  "credential",
  "secretValue",
  "providerToken",
  "localPath",
  "absolutePath"
]) {
  test(`package schema rejects prohibited machine/provider field: ${field}`, async () => {
    const input = packageInput({ [field]: "private-value" });
    const { builder } = executionHarness();
    await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_INVALID" });
  });
}

for (const value of [
  "C:\\Users\\person\\repo",
  "/home/person/repo",
  "\\\\server\\share\\repo",
  "file:///private/repo",
  "C:/work/repo"
]) {
  test(`absolute local component path is prohibited: ${value}`, async () => {
    const input = packageInput();
    input.tasks[0].componentRefs = [value];
    const { builder } = executionHarness();
    await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_LOCAL_PATH" });
  });
}

test("open requirement assumption blocks package construction", async () => {
  const input = packageInput();
  input.requirements[0].assumptionState = "open";
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_REQUIREMENT_INVALID" });
});

test("imprecise acceptance criterion blocks package construction", async () => {
  const input = packageInput();
  input.requirements[0].acceptanceCriteria = "Should probably work";
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_REQUIREMENT_INVALID" });
});

test("unknown task requirement blocks package construction", async () => {
  const input = packageInput();
  input.tasks[0].requirementIds = ["VES-UNKNOWN-999"];
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_TASK_INVALID" });
});

test("unknown task dependency blocks package construction", async () => {
  const input = packageInput();
  input.tasks[1].dependsOn = ["T-unknown"];
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_TASK_INVALID" });
});

test("cyclic task dependency blocks package construction", async () => {
  const input = packageInput();
  input.tasks[0].dependsOn = ["T-3"];
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_TASK_CYCLE" });
});

test("duplicate task identity blocks package construction", async () => {
  const input = packageInput();
  input.tasks.push(structuredClone(input.tasks[0]));
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_TASK_INVALID" });
});

test("completion without completed dependencies blocks construction", async () => {
  const input = packageInput();
  input.completedTaskEvidence = [
    {
      taskId: "T-2",
      result: "passed",
      evidenceDigest: digest("T-2"),
      sourceStateDigest: digest(input.bindings.sourceState)
    }
  ];
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_COMPLETION_INVALID" });
});

test("completion evidence bound to another source state is rejected", async () => {
  const input = packageInput();
  input.completedTaskEvidence[0].sourceStateDigest = digest("foreign-source");
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_COMPLETION_INVALID" });
});

test("signature tampering never reaches current-state comparison", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const replacement = sealed.signature.startsWith("A") ? "B" : "A";
  const tampered = { ...sealed, signature: `${replacement}${sealed.signature.slice(1)}` };
  const result = await builder.verify(tampered, trust, currentState(input, { policyDigest: digest("changed") }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "VES_SIGNATURE_INVALID");
  assert.equal("invalidations" in result, false);
});

test("malformed envelope fails closed without throwing", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const result = await builder.verify(null, trust, currentState(input));
  assert.deepEqual(result, { ok: false, code: "VES_EXECUTION_PACKAGE_INVALID" });
});

test("null source state fails closed during build", async () => {
  const input = packageInput();
  input.bindings.sourceState = null;
  const { builder } = executionHarness();
  await assert.rejects(builder.build(input), { code: "VES_EXECUTION_PACKAGE_INVALID" });
});

test("null current source state fails closed without throwing", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, { ...currentState(input), sourceState: null });
  assert.deepEqual(result, { ok: false, code: "VES_EXECUTION_PACKAGE_CURRENT_STATE_INVALID" });
});

test("payload tampering fails content integrity before semantic use", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const tampered = structuredClone(sealed);
  tampered.payload.featureId = "feature:attacker";
  const result = await builder.verify(tampered, trust, currentState(input));
  assert.equal(result.ok, false);
  assert.equal(result.code, "VES_INTEGRITY_PAYLOAD_DIGEST_MISMATCH");
});

test("trusted signer cannot make inconsistent pending-work claims", async () => {
  const input = packageInput();
  const { builder, sealer, trust } = executionHarness();
  const valid = await builder.build(input);
  const forgedPayload = { ...valid.payload, pendingTasks: [] };
  const forged = await sealer.seal(forgedPayload, {
    schema: { name: "execution-package", version: 1 },
    purpose: "execution-package",
    bindingId: valid.bindingId,
    sourceStateDigest: valid.sourceStateDigest
  });
  const result = await builder.verify(forged, trust, currentState(input));
  assert.equal(result.ok, false);
  assert.equal(result.code, "VES_EXECUTION_PACKAGE_DERIVATION_INVALID");
});

test("foreign Workspace state invalidates without leaking foreign sources", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, {
    ...currentState(input),
    workspaceId: "workspace_foreign",
    sourceState: { "repo:foreign-secret": digest("secret") }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.invalidations, [
    {
      field: "workspaceId",
      expectedDigest: digest(input.workspaceId),
      actualDigest: digest("workspace_foreign"),
      approvalInvalidated: true
    }
  ]);
  assert.equal(JSON.stringify(result).includes("foreign-secret"), false);
});

test("untrusted extra current-state authority field is rejected", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, { ...currentState(input), approval: "approved" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "VES_EXECUTION_PACKAGE_CURRENT_STATE_INVALID");
});

test("store rejects malformed package IDs before path construction", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-security-"));
  const store = new FileExecutionPackageStore({ root });
  await assert.rejects(store.get("../outside"), { code: "VES_EXECUTION_PACKAGE_STORAGE_INVALID" });
});

test("linked store root target cannot redirect publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-security-"));
  const outside = join(root, "outside");
  const packages = join(root, "packages");
  await mkdir(outside);
  await symlink(outside, packages, "junction");
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  const store = new FileExecutionPackageStore({ root: packages });
  await assert.rejects(store.put(sealed), { code: "VES_EXECUTION_PACKAGE_STORAGE_INVALID" });
});

test("store detects content-address mismatch even for parseable JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-security-"));
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  await writeFile(join(root, `${sealed.artifactId}.json`), canonicalizeJson({ ...sealed, keyId: "other" }), "utf8");
  const store = new FileExecutionPackageStore({ root });
  await assert.rejects(store.get(sealed.artifactId), { code: "VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY" });
  assert.notEqual(sha256Digest({ ...sealed, keyId: "other" }), sha256Digest(sealed));
});
