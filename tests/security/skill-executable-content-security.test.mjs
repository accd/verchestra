import assert from "node:assert/strict";
import { test } from "node:test";
import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import { grillSkill, lock, profile, skill, verifier } from "../helpers/skill-registry-fixture.mjs";

function registry() {
  return new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT"]
  });
}

const digest = "sha256:" + "9".repeat(64);
for (const [name, content] of [
  ["JavaScript", { path: "hidden.js", mediaType: "text/javascript", text: "process.exit()" }],
  ["PowerShell", { path: "hidden.ps1", mediaType: "text/plain", text: "Write-Host x" }],
  ["Python", { path: "hidden.py", mediaType: "text/plain", text: "print(1)" }],
  ["shell", { path: "hidden.sh", mediaType: "text/plain", text: "echo x" }],
  ["Wasm", { path: "hidden.wasm", mediaType: "application/wasm" }],
  ["executable", { path: "runner", mediaType: "application/octet-stream", executable: true }],
  ["shebang", { path: "guide.txt", mediaType: "text/plain", text: "#!/usr/bin/env node\nrun()" }],
  [
    "package script",
    { path: "package.json", mediaType: "application/json", text: '{"scripts":{"postinstall":"node x.js"}}' }
  ]
]) {
  test(`hidden ${name} content cannot install as documentation`, async () => {
    const hostile = skill({ contents: [{ ...content, digest, declaredClass: "documentation" }] });
    await assert.rejects(
      registry().resolve(profile(), lock({ skills: [hostile, grillSkill()] })),
      (error) => error.code === "VES_SKILL_HIDDEN_EXECUTABLE"
    );
  });
}

test("declared executable still requires an approved Tool or Plugin reference", async () => {
  const executable = skill({
    contents: [{ path: "tool.js", digest, declaredClass: "executable", mediaType: "text/javascript" }]
  });
  await assert.rejects(
    registry().resolve(profile(), lock({ skills: [executable, grillSkill()] })),
    (error) => error.code === "VES_SKILL_EXECUTION_UNAUTHORIZED"
  );
});

test("approved Plugin classification does not grant Skill execution authority", async () => {
  const executable = skill({
    extensionRef: { kind: "plugin", id: "plugin:tlc-tools", approvalRef: "approval:1" },
    contents: [{ path: "tool.js", digest, declaredClass: "executable", mediaType: "text/javascript" }]
  });
  const resolved = await registry().resolve(profile(), lock({ skills: [executable, grillSkill()] }));
  assert.equal(resolved.skills.find((entry) => entry.id === "tlc-spec-driven").executionAuthority, false);
  assert.equal(resolved.skills.find((entry) => entry.id === "tlc-spec-driven").executableContent, true);
});

test("Grill cannot persist an executable or noncanonical durable output", async () => {
  const value = lock({ skills: [skill(), grillSkill({ durableOutputs: ["context", "shell-script"] })] });
  await assert.rejects(
    registry().resolve(profile(), value),
    (error) => error.code === "VES_SKILL_GRILL_OUTPUT_INVALID"
  );
});

test("lock digest tampering fails before any Skill resolves", async () => {
  const value = { ...lock(), lockDigest: "sha256:" + "0".repeat(64) };
  await assert.rejects(registry().resolve(profile(), value), (error) => error.code === "VES_SKILL_LOCK_TAMPERED");
});
