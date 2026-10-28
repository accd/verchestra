import { workspaceSigner, workspaceTrustRoot } from "../task/task-signing.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "../task/task-credentials.ts";
import { git } from "../task/task-git.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { openTaskWorkspace } from "../task/task-workspace.ts";
import { extensionError } from "./extension-errors.ts";
import { lockSkills, resolveEntry } from "./extension-workspace.ts";
import {
  SkillLockFile,
  activateLock,
  extensionRegistry,
  sealSkillLock,
  sealWorkerSkill,
  workspaceLockVerifier,
  type LockOnDisk
} from "./skill-lock-file.ts";

export interface AddOptions {
  readonly skillId: string;
  readonly extensionId: string;
  readonly entry: string;
  readonly approvalRef: string;
  readonly version: string;
  readonly license: string;
}

function originRefused(message: string): never {
  throw extensionError("VES_EXTENSION_NOT_CONFIGURED", { requirement: "git-origin" }, message);
}

// invariant: the lock is tracked Workspace content, so the repository it names
// carries no credential and no machine-local path: userinfo is removed, and an
// origin that is a local path is refused rather than recorded.
export function publicRepository(origin: string): string {
  const trimmed = origin.trim();
  const scp = /^[^@/:\s]+@([^:/\s]+:.+)$/u.exec(trimmed);
  if (scp !== null) return scp[1] as string;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return originRefused("The Git origin is neither a URL nor a host path");
  }
  if (url.protocol === "file:" || url.host.length === 0) originRefused("The Git origin is a local path");
  url.username = "";
  url.password = "";
  return url.toString();
}

async function repositoryIdentity(root: string): Promise<{ readonly repository: string; readonly commit: string }> {
  let origin: string;
  let commit: string;
  try {
    origin = await git(root, ["remote", "get-url", "origin"]);
  } catch (error) {
    throw extensionError("VES_EXTENSION_NOT_CONFIGURED", { requirement: "git-origin" }, "No Git origin", {
      cause: error
    });
  }
  try {
    commit = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  } catch (error) {
    throw extensionError("VES_EXTENSION_NOT_CONFIGURED", { requirement: "git-commit" }, "No commit", { cause: error });
  }
  return { repository: publicRepository(origin), commit };
}

// invariant: one skill id, one extension id, and one approval reference per
// lock; a worker registered again needs new ones (re-registration is a
// follow-up, plan Out of scope).
function refuseRegistered(current: LockOnDisk, options: AddOptions): void {
  const skills = current.kind === "lock" ? lockSkills(current.lock) : [];
  const taken = skills.some((skill) => {
    const reference = skill["extensionRef"] as { readonly id?: unknown; readonly approvalRef?: unknown } | undefined;
    return (
      skill["id"] === options.skillId ||
      reference?.id === options.extensionId ||
      reference?.approvalRef === options.approvalRef
    );
  });
  if (taken) throw extensionError("VES_EXTENSION_ALREADY_REGISTERED", {}, "The worker is already registered");
}

// invariant: AC 1 to AC 3. The entry is proven inside the Workspace and the
// lock is read before any credential, and the next generation is activated
// through the registry: planUpdate from a lock, a bootstrap plan from `init`'s
// placeholder. Nothing is written on any refusal.
export async function addExtension(io: TaskCommandIo, options: AddOptions) {
  const workspace = await openTaskWorkspace(io);
  const root = workspace.repositoryRoot;
  const entry = await resolveEntry(root, options.entry);
  const identity = await repositoryIdentity(root);
  const file = new SkillLockFile(root);
  const current = await file.read();
  refuseRegistered(current, options);
  const credentials = await readCredentials(
    {
      workspaceId: workspace.workspaceId,
      platform: io.platform,
      ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
    },
    [SIGNING_PASSPHRASE]
  );
  const signer = await workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
  const skill = await sealWorkerSkill(signer, {
    skillId: options.skillId,
    version: options.version,
    license: options.license,
    ...identity,
    entry: { path: entry.path, digest: entry.digest },
    extensionId: options.extensionId,
    approvalRef: options.approvalRef
  });
  const existing = current.kind === "lock" ? current.lock.skills : [];
  const generation = current.kind === "lock" ? current.lock.generation + 1 : 1;
  const candidate = await sealSkillLock(signer, { generation, skills: [...existing, skill] });
  const registry = extensionRegistry(workspaceLockVerifier(await workspaceTrustRoot(workspace)), file.transaction());
  const activated = await activateLock({
    registry,
    current,
    candidate,
    registration: {
      skillId: options.skillId,
      extensionId: options.extensionId,
      entryDigest: entry.digest,
      registeredAt: new Date().toISOString()
    },
    entryPath: entry.path
  });
  return {
    lockDigest: activated.lockDigest,
    generation: activated.generation,
    skillId: options.skillId,
    extensionId: options.extensionId,
    approvalRef: options.approvalRef
  };
}
