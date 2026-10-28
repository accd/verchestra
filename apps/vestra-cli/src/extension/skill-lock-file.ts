import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  GovernedSkillRegistry,
  SkillRegistryError,
  skillLockDigest,
  type SkillLock,
  type SkillUpdatePlan
} from "@verchestra/agent-runtime";
import { canonicalizeJsonV2 } from "@verchestra/domain";
import type { EvidenceSigner, JsonValue, TrustRoot } from "@verchestra/evidence";

import { openRecord, recordContentDigest, sealRecord } from "./extension-seal.ts";

// invariant: the licenses a registered worker may carry (owner decision,
// 2026-10-28). `vestra extension add` refuses any other as an argument, and
// the registry refuses any other in a lock.
export const EXTENSION_LICENSES: readonly string[] = Object.freeze([
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT"
]);
// why: the registry reads `x.y.z` only, and this build is `0.0.0-qualification`;
// its core is the harness version a worker requires and the registry holds.
export const EXTENSION_HARNESS_VERSION = "0.0.0";
const SCHEMA_VERSION = 1;
const TLC_MINIMUM_VERSION = "3.2.0";
const MAXIMUM_LOCK_BYTES = 4 * 1024 * 1024;
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".cjs": "text/javascript",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript"
});

type LockedSkill = SkillLock["skills"][number];

export interface WorkerSkillInput {
  readonly skillId: string;
  readonly version: string;
  readonly license: string;
  readonly repository: string;
  readonly commit: string;
  readonly entry: { readonly path: string; readonly digest: string };
  readonly extensionId: string;
  readonly approvalRef: string;
}

// why: what `add` records as the update's evidence. It is a registration, not
// a qualification: nothing qualifies a worker here, and the human approval of
// its launch stays the gate (owner decision, 2026-10-28).
export interface WorkerRegistration {
  readonly skillId: string;
  readonly extensionId: string;
  readonly entryDigest: string;
  readonly registeredAt: string;
}

// invariant: door 1. `bootstrap` is `init`'s placeholder, or no file at all,
// which the first `add` replaces with generation 1; `lock` is anything else,
// left for the registry to judge. `digest` names what an update replaces.
export type LockOnDisk =
  | { readonly kind: "bootstrap"; readonly digest: string }
  | { readonly kind: "lock"; readonly lock: SkillLock; readonly digest: string };

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function registrationDigest(registration: WorkerRegistration): string {
  return sha256(canonicalizeJsonV2(registration));
}

function lockInvalid(message: string): SkillRegistryError {
  return new SkillRegistryError("VES_SKILL_LOCK_INVALID", message);
}

function isPlaceholder(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Readonly<Record<string, unknown>>;
  return (
    Object.keys(row).length === 2 &&
    row["schemaVersion"] === SCHEMA_VERSION &&
    Array.isArray(row["skills"]) &&
    row["skills"].length === 0
  );
}

function absent(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "ENOENT";
}

