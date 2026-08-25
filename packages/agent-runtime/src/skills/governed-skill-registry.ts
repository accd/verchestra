import { createHash } from "node:crypto";

import { canonicalizeJsonV2, dropUndefinedMembers } from "@verchestra/domain";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const SAFE = /^[a-z0-9][a-z0-9._:@/+\-]{0,255}$/u;
const PHASES = ["specify", "design", "tasks", "execute", "verify"] as const;
type LifecyclePhase = (typeof PHASES)[number];

export class SkillRegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SkillRegistryError";
    this.code = code;
  }
}

interface SkillContent {
  readonly path: string;
  readonly digest: string;
  readonly declaredClass: "documentation" | "executable";
  readonly mediaType: string;
  readonly text?: string;
  readonly executable?: boolean;
}

interface LockedSkill {
  readonly id: string;
  readonly version: string;
  readonly minimumHarnessVersion: string;
  readonly license: string;
  readonly schemaCompatibility: { readonly minimum: number; readonly maximum: number };
  readonly source: {
    readonly repository: string;
    readonly commit: string;
    readonly treeDigest: string;
    readonly signature: string;
  };
  readonly contents: readonly SkillContent[];
  readonly lifecycleOwners: readonly string[];
  readonly hooks: readonly string[];
  readonly durableOutputs?: readonly string[];
  readonly after: readonly string[];
  readonly extensionRef?: { readonly kind: "tool" | "plugin"; readonly id: string; readonly approvalRef: string };
}

export interface SkillLock {
  readonly schemaVersion: number;
  readonly generation: number;
  readonly skills: readonly LockedSkill[];
  readonly lockDigest: string;
  readonly signature: string;
}

interface SkillProfile {
  readonly mode: "standard" | "replacement";
  readonly enabledSkillIds: readonly string[];
  readonly grillEnabled: boolean;
  readonly replacementApprovalRef?: string;
}

interface RegistryOptions {
  readonly verifier: {
    verifyLock(lock: SkillLock): Promise<boolean>;
    verifySource(skill: LockedSkill): Promise<boolean>;
  };
  readonly harnessVersion: string;
  readonly schemaVersion: number;
  readonly tlcMinimumVersion: string;
  readonly allowedLicenses: readonly string[];
  readonly transaction?: {
    stage(candidate: SkillLock): Promise<void>;
    commit(plan: SkillUpdatePlan): Promise<void>;
    rollback(): Promise<void>;
  };
}

interface UpdateRequest {
  readonly current: SkillLock;
  readonly candidate: SkillLock;
  readonly qualification: { readonly passed: boolean; readonly evidenceDigest: string };
  readonly diff: readonly { readonly path: string; readonly change: string }[];
}

