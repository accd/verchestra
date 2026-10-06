// why: the governed task run (#405) drives one approved Execution Package from
// EXECUTION_AUTHORIZED to HUMAN_REVIEW. Every step already has an owner - the
// executor, the gate/commit coordinator, the repair loop, independent
// verification - so this coordinator only sequences them against the workflow
// machine and classifies how a run ends.
// invariant: it never merges and never completes a run; COMPLETED is reachable
// only through a human review.

import type { RunSnapshot, RunState, WorkflowActorRole, WorkflowCommandType } from "@verchestra/domain";

import type { BudgetMeter } from "./budget-meter.ts";
import {
  runGateRepairLoop,
  type GateAttemptFeedback,
  type GateFailure,
  type GateRepairOutcome,
  type GateRepairPorts
} from "./gate-repair.ts";
import type { ExecutionSuspension } from "./task-executor.ts";

type Digest = `sha256:${string}`;

export type TaskRunErrorCode = "VES_TASK_RUN_STATE_INVALID" | "VES_TASK_RUN_WORKFLOW_REJECTED";

export class TaskRunError extends Error {
  readonly code: TaskRunErrorCode;

  constructor(code: TaskRunErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskRunError";
    this.code = code;
  }
}

export interface TaskRunExecution {
  readonly worktreeRef: string;
  readonly baseCommit: string;
  readonly coordinationRef: string;
  readonly changeDigest: Digest;
  readonly changedPaths: readonly string[];
  readonly checkpointRef: string;
}

export interface TaskRunCommit {
  readonly commitId: string;
  readonly baseCommit: string;
  readonly gateEvidenceDigest: Digest;
  readonly gateEvidenceRefs: readonly string[];
}

export interface TaskRunWorkflowCommand {
  readonly type: WorkflowCommandType;
  readonly actorRole: WorkflowActorRole;
  readonly actorId: string;
  readonly evidence: readonly string[];
  readonly currentBindingDigest?: string;
}

export interface TaskRunVerification {
  readonly verdict: "PASS" | "FAIL";
  readonly nextState: string;
  readonly reportRef: string;
}

export interface TaskRunPorts {
  readonly workflow: {
    current(): Promise<RunSnapshot>;
    // invariant: decides with the workflow machine and persists the accepted
    // transition; a rejected command throws.
    apply(command: TaskRunWorkflowCommand): Promise<RunSnapshot>;
  };
  readonly execution: {
    // why: the executor's awaiting-gate result, when it still describes the
    // live worktree and no gate has failed on it, lets a resumed run skip the
    // implementer instead of repeating its effects.
    resumable(): Promise<TaskRunExecution | undefined>;
    execute(options: {
      readonly signal: AbortSignal;
      readonly budgetMeter: BudgetMeter | undefined;
      readonly feedback: GateAttemptFeedback | undefined;
    }): Promise<TaskRunExecution>;
  };
  readonly gates: {
    committed(): Promise<TaskRunCommit | undefined>;
    commit(
      execution: TaskRunExecution
    ): Promise<
      | { readonly passed: true; readonly commit: TaskRunCommit }
      | { readonly passed: false; readonly failure: GateFailure }
    >;
  };
  readonly repair: Omit<GateRepairPorts, "attempt">;
  readonly verification: {
    verify(commit: TaskRunCommit, run: RunSnapshot, signal: AbortSignal): Promise<TaskRunVerification>;
  };
  // invariant: idempotent; removes an uncommitted worktree and releases writer
  // coordination once a run has ended without a task commit.
  readonly release: () => Promise<void>;
}

export interface TaskRunInput {
  readonly bindingDigest: string;
  readonly implementerActorId: string;
  readonly cancelActorId: string;
  readonly onGateFailure?: unknown;
  readonly signal: AbortSignal;
}

export type TaskRunOutcome =
  | { readonly status: "HUMAN_REVIEW"; readonly commit: TaskRunCommit; readonly reportRef: string }
  | { readonly status: "VERIFICATION_FAILED"; readonly state: string; readonly reportRef: string }
  | { readonly status: "ESCALATED"; readonly failure: GateFailure }
  | { readonly status: "FAILED"; readonly reason: string }
  | { readonly status: "ABORTED"; readonly reason: string }
  | { readonly status: "APPROVAL_INVALIDATED" }
  // invariant: SSI-60 and SSI-64. A suspended run applied no workflow command:
  // it stays IMPLEMENTING, its worktree kept, or VERIFYING with its task commit
  // when the verifier's provider raised the signal, until `vestra task resume`
  // or `vestra task cancel`.
  | { readonly status: "SUSPENDED"; readonly suspension: ExecutionSuspension };

