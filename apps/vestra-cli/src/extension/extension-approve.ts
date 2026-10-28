import type { SkillLock } from "@verchestra/agent-runtime";
import type { TrustRoot } from "@verchestra/evidence";
import { assertProbeWorkerEnvironment, probeLaunchDigest } from "@verchestra/platform-node";

import { confirmDigest } from "../task/task-confirm.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "../task/task-credentials.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { workspaceSigner, workspaceTrustRoot } from "../task/task-signing.ts";
import { openTaskWorkspace } from "../task/task-workspace.ts";
import { extensionError } from "./extension-errors.ts";
import { approvalStore, lockedRequest, refuseUnsupportedPlatform, resolveEntry } from "./extension-workspace.ts";
import { SkillLockFile, extensionRegistry, workspaceLockVerifier } from "./skill-lock-file.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
// why: an approval is standing authority over code that can change, so it
// expires; 30 days unless the owner names an instant (plan assumption).
const DEFAULT_APPROVAL_DAYS = 30;

export interface ApproveOptions {
  readonly approvalRef: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly expiresAt: string | undefined;
  readonly confirmStdin: boolean;
}

async function lockedExtension(
  root: string,
  approvalRef: string,
  lock: SkillLock | undefined,
  trust: TrustRoot | undefined
) {
  const request = lockedRequest(lock, approvalRef);
  if (lock === undefined || request === undefined)
    throw extensionError("VES_EXTENSION_NOT_REGISTERED", {}, "No locked worker carries this approval reference");
  const registry = extensionRegistry(workspaceLockVerifier(trust));
  const extension = await registry.resolveExecutableExtension(lock, request);
  const entry = await resolveEntry(root, extension.entry.path);
  if (entry.digest !== extension.entry.digest)
    throw extensionError("VES_PROBE_HOST_ENTRY_DIGEST", {}, "The entry changed since it was locked");
  return { extension, entry };
}

async function measure(options: ApproveOptions, entry: { readonly absolute: string; readonly digest: string }) {
  try {
    return await probeLaunchDigest({
      executable: options.executable,
      args: options.args,
      environment: options.environment,
      entry: { path: entry.absolute, digest: entry.digest }
    });
  } catch (error) {
    throw extensionError("VES_PROBE_HOST_INPUT_INVALID", {}, "The executable could not be measured", { cause: error });
  }
}

// invariant: AC 4 to AC 7 and AC 13. Windows and any environment the host
// would refuse are refused before the Workspace is read or anything is
// measured; an approval is recorded only after the measured launch digest is
// typed back, and never over one already on record for the reference.
export async function approveExtension(io: TaskCommandIo, options: ApproveOptions) {
  refuseUnsupportedPlatform(io.platform);
  assertProbeWorkerEnvironment(options.environment);
  const workspace = await openTaskWorkspace(io);
  const trust = await workspaceTrustRoot(workspace).catch(() => undefined);
  const current = await new SkillLockFile(workspace.repositoryRoot).read();
  const lock = current.kind === "lock" ? current.lock : undefined;
  const { extension, entry } = await lockedExtension(workspace.repositoryRoot, options.approvalRef, lock, trust);
  const store = approvalStore(workspace);
  if (await store.exists(options.approvalRef))
    throw extensionError("VES_EXTENSION_APPROVAL_EXISTS", {}, "An approval is already on record");
  const launchDigest = await measure(options, entry);
  io.stderr(
    `Approve ${extension.extensionRef.id} (${options.approvalRef}) on this machine:\n` +
      `  component digest: ${entry.digest}\n  launch digest:    ${launchDigest}\n`
  );
  await confirmDigest(io, launchDigest, { confirmStdin: options.confirmStdin, label: "launch" });
  const credentials = await readCredentials(
    {
      workspaceId: workspace.workspaceId,
      platform: io.platform,
      ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
    },
    [SIGNING_PASSPHRASE]
  );
  const signer = await workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
  const approvedAt = new Date();
  const approval = {
    approvalRef: options.approvalRef,
    extensionId: extension.extensionRef.id,
    lockDigest: extension.lockDigest,
    componentDigest: entry.digest,
    launchDigest,
    launch: { executable: options.executable, args: [...options.args], environment: { ...options.environment } },
    approvedAt: approvedAt.toISOString(),
    expiresAt: options.expiresAt ?? new Date(approvedAt.getTime() + DEFAULT_APPROVAL_DAYS * DAY_MS).toISOString()
  };
  await store.record(approval, signer);
  return {
    approvalRef: approval.approvalRef,
    extensionId: approval.extensionId,
    componentDigest: approval.componentDigest,
    launchDigest: approval.launchDigest,
    expiresAt: approval.expiresAt
  };
}
