import assert from "node:assert/strict";
import { test } from "node:test";
import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import { grillSkill, lock, skill, verifier } from "../helpers/skill-registry-fixture.mjs";

function setup(transaction) {
  return new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT"],
    transaction
  });
}

function candidate(overrides = {}) {
  return lock({ generation: 2, skills: [skill({ version: "3.2.1" }), grillSkill()], ...overrides });
}

test("update plan binds current/candidate locks, qualification, and visible diff", async () => {
  const plan = await setup().planUpdate({
    current: lock(),
    candidate: candidate(),
    qualification: { passed: true, evidenceDigest: "sha256:" + "f".repeat(64) },
    diff: [{ path: "skills/tlc/SKILL.md", change: "modified" }]
  });
  assert.equal(plan.currentLockDigest, lock().lockDigest);
  assert.equal(plan.candidateLockDigest, candidate().lockDigest);
  assert.equal(plan.diff.length, 1);
  assert.equal(plan.planId.startsWith("sha256:"), true);
});

for (const [name, request, code] of [
  ["generation jump", { candidate: candidate({ generation: 3 }) }, "VES_SKILL_UPDATE_GENERATION"],
  [
    "failed qualification",
    { qualification: { passed: false, evidenceDigest: "sha256:" + "f".repeat(64) } },
    "VES_SKILL_QUALIFICATION_FAILED"
  ],
  ["missing diff", { diff: [] }, "VES_SKILL_DIFF_REQUIRED"],
  ["tampered lock signature", { candidate: { ...candidate(), signature: "bad" } }, "VES_SKILL_SIGNATURE_INVALID"],
  [
    "tampered source signature",
    { candidate: candidate({ skills: [skill({ source: { ...skill().source, signature: "bad" } }), grillSkill()] }) },
    "VES_SKILL_SIGNATURE_INVALID"
  ],
  [
    "incompatible schema",
    { candidate: candidate({ skills: [skill({ schemaCompatibility: { minimum: 2, maximum: 2 } }), grillSkill()] }) },
    "VES_SKILL_SCHEMA_INCOMPATIBLE"
  ],
  [
    "denied license",
    { candidate: candidate({ skills: [skill({ license: "GPL-3.0" }), grillSkill()] }) },
    "VES_SKILL_LICENSE_DENIED"
  ]
]) {
  test(`update plan rejects ${name}`, async () => {
    const base = {
      current: lock(),
      candidate: candidate(),
      qualification: { passed: true, evidenceDigest: "sha256:" + "f".repeat(64) },
      diff: [{ path: "SKILL.md", change: "modified" }],
      ...request
    };
    await assert.rejects(setup().planUpdate(base), (error) => error.code === code);
  });
}

test("activation commits a fully verified update transaction", async () => {
  const calls = [];
  const transaction = {
    stage: async (value) => calls.push(["stage", value]),
    commit: async (value) => calls.push(["commit", value]),
    rollback: async () => calls.push(["rollback"])
  };
  const registry = setup(transaction);
  const plan = await registry.planUpdate({
    current: lock(),
    candidate: candidate(),
    qualification: { passed: true, evidenceDigest: "sha256:" + "f".repeat(64) },
    diff: [{ path: "SKILL.md", change: "modified" }]
  });
  const result = await registry.activate(plan, candidate());
  assert.equal(result.activated, true);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["stage", "commit"]
  );
});

test("activation rollback preserves the previous lock after commit failure", async () => {
  const calls = [];
  const transaction = {
    stage: async () => calls.push("stage"),
    commit: async () => {
      calls.push("commit");
      throw new Error("disk secret");
    },
    rollback: async () => calls.push("rollback")
  };
  const registry = setup(transaction);
  const plan = await registry.planUpdate({
    current: lock(),
    candidate: candidate(),
    qualification: { passed: true, evidenceDigest: "sha256:" + "f".repeat(64) },
    diff: [{ path: "SKILL.md", change: "modified" }]
  });
  await assert.rejects(
    registry.activate(plan, candidate()),
    (error) => error.code === "VES_SKILL_ACTIVATION_ROLLED_BACK" && !error.message.includes("disk secret")
  );
  assert.deepEqual(calls, ["stage", "commit", "rollback"]);
});

test("activation rejects a candidate changed after review", async () => {
  const transaction = { stage: async () => {}, commit: async () => {}, rollback: async () => {} };
  const registry = setup(transaction);
  const plan = await registry.planUpdate({
    current: lock(),
    candidate: candidate(),
    qualification: { passed: true, evidenceDigest: "sha256:" + "f".repeat(64) },
    diff: [{ path: "SKILL.md", change: "modified" }]
  });
  await assert.rejects(
    registry.activate(plan, candidate({ skills: [skill({ version: "3.2.2" }), grillSkill()] })),
    (error) => error.code === "VES_SKILL_PLAN_STALE"
  );
});