const BUDGET_FAILURE = "VES_EXECUTOR_BUDGET_EXCEEDED";
const CANCELLED = "VES_EXECUTOR_CANCELLED";
const SUSPENDED = "VES_EXECUTOR_SUSPENDED";
const STABLE_REASON = /^VES_[A-Z0-9_]{1,96}$/u;

function errorCode(error: unknown): string {
  const code = (error as { readonly code?: unknown } | undefined)?.code;
  return typeof code === "string" && /^VES_[A-Z0-9_]{1,96}$/u.test(code) ? code : "VES_TASK_RUN_FAILED";
}

// why: the public code stays `VES_TASK_FAILED` and the catalog is not extended
// (AD-083), so the cause can only ride in the `reason` an executor or node error
// carries, or in the `reason` safe detail of that envelope. hazard: only a
// stable code may be recorded, never text a provider or a path put there.
function failureReason(error: unknown, code: string): string {
  const carried = (error as { readonly reason?: unknown } | undefined)?.reason;
  if (typeof carried === "string" && STABLE_REASON.test(carried)) return carried;
  if (code !== "VES_TASK_FAILED") return code;
  const detail = (error as { readonly envelope?: { readonly safeDetails?: { readonly reason?: unknown } } } | undefined)
    ?.envelope?.safeDetails?.reason;
  return typeof detail === "string" && STABLE_REASON.test(detail) ? detail : code;
}

// why: the executor validated the record it suspended with; an error that
// names the code without a record is a defect, not a suspension.
function suspensionOf(error: unknown): ExecutionSuspension | undefined {
  if (errorCode(error) !== SUSPENDED) return undefined;
  const suspension = (error as { readonly suspension?: unknown }).suspension;
  return suspension !== null && typeof suspension === "object" ? (suspension as ExecutionSuspension) : undefined;
}

// invariant: a run is started or resumed only from a state this coordinator
// can continue from.
const STARTABLE: ReadonlySet<RunState> = new Set<RunState>(["EXECUTION_AUTHORIZED", "IMPLEMENTING", "VERIFYING"]);

export class TaskRunCoordinator {
  readonly #ports: TaskRunPorts;

  constructor(ports: TaskRunPorts) {
    this.#ports = ports;
  }

