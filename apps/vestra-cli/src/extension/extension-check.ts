// invariant: door 4 of .specs/features/probe-host-composition/plan.md. This is
// the one CLI module that reaches the out-of-process probe host, and it
// reaches only its admission: no worker, supervisor, or spawned transport is
// importable from here (tests/architecture/extension-host-composition.test.mjs).
import type { CommandResult } from "@verchestra/application";
import type { SkillLock } from "@verchestra/agent-runtime";
import { WorkspaceProbeAdmission, type WorkspaceProbeWorkerExtension } from "@verchestra/extension-host/admission";
import { assertProbeWorkerEnvironment, probeLaunchDigest } from "@verchestra/platform-node";

import type { TaskCommandIo } from "../task/task-io.ts";
import { workspaceTrustRoot } from "../task/task-signing.ts";
import { openTaskWorkspace, requireWorkspaceStateContained } from "../task/task-workspace.ts";
import type { ExtensionApproval } from "./extension-approval-store.ts";
import { approvalStore, lockedRequest, refuseUnsupportedPlatform, resolveEntry } from "./extension-workspace.ts";
import { SkillLockFile, extensionRegistry, workspaceLockVerifier } from "./skill-lock-file.ts";

export type ExtensionCheckId = "lock" | "extension" | "approval" | "admission" | "entry" | "launch";

export interface ExtensionCheckRow {
  readonly id: ExtensionCheckId;
  readonly status: "pass" | "fail" | "not-checked";
  readonly code: string | null;
  readonly recovery: string | null;
}

const GRANT_REQUIRED = "VES_EXECUTION_GRANT_REQUIRED";
const APPROVAL_DENIED = "VES_PROBE_WORKSPACE_TRUST_APPROVAL";
const UNEXPECTED = "VES_EXTENSION_ADMISSION_UNEXPECTED";
const ADMISSION_ROWS: readonly ExtensionCheckId[] = Object.freeze(["lock", "extension", "approval", "admission"]);
// why: the registry's codes for a lock that verified but does not resolve
// this extension; every other registry code is about the lock itself.
const EXTENSION_CODES = new Set([
  "VES_SKILL_UNKNOWN",
  "VES_SKILL_EXECUTION_UNAUTHORIZED",
  "VES_SKILL_EXTENSION_ENTRY_UNKNOWN"
]);
const RECOVERY: Readonly<Record<ExtensionCheckId, string>> = Object.freeze({
  lock: "Restore .verchestra/skills.lock.json from version control or a kept skills.lock.<generation>.json, or register the worker again with `vestra extension add`.",
  extension: "Name an approval reference that a locked worker carries; `vestra extension add` registers one.",
  approval:
    "Approve the worker's launch with `vestra extension approve`; an expired or revoked approval needs a new approval reference.",
  admission: "Admission refused the worker for the named code; correct the locked extension and register it again.",
  entry:
    "The entry changed since it was added; restore it as it was locked, or register the changed worker under a new skill.",
  launch:
    "The executable, its arguments, or its environment no longer measure as approved; approve the launch as it is now under a new approval reference."
});

const pass = (id: ExtensionCheckId): ExtensionCheckRow =>
  Object.freeze({ id, status: "pass", code: null, recovery: null });
const notChecked = (id: ExtensionCheckId): ExtensionCheckRow =>
  Object.freeze({ id, status: "not-checked", code: null, recovery: null });
const fail = (id: ExtensionCheckId, code: string): ExtensionCheckRow =>
  Object.freeze({ id, status: "fail", code, recovery: RECOVERY[id] });

function codeOf(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && /^VES_[A-Z0-9_]{1,96}$/u.test(code) ? code : "VES_EXTENSION_INTERNAL";
}

// why: where admission's order places a code it raised. A registry code for
// the lock comes first; one for the extension follows a verified lock; an
// approval denial follows a resolved extension. Anything else is named on the
// admission row, with nothing before it claimed.
function placeOf(code: string): ExtensionCheckId | undefined {
  if (code === APPROVAL_DENIED) return "approval";
  if (EXTENSION_CODES.has(code)) return "extension";
  if (code.startsWith("VES_SKILL_")) return "lock";
  return undefined;
}

// invariant: AC 12. Admission runs with no grant, so its grant refusal is the
// one outcome meaning every earlier prerequisite passed; an admission that
// succeeds without a grant is a failure, not a pass.
export async function evaluateAdmission(admit: () => Promise<unknown>): Promise<readonly ExtensionCheckRow[]> {
  let code = UNEXPECTED;
  try {
    await admit();
  } catch (error) {
    code = codeOf(error);
  }
  if (code === GRANT_REQUIRED) return ADMISSION_ROWS.map(pass);
  if (code === UNEXPECTED) return [pass("lock"), pass("extension"), pass("approval"), fail("admission", code)];
  const place = placeOf(code);
  if (place === undefined)
    return [notChecked("lock"), notChecked("extension"), notChecked("approval"), fail("admission", code)];
  const failing = ADMISSION_ROWS.indexOf(place);
  return ADMISSION_ROWS.map((id, index) => {
    if (index < failing) return pass(id);
    return index === failing ? fail(id, code) : notChecked(id);
  });
}

