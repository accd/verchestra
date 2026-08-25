import assert from "node:assert/strict";
import { test } from "node:test";
import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import { grillSkill, lock, profile, skill, verifier } from "../helpers/skill-registry-fixture.mjs";
import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";

function registry() {
  return new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT", "Apache-2.0"]
  });
}

test("standard profile routes Grill before every TLC-owned phase", async () => {
  const resolved = await registry().resolve(profile(), lock());
  assert.deepEqual(
    resolved.route.map((step) => `${step.skillId}:${step.phase}`),
    [
      "grill-with-docs:pre-specify",
      "tlc-spec-driven:specify",
      "tlc-spec-driven:design",
      "tlc-spec-driven:tasks",
      "tlc-spec-driven:execute",
      "tlc-spec-driven:verify"
    ]
  );
  assert.equal(
    resolved.skills.every((entry) => entry.executionAuthority === false),
    true
  );
});

test("Grill can be disabled without changing TLC ownership", async () => {
  const resolved = await registry().resolve(
    profile({ grillEnabled: false, enabledSkillIds: ["tlc-spec-driven"] }),
    lock()
  );
  assert.equal(resolved.route[0].phase, "specify");
  assert.equal(
    resolved.route.every((step) => step.skillId === "tlc-spec-driven"),
    true
  );
});

test("Grill durable outputs are exactly canonical Context and ADR", async () => {
  const resolved = await registry().resolve(profile(), lock());
  assert.deepEqual(resolved.skills.find((entry) => entry.id === "grill-with-docs").durableOutputs, ["adr", "context"]);
});

for (const phase of ["specify", "design", "tasks", "execute", "verify"]) {
  test(`standard profile rejects another ${phase} owner`, async () => {
    const overlap = skill({
      id: `matt-${phase}`,
      lifecycleOwners: [phase],
      source: { ...skill().source, commit: "e".repeat(40) }
    });
    const value = lock({ skills: [skill(), grillSkill(), overlap] });
    await assert.rejects(
      registry().resolve(profile({ enabledSkillIds: [...profile().enabledSkillIds, overlap.id] }), value),
      (error) => error.code === "VES_SKILL_OWNER_OVERLAP"
    );
  });
}

test("Grill cannot own a TLC lifecycle phase", async () => {
  const value = lock({ skills: [skill(), grillSkill({ lifecycleOwners: ["specify"] })] });
  await assert.rejects(registry().resolve(profile(), value), (error) => error.code === "VES_SKILL_OWNER_OVERLAP");
});

for (const [name, mutate, code] of [
  ["schema", (value) => ({ ...value, schemaVersion: 2 }), "VES_SKILL_SCHEMA_INCOMPATIBLE"],
  ["generation", (value) => ({ ...value, generation: 0 }), "VES_SKILL_LOCK_INVALID"],
  [
    "commit",
    (value) => ({ ...value, skills: [skill({ source: { ...skill().source, commit: "main" } }), grillSkill()] }),
    "VES_SKILL_SOURCE_MUTABLE"
  ],
  [
    "tree digest",
    (value) => ({ ...value, skills: [skill({ source: { ...skill().source, treeDigest: "raw" } }), grillSkill()] }),
    "VES_SKILL_LOCK_INVALID"
  ],
  [
    "license",
    (value) => ({ ...value, skills: [skill({ license: "GPL-3.0" }), grillSkill()] }),
    "VES_SKILL_LICENSE_DENIED"
  ],
  [
    "TLC version",
    (value) => ({ ...value, skills: [skill({ version: "3.1.9" }), grillSkill()] }),
    "VES_SKILL_TLC_VERSION"
  ],
  [
    "harness version",
    (value) => ({ ...value, skills: [skill({ minimumHarnessVersion: "2.0.0" }), grillSkill()] }),
    "VES_SKILL_HARNESS_INCOMPATIBLE"
  ],
  [
    "skill schema",
    (value) => ({ ...value, skills: [skill({ schemaCompatibility: { minimum: 2, maximum: 3 } }), grillSkill()] }),
    "VES_SKILL_SCHEMA_INCOMPATIBLE"
  ],
  ["duplicate", (value) => ({ ...value, skills: [skill(), skill(), grillSkill()] }), "VES_SKILL_LOCK_INVALID"],
  ["missing TLC", (value) => ({ ...value, skills: [grillSkill()] }), "VES_SKILL_TLC_REQUIRED"]
]) {
  test(`lock rejects invalid ${name}`, async () => {
    await assert.rejects(registry().resolve(profile(), mutate(lock())), (error) => error.code === code);
  });
}

test("profile rejects an unknown enabled Skill", async () => {
  await assert.rejects(
    registry().resolve(profile({ enabledSkillIds: ["tlc-spec-driven", "unknown"] }), lock()),
    (error) => error.code === "VES_SKILL_UNKNOWN"
  );
});

// Issue #58: skillLockDigest used to hash a private recursive serialization
// whose object members were ordered by ambient localeCompare. A Skill lock
// sealed on one machine was therefore reported as VES_SKILL_LOCK_TAMPERED on
// another whose collation ordered one member pair differently -- a portability
// defect that reads as a supply-chain attack.
test("a Skill lock sealed under one collation still verifies under another", async () => {
  const sealed = lock();
  assert.equal((await withHostileLocaleCompare(() => lock())).lockDigest, sealed.lockDigest);
  const resolved = await withHostileLocaleCompare(() => registry().resolve(profile(), sealed));
  assert.equal(resolved.lockDigest, sealed.lockDigest);
});

test("ownership graph rejects a dependency cycle", async () => {
  const value = lock({ skills: [skill({ after: ["grill-with-docs"] }), grillSkill({ after: ["tlc-spec-driven"] })] });
  await assert.rejects(registry().resolve(profile(), value), (error) => error.code === "VES_SKILL_GRAPH_CYCLE");
});