  async run(input: TaskRunInput): Promise<TaskRunOutcome> {
    let snapshot = await this.#ports.workflow.current();
    if (!STARTABLE.has(snapshot.state))
      throw new TaskRunError("VES_TASK_RUN_STATE_INVALID", `a run in ${snapshot.state} cannot be started or resumed`);
    try {
      if (snapshot.state === "EXECUTION_AUTHORIZED") {
        snapshot = await this.#startImplementation(input);
        if (snapshot.state !== "IMPLEMENTING") return Object.freeze({ status: "APPROVAL_INVALIDATED" });
      }
      if (snapshot.state === "IMPLEMENTING") {
        const implemented = await this.#implement(input);
        if (implemented.status !== "COMMITTED") return implemented.outcome;
        snapshot = await this.#ports.workflow.apply({
          type: "START_VERIFICATION",
          actorRole: "implementer",
          actorId: input.implementerActorId,
          evidence: ["task-gate-evidence"]
        });
      }
      return await this.#verify(input, snapshot);
    } catch (error) {
      return await this.#terminal(input, error);
    }
  }

  async #startImplementation(input: TaskRunInput): Promise<RunSnapshot> {
    return this.#ports.workflow.apply({
      type: "START_IMPLEMENTATION",
      actorRole: "implementer",
      actorId: input.implementerActorId,
      evidence: ["writer-lease"],
      currentBindingDigest: input.bindingDigest
    });
  }

  async #implement(
    input: TaskRunInput
  ): Promise<{ readonly status: "COMMITTED" } | { readonly status: "STOPPED"; readonly outcome: TaskRunOutcome }> {
    if ((await this.#ports.gates.committed()) !== undefined) return { status: "COMMITTED" };
    // invariant: an escalated repair loop belongs to a human; resuming it
    // must not buy the attempts the declared escalation point withheld.
    const prior = (await this.#ports.repair.loadState()) as { readonly stage?: unknown } | undefined;
    if (prior?.stage === "escalated")
      return {
        status: "STOPPED",
        outcome: Object.freeze({
          status: "ESCALATED" as const,
          failure: { failedGateId: "repair-escalated", evidenceRef: "repair:escalated" }
        })
      };
    const outcome = await runGateRepairLoop(
      { onGateFailure: input.onGateFailure },
      { ...this.#ports.repair, attempt: (attempt) => this.#attempt(input, attempt) }
    );
    if (outcome.status === "CONVERGED") return { status: "COMMITTED" };
    if (outcome.status === "SUSPENDED")
      return { status: "STOPPED", outcome: Object.freeze({ status: "SUSPENDED", suspension: outcome.suspension }) };
    return { status: "STOPPED", outcome: await this.#stopped(input, outcome) };
  }

  async #attempt(
    input: TaskRunInput,
    attempt: { readonly feedback: GateAttemptFeedback | undefined; readonly budgetMeter: BudgetMeter | undefined }
  ): Promise<{ readonly passed: boolean; readonly failure?: GateFailure; readonly suspension?: ExecutionSuspension }> {
    let execution: TaskRunExecution;
    try {
      execution =
        (await this.#ports.execution.resumable()) ??
        (await this.#ports.execution.execute({
          signal: input.signal,
          budgetMeter: attempt.budgetMeter,
          feedback: attempt.feedback
        }));
    } catch (error) {
      const suspension = suspensionOf(error);
      if (suspension !== undefined) return { passed: false, suspension };
      // invariant: an exhausted ceiling is a budget outcome the repair loop
      // reports as BUDGET_EXCEEDED, never a gate failure a human could retry.
      if (errorCode(error) !== BUDGET_FAILURE) throw error;
      return { passed: false, failure: { failedGateId: "budget-exceeded", evidenceRef: "budget:exceeded" } };
    }
    if (input.signal.aborted) throw Object.assign(new Error("Task run was cancelled"), { code: CANCELLED });
    const result = await this.#ports.gates.commit(execution);
    return result.passed ? { passed: true } : { passed: false, failure: result.failure };
  }

  async #stopped(input: TaskRunInput, outcome: Exclude<GateRepairOutcome, { status: "CONVERGED" | "SUSPENDED" }>) {
    if (outcome.status === "ESCALATED")
      return Object.freeze({ status: "ESCALATED" as const, failure: outcome.failure });
    const reason = outcome.status === "BUDGET_EXCEEDED" ? BUDGET_FAILURE : "VES_TASK_GATE_FAILED";
    return this.#fail(reason);
  }

  async #verify(input: TaskRunInput, snapshot: RunSnapshot): Promise<TaskRunOutcome> {
    const commit = await this.#ports.gates.committed();
    if (commit === undefined)
      throw new TaskRunError("VES_TASK_RUN_STATE_INVALID", "a verifying run has no recorded task commit");
    let verification: TaskRunVerification;
    try {
      verification = await this.#ports.verification.verify(commit, snapshot, input.signal);
    } catch (error) {
      // invariant: D3b and SSI-60 for the verifier. A usage limit or credits
      // its provider reported suspend the run as a node's do: no workflow
      // command, the run stays VERIFYING with its task commit, and the writer
      // coordination is released, so `vestra task resume` verifies again.
      const suspension = suspensionOf(error);
      if (suspension === undefined || input.signal.aborted) throw error;
      await this.#ports.release();
      return Object.freeze({ status: "SUSPENDED", suspension });
    }
    if (verification.verdict === "PASS" && verification.nextState === "HUMAN_REVIEW")
      return Object.freeze({ status: "HUMAN_REVIEW", commit, reportRef: verification.reportRef });
    return Object.freeze({
      status: "VERIFICATION_FAILED",
      state: verification.nextState,
      reportRef: verification.reportRef
    });
  }

  async #terminal(input: TaskRunInput, error: unknown): Promise<TaskRunOutcome> {
    const code = errorCode(error);
    if (error instanceof TaskRunError) throw error;
    if (input.signal.aborted || code === CANCELLED) {
      await this.#ports.release();
      await this.#ports.workflow.apply({
        type: "ABORT",
        actorRole: "human",
        actorId: input.cancelActorId,
        evidence: ["cancel-request"]
      });
      return Object.freeze({ status: "ABORTED", reason: CANCELLED });
    }
    return this.#fail(failureReason(error, code));
  }

  async #fail(reason: string): Promise<TaskRunOutcome> {
    await this.#ports.release();
    await this.#ports.workflow.apply({
      type: "FAIL",
      actorRole: "controller",
      actorId: "controller:vestra-task",
      evidence: ["terminal-error-evidence"]
    });
    return Object.freeze({ status: "FAILED", reason });
  }
}
