import { randomUUID } from "node:crypto";

import type { TaskRunWorkflowCommand } from "@verchestra/application";
import { WorkflowMachine, type RunSnapshot, type WorkflowCommand } from "@verchestra/domain";
import type { RuntimeStore } from "@verchestra/platform-node";

import { stableCode, stateInvalid, taskError } from "./task-errors.ts";
import { canonicalDigest } from "./task-files.ts";

export function currentRun(runtime: RuntimeStore, runId: string): RunSnapshot {
  try {
    return runtime.getRun(runId);
  } catch (error) {
    if (stableCode(error) === "VES_RUNTIME_NOT_FOUND")
      throw taskError("VES_TASK_RUN_NOT_FOUND", {}, "The run has no durable workflow record", { cause: error });
    throw error;
  }
}

// invariant: the only writer of a task run's workflow state. Every command is
// decided by the canonical workflow machine and persisted with compare-and-set
// on the version it was decided against, so two processes cannot both advance
// the same run from one state.
export function applyWorkflow(
  runtime: RuntimeStore,
  runId: string,
  command: TaskRunWorkflowCommand & { readonly approvalBindingDigest?: string }
): RunSnapshot {
  const snapshot = currentRun(runtime, runId);
  const full: WorkflowCommand = { ...command, expectedVersion: snapshot.version };
  const decision = WorkflowMachine.decide(snapshot, full);
  if (!decision.accepted)
    throw taskError(
      "VES_TASK_TRANSITION_REFUSED",
      { state: snapshot.state, command: command.type },
      `Workflow refused ${command.type} from ${snapshot.state}: ${decision.code}`
    );
  try {
    runtime.applyTransition(runId, decision, {
      eventId: randomUUID(),
      payloadDigest: canonicalDigest({ type: command.type, evidence: command.evidence }).slice(7),
      actor: { kind: command.actorRole, id: command.actorId },
      occurredAt: new Date().toISOString()
    });
  } catch (error) {
    if (stableCode(error) === "VES_RUNTIME_VERSION_CONFLICT")
      throw taskError("VES_TASK_RUN_ACTIVE", {}, "The run changed while this command was deciding", { cause: error });
    throw stateInvalid(stableCode(error), "The workflow transition could not be persisted", { cause: error });
  }
  return decision.snapshot;
}

// invariant: verification and review accept exactly this projection of a
// run; anything else (the capsule flag, handoff links) is not theirs to see.
export function verificationRun(snapshot: RunSnapshot) {
  return {
    runId: snapshot.runId,
    runKind: snapshot.runKind,
    state: snapshot.state,
    version: snapshot.version,
    repairCycles: snapshot.repairCycles,
    approval: snapshot.approval === undefined ? undefined : { bindingDigest: snapshot.approval.bindingDigest },
    implementationActorId: snapshot.implementationActorId
  };
}
