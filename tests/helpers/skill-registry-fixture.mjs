import { skillLockDigest } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";

const COMMIT = "a".repeat(40);
const DIGEST = "sha256:" + "b".repeat(64);

export function skill(overrides = {}) {
  return {
    id: "tlc-spec-driven",
    version: "3.2.0",
    minimumHarnessVersion: "1.0.0",
    license: "MIT",
    schemaCompatibility: { minimum: 1, maximum: 1 },
    source: {
      repository: "https://github.com/tech-leads-club/agent-skills",
      commit: COMMIT,
      treeDigest: DIGEST,
      signature: `source:${DIGEST}`
    },
    contents: [
      { path: "SKILL.md", digest: DIGEST, declaredClass: "documentation", mediaType: "text/markdown", text: "# TLC" }
    ],
    lifecycleOwners: ["specify", "design", "tasks", "execute", "verify"],
    hooks: [],
    after: [],
    ...overrides
  };
}

export function grillSkill(overrides = {}) {
  return skill({
    id: "grill-with-docs",
    source: {
      repository: "https://github.com/mattpocock/skills",
      commit: "c".repeat(40),
      treeDigest: "sha256:" + "d".repeat(64),
      signature: `source:${"sha256:" + "d".repeat(64)}`
    },
    lifecycleOwners: [],
    hooks: ["pre-specify"],
    durableOutputs: ["context", "adr"],
    after: [],
    ...overrides
  });
}

export function lock(overrides = {}) {
  const value = {
    schemaVersion: 1,
    generation: 1,
    skills: [skill(), grillSkill()],
    ...overrides
  };
  const lockDigest = skillLockDigest(value);
  return { ...value, lockDigest, signature: `lock:${lockDigest}` };
}

export function verifier() {
  return {
    verifyLock: async (value) => value.signature === `lock:${value.lockDigest}`,
    verifySource: async (value) => value.source.signature === `source:${value.source.treeDigest}`
  };
}

export function profile(overrides = {}) {
  return {
    mode: "standard",
    enabledSkillIds: ["tlc-spec-driven", "grill-with-docs"],
    grillEnabled: true,
    ...overrides
  };
}
