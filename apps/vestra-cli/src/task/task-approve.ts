import { join } from "node:path";

import { FileExecutionPackageStore } from "@verchestra/evidence";

import { TaskAuthority } from "./task-authority.ts";
import { confirmDigest } from "./task-confirm.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "./task-credentials.ts";
import { stateInvalid, taskError } from "./task-errors.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { HUMAN_ACTOR, loadPlanRecord, type TaskPlanRecord } from "./task-plan-record.ts";
import { loadTaskPolicy } from "./task-policy.ts";
import { workspaceSigner, workspaceTrustRoot } from "./task-signing.ts";
import { applyWorkflow, currentRun } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, parseRunId, runDirectory, type TaskWorkspace } from "./task-workspace.ts";

// invariant: the package the human approves is the one on disk, byte for byte
// the payload the plan bound; a swapped package fails before any approval.
async function assertPackage(workspace: TaskWorkspace, plan: TaskPlanRecord): Promise<void> {
  const store = new FileExecutionPackageStore({ root: join(runDirectory(workspace, plan.runId), "packages") });
  let digest: string;
  try {
    digest = `sha256:${(await store.get(plan.packageId)).payloadDigest}`;
  } catch (error) {
    throw stateInvalid("VES_TASK_PACKAGE_INVALID", "The sealed Execution Package is missing or damaged", {
      cause: error
    });
  }
  if (digest !== plan.packageDigest)
    throw stateInvalid("VES_TASK_PACKAGE_INVALID", "The Execution Package does not match the plan");
}

export async function approveTask(
  io: TaskCommandIo,
  options: { readonly runId: unknown; readonly bindingDigest: unknown; readonly confirmStdin: boolean }
) {
  const runId = parseRunId(options.runId);
  const workspace = await openTaskWorkspace(io);
  const plan = await loadPlanRecord(workspace, runId);
  if (options.bindingDigest !== plan.approvalRequest.bindingDigest)
    throw taskError("VES_TASK_BINDING_MISMATCH", {}, "The binding digest is not the one this run presents");
  const runtime = openRuntime(workspace);
  try {
    const snapshot = currentRun(runtime, runId);
    if (snapshot.state !== "AWAITING_EXECUTION_APPROVAL")
      throw taskError(
        "VES_TASK_TRANSITION_REFUSED",
        { state: snapshot.state, command: "GRANT_EXECUTION_APPROVAL" },
        "Only a run awaiting approval can be approved"
      );
    await assertPackage(workspace, plan);
    const policy = await loadTaskPolicy(io.controlRoot);
    const probe = new TaskAuthority({ runtime, plan, policy, trust: await workspaceTrustRoot(workspace) });
    if (probe.currentBindingDigest() !== plan.approvalRequest.bindingDigest)
      throw taskError("VES_TASK_BINDING_MISMATCH", {}, "The Workspace policy changed since planning; plan again");
    await confirmDigest(io, plan.approvalRequest.bindingDigest, {
      confirmStdin: options.confirmStdin,
      label: "binding"
    });
    const credentials = await readCredentials(
      {
        workspaceId: workspace.workspaceId,
        platform: io.platform,
        ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
      },
      [SIGNING_PASSPHRASE]
    );
    const signer = await workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
    const authority = new TaskAuthority({ runtime, plan, policy, signer, trust: await workspaceTrustRoot(workspace) });
    const record = await authority.record();
    const next = applyWorkflow(runtime, runId, {
      type: "GRANT_EXECUTION_APPROVAL",
      actorRole: "human",
      actorId: HUMAN_ACTOR,
      evidence: ["execution-approval"],
      approvalBindingDigest: record.bindingDigest,
      currentBindingDigest: authority.currentBindingDigest()
    });
    return {
      runId,
      state: next.state,
      approvalId: record.approvalId,
      bindingDigest: record.bindingDigest,
      approvalExpiresAt: record.expiresAt,
      next: `vestra task start --run-id ${runId}`
    };
  } finally {
    runtime.close();
  }
}
