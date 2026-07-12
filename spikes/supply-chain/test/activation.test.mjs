import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ActivationManager, REQUIRED_ACTIVATION_COMPONENTS } from "../src/activation.mjs";

const roots = [];
async function tempRoot() {
  const value = await mkdtemp(join(tmpdir(), "verchestra-activation-"));
  roots.push(value);
  return value;
}
afterEach(async () => Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function candidate(releaseId, overrides = {}) {
  const components = REQUIRED_ACTIVATION_COMPONENTS.map((name) => {
    const content = Buffer.from(`${releaseId}:${name}`);
    return { name, path: `${name}.bin`, releaseId, sha256: sha256(content), content };
  });
  return { releaseId, platform: "win32-x64", components, ...overrides };
}

async function manager() {
  const root = await tempRoot();
  return { root, activation: new ActivationManager({ root, platform: "win32-x64" }) };
}

test("stages and activates a complete release only after its health gate", async () => {
  const { activation } = await manager();
  const receipt = await activation.install(candidate("1.0.0"));
  assert.deepEqual(receipt, { previous: null, active: "1.0.0", rolledBack: false });
  assert.equal((await activation.active()).releaseId, "1.0.0");
  assert.equal((await activation.events()).at(-1), "active-pointer-switched");
});

test("active pointer is a small release reference, not copied release content", async () => {
  const { root, activation } = await manager();
  await activation.install(candidate("1.0.0"));
  const pointer = JSON.parse(await readFile(join(root, "active.json"), "utf8"));
  assert.deepEqual(pointer, { releaseId: "1.0.0" });
});

async function seeded(faultStage) {
  const root = await tempRoot();
  const stable = new ActivationManager({ root, platform: "win32-x64" });
  await stable.install(candidate("1.0.0"));
  const activation = new ActivationManager({ root, platform: "win32-x64", fault: (stage) => { if (stage === faultStage) throw new Error(`injected:${stage}`); } });
  return { root, activation };
}

async function assertLastKnownGood(action, activation, code) {
  await assert.rejects(action, { code, previousActive: "1.0.0" });
  assert.equal((await activation.active()).releaseId, "1.0.0");
}

test("wrong-platform candidate preserves last-known-good", async () => {
  const { activation } = await seeded();
  await assertLastKnownGood(() => activation.install(candidate("2.0.0", { platform: "linux-x64" })), activation, "VES_ACTIVATION_PLATFORM_MISMATCH");
});

test("mixed release component preserves last-known-good", async () => {
  const { activation } = await seeded();
  const next = candidate("2.0.0");
  next.components[0].releaseId = "1.0.0";
  await assertLastKnownGood(() => activation.install(next), activation, "VES_ACTIVATION_RELEASE_MIXED");
});

test("missing required component preserves last-known-good", async () => {
  const { activation } = await seeded();
  const next = candidate("2.0.0");
  next.components = next.components.filter((component) => component.name !== "licenses");
  await assertLastKnownGood(() => activation.install(next), activation, "VES_ACTIVATION_COMPONENT_MISSING");
});

test("component digest mismatch preserves last-known-good", async () => {
  const { activation } = await seeded();
  const next = candidate("2.0.0");
  next.components[0].content = Buffer.from("tampered");
  await assertLastKnownGood(() => activation.install(next), activation, "VES_ACTIVATION_INTEGRITY");
});

for (const [stage, code] of [
  ["before-write", "VES_ACTIVATION_STAGE_FAILED"],
  ["before-health", "VES_ACTIVATION_HEALTH_FAILED"],
  ["before-publish", "VES_ACTIVATION_PUBLISH_FAILED"],
  ["before-pointer", "VES_ACTIVATION_POINTER_FAILED"]
]) {
  test(`${stage} failure preserves last-known-good without partial activation`, async () => {
    const { activation } = await seeded(stage);
    await assertLastKnownGood(() => activation.install(candidate("2.0.0")), activation, code);
  });
}

test("rollback atomically selects a previously verified release", async () => {
  const { activation } = await manager();
  await activation.install(candidate("1.0.0"));
  await activation.install(candidate("2.0.0"));
  const receipt = await activation.rollback("1.0.0");
  assert.deepEqual(receipt, { previous: "2.0.0", active: "1.0.0", rolledBack: true });
  assert.equal((await activation.active()).releaseId, "1.0.0");
});

test("rollback to missing or corrupt release preserves current active release", async () => {
  const { root, activation } = await manager();
  await activation.install(candidate("1.0.0"));
  await assert.rejects(() => activation.rollback("missing"), { code: "VES_ROLLBACK_TARGET_INVALID", previousActive: "1.0.0" });
  assert.equal((await activation.active()).releaseId, "1.0.0");
  await writeFile(join(root, "releases", "1.0.0", "release.json"), "corrupt");
  await assert.rejects(() => activation.rollback("1.0.0"), { code: "VES_ROLLBACK_TARGET_INVALID", previousActive: "1.0.0" });
  assert.equal((await activation.active()).releaseId, "1.0.0");
});