function lockText(lock: SkillLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

// invariant: door 1. `.verchestra/skills.lock.json` is the Workspace's skill
// lock, read and replaced only as a regular file in a real directory; a link
// in either place is refused, never followed.
export class SkillLockFile {
  readonly #directory: string;
  readonly #path: string;

  constructor(controlRoot: string) {
    this.#directory = join(controlRoot, ".verchestra");
    this.#path = join(this.#directory, "skills.lock.json");
  }

  async #bytes(): Promise<Buffer | undefined> {
    const directory = await lstat(this.#directory).catch(() => undefined);
    if (!directory?.isDirectory()) throw lockInvalid("The .verchestra directory is not real");
    let metadata;
    try {
      metadata = await lstat(this.#path);
    } catch (error) {
      if (absent(error)) return undefined;
      throw lockInvalid("The skill lock is unreadable");
    }
    if (!metadata.isFile() || metadata.size > MAXIMUM_LOCK_BYTES)
      throw lockInvalid("The skill lock is not a bounded regular file");
    return readFile(this.#path);
  }

  async read(): Promise<LockOnDisk> {
    const bytes = await this.#bytes();
    if (bytes === undefined) return Object.freeze({ kind: "bootstrap", digest: sha256("") });
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw lockInvalid("The skill lock is not JSON");
    }
    if (isPlaceholder(value)) return Object.freeze({ kind: "bootstrap", digest: sha256(bytes) });
    const lock = value as SkillLock;
    return Object.freeze({ kind: "lock", lock, digest: String(lock?.lockDigest) });
  }

  // invariant: the registry stages the candidate, then commits it; commit
  // refuses when the lock on disk is no longer the one the plan replaces,
  // keeps generation N as `skills.lock.<N>.json`, and renames the staged file
  // into place, so the lock is replaced whole or not at all.
  transaction() {
    let staged: string | undefined;
    return {
      stage: async (candidate: SkillLock): Promise<void> => {
        staged = join(this.#directory, `.skills.lock.${randomUUID()}.tmp`);
        await writeFile(staged, lockText(candidate), { flag: "wx", flush: true });
      },
      commit: async (plan: SkillUpdatePlan): Promise<void> => {
        if (staged === undefined) throw lockInvalid("No candidate lock is staged");
        const current = await this.read();
        if (current.digest !== plan.currentLockDigest) throw lockInvalid("The skill lock changed during the update");
        if (current.kind === "lock") await this.#keep(current.lock.generation);
        await rename(staged, this.#path);
        staged = undefined;
      },
      rollback: async (): Promise<void> => {
        if (staged !== undefined) await rm(staged, { force: true });
        staged = undefined;
      }
    };
  }

  async #keep(generation: number): Promise<void> {
    const bytes = await this.#bytes();
    if (bytes === undefined || !Number.isSafeInteger(generation)) throw lockInvalid("The current lock cannot be kept");
    const kept = join(this.#directory, `skills.lock.${generation}.json`);
    const existing = await lstat(kept).catch(() => undefined);
    if (existing !== undefined && !existing.isFile()) throw lockInvalid("A kept generation is not a regular file");
    await writeFile(kept, bytes, { flush: true });
  }
}

function lockBody(lock: SkillLock): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(lock as unknown as Readonly<Record<string, unknown>>).filter(
      ([key]) => key !== "lockDigest" && key !== "signature"
    )
  );
}

function sourceBody(skill: LockedSkill): Readonly<Record<string, unknown>> {
  const source = Object.fromEntries(Object.entries(skill.source).filter(([key]) => key !== "signature"));
  return { source, contents: skill.contents };
}

const lockBinding = (lock: SkillLock) => ({
  bindingId: `skill-lock:${lock.generation}`,
  sourceStateDigest: lock.lockDigest
});
const sourceBinding = (skill: LockedSkill) => ({
  bindingId: `skill-source:${skill.id}`,
  sourceStateDigest: skill.source.treeDigest
});

// invariant: door 2. The production lock verifier: a signature verifies only
// against the Workspace's pinned anchor, and only over exactly the content it
// claims, so it needs no passphrase and accepts no other key.
export function workspaceLockVerifier(trust: TrustRoot | undefined) {
  return {
    verifyLock: async (lock: SkillLock): Promise<boolean> => {
      const artifact = await openRecord(trust, "skill-lock", lock.signature, () => lockBinding(lock));
      return artifact?.payloadDigest === recordContentDigest(lockBody(lock));
    },
    verifySource: async (skill: LockedSkill): Promise<boolean> => {
      const artifact = await openRecord(trust, "skill-lock", skill.source.signature, () => sourceBinding(skill));
      return artifact?.payloadDigest === recordContentDigest(sourceBody(skill));
    }
  };
}

export function extensionRegistry(
  verifier: ReturnType<typeof workspaceLockVerifier>,
  transaction?: ReturnType<SkillLockFile["transaction"]>
): GovernedSkillRegistry {
  return new GovernedSkillRegistry({
    verifier,
    harnessVersion: EXTENSION_HARNESS_VERSION,
    schemaVersion: SCHEMA_VERSION,
    tlcMinimumVersion: TLC_MINIMUM_VERSION,
    allowedLicenses: EXTENSION_LICENSES,
    ...(transaction === undefined ? {} : { transaction })
  });
}

// invariant: the smallest locked skill the registry accepts for one
// executable entry (plan assumption): the entry is its only content, declared
// executable, and the skill names an approved plugin by its approval
// reference.
export async function sealWorkerSkill(signer: EvidenceSigner, input: WorkerSkillInput): Promise<LockedSkill> {
  const source = { repository: input.repository, commit: input.commit, treeDigest: input.entry.digest };
  const contents = [
    {
      path: input.entry.path,
      digest: input.entry.digest,
      declaredClass: "executable" as const,
      mediaType: MEDIA_TYPES[extname(input.entry.path).toLowerCase()] ?? "application/octet-stream"
    }
  ];
  const signature = await sealRecord(signer, "skill-lock", { source, contents } as JsonValue, {
    bindingId: `skill-source:${input.skillId}`,
    sourceStateDigest: input.entry.digest
  });
  return Object.freeze({
    id: input.skillId,
    version: input.version,
    minimumHarnessVersion: EXTENSION_HARNESS_VERSION,
    license: input.license,
    schemaCompatibility: { minimum: SCHEMA_VERSION, maximum: SCHEMA_VERSION },
    source: { ...source, signature },
    contents,
    lifecycleOwners: [],
    hooks: [],
    after: [],
    extensionRef: { kind: "plugin" as const, id: input.extensionId, approvalRef: input.approvalRef }
  });
}

export async function sealSkillLock(
  signer: EvidenceSigner,
  input: { readonly generation: number; readonly skills: readonly LockedSkill[] }
): Promise<SkillLock> {
  const body = { schemaVersion: SCHEMA_VERSION, generation: input.generation, skills: input.skills };
  const lockDigest = skillLockDigest(body);
  const signature = await sealRecord(signer, "skill-lock", body as unknown as JsonValue, {
    bindingId: `skill-lock:${input.generation}`,
    sourceStateDigest: lockDigest
  });
  return Object.freeze({ ...body, lockDigest, signature });
}

// why: the placeholder is no lock, so `planUpdate` cannot take it as the
// current one; generation 1 is activated through a plan that names the
// placeholder's bytes instead, with the generation rule planUpdate applies.
function bootstrapPlan(
  current: LockOnDisk,
  candidate: SkillLock,
  evidenceDigest: string,
  diff: readonly { readonly path: string; readonly change: string }[]
): SkillUpdatePlan {
  if (candidate.generation !== 1)
    throw new SkillRegistryError("VES_SKILL_UPDATE_GENERATION", "Skill update generation is not contiguous");
  const body = {
    currentLockDigest: current.digest,
    candidateLockDigest: candidate.lockDigest,
    candidateGeneration: candidate.generation,
    qualificationEvidenceDigest: evidenceDigest,
    diff
  };
  return Object.freeze({ ...body, planId: sha256(canonicalizeJsonV2(body)) });
}

export async function activateLock(input: {
  readonly registry: GovernedSkillRegistry;
  readonly current: LockOnDisk;
  readonly candidate: SkillLock;
  readonly registration: WorkerRegistration;
  readonly entryPath: string;
}): Promise<{ readonly lockDigest: string; readonly generation: number }> {
  const evidenceDigest = registrationDigest(input.registration);
  const diff = [{ path: input.entryPath, change: "added" }];
  const plan =
    input.current.kind === "lock"
      ? await input.registry.planUpdate({
          current: input.current.lock,
          candidate: input.candidate,
          qualification: { passed: true, evidenceDigest },
          diff
        })
      : bootstrapPlan(input.current, input.candidate, evidenceDigest, diff);
  const activated = await input.registry.activate(plan, input.candidate);
  return { lockDigest: activated.lockDigest, generation: activated.generation };
}