export interface SkillUpdatePlan {
  readonly planId: string;
  readonly currentLockDigest: string;
  readonly candidateLockDigest: string;
  readonly candidateGeneration: number;
  readonly qualificationEvidenceDigest: string;
  readonly diff: readonly { readonly path: string; readonly change: string }[];
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJsonV2(dropUndefinedMembers(value)))
    .digest("hex")}`;
}

export function skillLockDigest(
  value: Omit<SkillLock, "lockDigest" | "signature"> | Readonly<Record<string, unknown>>
): string {
  const body = Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>).filter(
      ([key]) => key !== "lockDigest" && key !== "signature"
    )
  );
  return digest(body);
}

function version(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, minimum: string): boolean {
  const left = version(actual);
  const right = version(minimum);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return (left[index] as number) > (right[index] as number);
  }
  return true;
}

function actualExecutable(content: SkillContent): boolean {
  const path = content.path.toLowerCase();
  if (content.executable === true) return true;
  if (/\.(?:js|cjs|mjs|ts|tsx|py|rb|sh|bash|zsh|fish|ps1|bat|cmd|exe|dll|so|dylib|wasm)$/u.test(path)) return true;
  if (
    /^(?:text\/(?:javascript|x-python|x-shellscript)|application\/(?:javascript|wasm|x-msdownload|x-executable))$/u.test(
      content.mediaType
    )
  )
    return true;
  if (content.text?.startsWith("#!") === true) return true;
  if (path.endsWith("package.json") && /["'](?:scripts|preinstall|postinstall)["']\s*:/u.test(content.text ?? ""))
    return true;
  return false;
}

function assertNoCycle(skills: readonly LockedSkill[]): void {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new SkillRegistryError("VES_SKILL_GRAPH_CYCLE", "Skill ownership graph contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.after ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const skill of skills) visit(skill.id);
}

export class GovernedSkillRegistry {
  readonly #options: RegistryOptions;
  constructor(options: RegistryOptions) {
    this.#options = options;
  }

  async resolve(profile: SkillProfile, lock: SkillLock) {
    const all = await this.#validateLock(lock);
    const byId = new Map(all.map((skill) => [skill.id, skill]));
    const enabled: LockedSkill[] = [];
    for (const id of profile.enabledSkillIds) {
      const skill = byId.get(id);
      if (skill === undefined)
        throw new SkillRegistryError("VES_SKILL_UNKNOWN", "Workflow profile references an unknown Skill");
      enabled.push(skill);
    }
    const tlc = byId.get("tlc-spec-driven");
    if (tlc === undefined || !enabled.includes(tlc))
      throw new SkillRegistryError("VES_SKILL_TLC_REQUIRED", "TLC is required");
    if (PHASES.some((phase) => !tlc.lifecycleOwners.includes(phase)))
      throw new SkillRegistryError("VES_SKILL_TLC_REQUIRED", "TLC must own the complete lifecycle");
    for (const skill of enabled)
      if (
        skill.id !== "tlc-spec-driven" &&
        skill.lifecycleOwners.some((phase) => PHASES.includes(phase as LifecyclePhase))
      )
        throw new SkillRegistryError("VES_SKILL_OWNER_OVERLAP", "Another Skill overlaps TLC lifecycle ownership");
    const grill = byId.get("grill-with-docs");
    if (profile.grillEnabled) {
      if (grill === undefined || !enabled.includes(grill))
        throw new SkillRegistryError("VES_SKILL_UNKNOWN", "Enabled Grill Skill is missing");
      if (
        grill.hooks.length !== 1 ||
        grill.hooks[0] !== "pre-specify" ||
        [...(grill.durableOutputs ?? [])].sort().join(",") !== "adr,context"
      )
        throw new SkillRegistryError("VES_SKILL_GRILL_OUTPUT_INVALID", "Grill outputs or placement are invalid");
    }
    assertNoCycle(enabled);
    const resolved = enabled.map((skill) =>
      Object.freeze({
        id: skill.id,
        version: skill.version,
        executionAuthority: false,
        executableContent: skill.contents.some(actualExecutable),
        durableOutputs: Object.freeze([...(skill.durableOutputs ?? [])].sort())
      })
    );
    const route = [
      ...(profile.grillEnabled ? [{ skillId: "grill-with-docs", phase: "pre-specify" }] : []),
      ...PHASES.map((phase) => ({ skillId: "tlc-spec-driven", phase }))
    ];
    return Object.freeze({
      lockDigest: lock.lockDigest,
      skills: Object.freeze(resolved),
      route: Object.freeze(route.map((entry) => Object.freeze(entry)))
    });
  }

  async planUpdate(request: UpdateRequest): Promise<SkillUpdatePlan> {
    await this.#validateLock(request.current);
    await this.#validateLock(request.candidate);
    if (request.candidate.generation !== request.current.generation + 1)
      throw new SkillRegistryError("VES_SKILL_UPDATE_GENERATION", "Skill update generation is not contiguous");
    if (!request.qualification.passed || !DIGEST.test(request.qualification.evidenceDigest))
      throw new SkillRegistryError("VES_SKILL_QUALIFICATION_FAILED", "Skill update qualification failed");
    if (request.diff.length === 0)
      throw new SkillRegistryError("VES_SKILL_DIFF_REQUIRED", "Skill update requires a visible diff");
    const body = {
      currentLockDigest: request.current.lockDigest,
      candidateLockDigest: request.candidate.lockDigest,
      candidateGeneration: request.candidate.generation,
      qualificationEvidenceDigest: request.qualification.evidenceDigest,
      diff: request.diff.map((entry) => ({ path: entry.path, change: entry.change }))
    };
    const frozenDiff = Object.freeze(body.diff.map((entry) => Object.freeze(entry)));
    return Object.freeze({ ...body, diff: frozenDiff, planId: digest(body) });
  }

  async activate(plan: SkillUpdatePlan, candidate: SkillLock) {
    if (candidate.lockDigest !== plan.candidateLockDigest || candidate.generation !== plan.candidateGeneration)
      throw new SkillRegistryError("VES_SKILL_PLAN_STALE", "Skill update candidate changed after review");
    await this.#validateLock(candidate);
    const transaction = this.#options.transaction;
    if (transaction === undefined)
      throw new SkillRegistryError("VES_SKILL_TRANSACTION_REQUIRED", "Skill activation transaction is unavailable");
    try {
      await transaction.stage(candidate);
      await transaction.commit(plan);
      return Object.freeze({ activated: true, lockDigest: candidate.lockDigest, generation: candidate.generation });
    } catch {
      await transaction.rollback();
      throw new SkillRegistryError("VES_SKILL_ACTIVATION_ROLLED_BACK", "Skill activation failed and was rolled back");
    }
  }

  async #validateLock(lock: SkillLock): Promise<readonly LockedSkill[]> {
    if (
      lock === null ||
      typeof lock !== "object" ||
      !Number.isSafeInteger(lock.generation) ||
      lock.generation < 1 ||
      !Array.isArray(lock.skills)
    )
      throw new SkillRegistryError("VES_SKILL_LOCK_INVALID", "Skill lock is invalid");
    if (lock.schemaVersion !== this.#options.schemaVersion)
      throw new SkillRegistryError("VES_SKILL_SCHEMA_INCOMPATIBLE", "Skill lock schema is incompatible");
    const ids = new Set<string>();
    for (const skill of lock.skills) {
      if (
        !SAFE.test(skill.id) ||
        ids.has(skill.id) ||
        version(skill.version) === undefined ||
        version(skill.minimumHarnessVersion) === undefined
      )
        throw new SkillRegistryError("VES_SKILL_LOCK_INVALID", "Skill lock entry is invalid");
      ids.add(skill.id);
      if (!COMMIT.test(skill.source.commit))
        throw new SkillRegistryError("VES_SKILL_SOURCE_MUTABLE", "Skill source is not immutable");
      if (
        !DIGEST.test(skill.source.treeDigest) ||
        !Array.isArray(skill.contents) ||
        !Array.isArray(skill.lifecycleOwners) ||
        !Array.isArray(skill.hooks) ||
        !Array.isArray(skill.after)
      )
        throw new SkillRegistryError("VES_SKILL_LOCK_INVALID", "Skill lock entry is invalid");
      if (!this.#options.allowedLicenses.includes(skill.license))
        throw new SkillRegistryError("VES_SKILL_LICENSE_DENIED", "Skill license is not approved");
      if (!atLeast(this.#options.harnessVersion, skill.minimumHarnessVersion))
        throw new SkillRegistryError("VES_SKILL_HARNESS_INCOMPATIBLE", "Skill requires a newer harness");
      if (
        skill.schemaCompatibility.minimum > this.#options.schemaVersion ||
        skill.schemaCompatibility.maximum < this.#options.schemaVersion
      )
        throw new SkillRegistryError("VES_SKILL_SCHEMA_INCOMPATIBLE", "Skill schema is incompatible");
      if (skill.id === "tlc-spec-driven" && !atLeast(skill.version, this.#options.tlcMinimumVersion))
        throw new SkillRegistryError("VES_SKILL_TLC_VERSION", "TLC version is below the required minimum");
      for (const content of skill.contents) {
        if (!DIGEST.test(content.digest) || typeof content.path !== "string" || typeof content.mediaType !== "string")
          throw new SkillRegistryError("VES_SKILL_LOCK_INVALID", "Skill content manifest is invalid");
        const executable = actualExecutable(content) || content.declaredClass === "executable";
        if (actualExecutable(content) && content.declaredClass !== "executable")
          throw new SkillRegistryError("VES_SKILL_HIDDEN_EXECUTABLE", "Skill hides executable content");
        if (
          executable &&
          (skill.extensionRef === undefined ||
            !["tool", "plugin"].includes(skill.extensionRef.kind) ||
            skill.extensionRef.approvalRef.length === 0)
        )
          throw new SkillRegistryError(
            "VES_SKILL_EXECUTION_UNAUTHORIZED",
            "Executable Skill content requires an approved Tool or Plugin"
          );
      }
    }
    if (!ids.has("tlc-spec-driven"))
      throw new SkillRegistryError("VES_SKILL_TLC_REQUIRED", "TLC lock entry is required");
    if (skillLockDigest(lock) !== lock.lockDigest)
      throw new SkillRegistryError("VES_SKILL_LOCK_TAMPERED", "Skill lock digest is invalid");
    if (!(await this.#options.verifier.verifyLock(lock)))
      throw new SkillRegistryError("VES_SKILL_SIGNATURE_INVALID", "Skill lock signature is invalid");
    for (const skill of lock.skills)
      if (!(await this.#options.verifier.verifySource(skill)))
        throw new SkillRegistryError("VES_SKILL_SIGNATURE_INVALID", "Skill source signature is invalid");
    return Object.freeze([...lock.skills]);
  }
}