async function readLock(file: SkillLockFile): Promise<SkillLock | null> {
  try {
    const onDisk = await file.read();
    return onDisk.kind === "lock" ? onDisk.lock : null;
  } catch {
    // why: an unreadable lock is handed to admission as no lock, so the
    // registry names it, as it names every other lock it refuses.
    return null;
  }
}

// invariant: the entry on disk is still the one the lock pins; the host
// refuses a mismatch with this code before it starts anything.
async function entryRow(repositoryRoot: string, extension: WorkspaceProbeWorkerExtension | undefined) {
  if (extension === undefined) return notChecked("entry");
  try {
    const entry = await resolveEntry(repositoryRoot, extension.entry.path);
    return entry.digest === extension.entry.digest ? pass("entry") : fail("entry", "VES_PROBE_HOST_ENTRY_DIGEST");
  } catch {
    return fail("entry", "VES_PROBE_HOST_INPUT_INVALID");
  }
}

// invariant: the approved launch, measured now over the entry as it is
// locked, is still the launch the human approved; the entry's own change is
// the entry row's, so each row names one cause.
async function launchRow(
  extension: WorkspaceProbeWorkerExtension | undefined,
  approval: ExtensionApproval | undefined
) {
  if (extension === undefined || approval === undefined) return notChecked("launch");
  let measured: string;
  try {
    assertProbeWorkerEnvironment(approval.launch.environment);
    measured = await probeLaunchDigest({ ...approval.launch, entry: extension.entry });
  } catch (error) {
    return fail(
      "launch",
      codeOf(error) === "VES_PROBE_HOST_ENVIRONMENT_DENIED" ? codeOf(error) : "VES_PROBE_HOST_INPUT_INVALID"
    );
  }
  return measured === approval.launchDigest ? pass("launch") : fail("launch", "VES_PROBE_HOST_LAUNCH_DIGEST");
}

function line(row: ExtensionCheckRow): string {
  if (row.status === "not-checked") return `not-checked ${row.id}`;
  return `fail ${row.id}: ${row.code}: ${row.recovery}`;
}

// invariant: AC 10, AC 11, AC 14. Admission runs with the production lock and
// approval ports and no grant, so nothing is admitted and nothing starts; the
// entry and the launch are measured, never executed.
export async function checkExtension(io: TaskCommandIo, approvalRef: string): Promise<CommandResult> {
  refuseUnsupportedPlatform(io.platform);
  const workspace = await openTaskWorkspace(io, { ensure: false });
  await requireWorkspaceStateContained(workspace.layout);
  const trust = await workspaceTrustRoot(workspace).catch(() => undefined);
  const registry = extensionRegistry(workspaceLockVerifier(trust));
  const store = approvalStore(workspace);
  const lock = await readLock(new SkillLockFile(workspace.repositoryRoot));
  let resolved: WorkspaceProbeWorkerExtension | undefined;
  let approval: ExtensionApproval | undefined;
  const admission = new WorkspaceProbeAdmission<SkillLock | null>({
    extensions: {
      resolveExecutableExtension: async (value, request) => {
        resolved = await registry.resolveExecutableExtension(value as SkillLock, request);
        return resolved;
      }
    },
    approvals: {
      lookup: async (reference) => {
        approval = await store.lookup(reference);
        return approval;
      }
    }
  });
  // why: no locked skill carries the reference; admission still runs, so the
  // registry, after verifying the lock, names why it does not resolve.
  const request = lockedRequest(lock, approvalRef) ?? { skillId: "", extensionId: "", entryPath: "" };
  const admitted = await evaluateAdmission(() =>
    admission.admit({ workspaceId: workspace.workspaceId, lock, request })
  );
  const extensionPassed = admitted[1]?.status === "pass" ? resolved : undefined;
  const approvalPassed = admitted[2]?.status === "pass" ? approval : undefined;
  const checks = [
    ...admitted,
    await entryRow(workspace.repositoryRoot, extensionPassed),
    await launchRow(extensionPassed, approvalPassed)
  ];
  const failed = checks.filter((row) => row.status !== "pass");
  return { data: { checks }, diagnostics: failed.map(line), exitCode: failed.length === 0 ? 0 : 4 };
}
