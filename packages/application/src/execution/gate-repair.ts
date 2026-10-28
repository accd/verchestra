// When a gate fails, gate-commit saves a gate-failed state and the semantics
// end there. This coordinator declares what happens next: a bounded,
// checkpointed repair loop whose policy comes from the Execution Package, so
// the evidence shows the declared path to convergence rather than only the
// destination. Absent policy keeps today's behavior: one attempt, stop at
// gate-failed, no escalation.

import type { BudgetLedger, BudgetMeter } from "./budget-meter.ts";
import type { ExecutionSuspension } from "./task-executor.ts";

type Digest = `sha256:${string}`;

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
// The bounded byte budget for driver feedback (REP-06). Gate output is
// evidence; feedback is a hint, and an unbounded hint is an exfiltration
// channel.
export const FEEDBACK_BYTE_BUDGET = 16_384;

export type GateRepairErrorCode =
  "VES_REPAIR_INPUT_INVALID" | "VES_REPAIR_STATE_INVALID" | "VES_REPAIR_FEEDBACK_INVALID";

export class GateRepairError extends Error {
  readonly code: GateRepairErrorCode;

  constructor(code: GateRepairErrorCode, message: string) {
    super(message);
    this.name = "GateRepairError";
    this.code = code;
  }
}

function fail(code: GateRepairErrorCode, message: string): never {
  throw new GateRepairError(code, message);
}

export interface GateRepairPolicy {
  readonly maxAttempts: number;
  readonly feedbackToDriver: boolean;
  readonly escalateAfter: number;
}

export interface GateFailure {
  readonly failedGateId: string;
  readonly evidenceRef: string;
}

export interface GateAttemptFeedback {
  readonly feedbackRef: string;
  readonly feedbackDigest: Digest;
  readonly bytes: number;
}

export type GateRepairOutcome =
  | { readonly status: "CONVERGED"; readonly attempts: number; readonly attemptCapsuleDigests: readonly Digest[] }
  | {
      // A run that ran out of budget mid-repair did not fail its gate; it never
      // got to finish. Collapsing the two would report a code defect where the
      // truth is an exhausted ceiling.
      readonly status: "BUDGET_EXCEEDED";
      readonly attempts: number;
      readonly stopReason: string;
      readonly failure: GateFailure | undefined;
      readonly attemptCapsuleDigests: readonly Digest[];
    }
  | {
      readonly status: "ESCALATED";
      readonly attempts: number;
      readonly failure: GateFailure;
      readonly attemptCapsuleDigests: readonly Digest[];
    }
  | {
      readonly status: "GATE_FAILED";
      readonly attempts: number;
      readonly failure: GateFailure;
      readonly attemptCapsuleDigests: readonly Digest[];
    }
  | {
      // invariant: an attempt stopped on a provider's usage signal has not
      // ended: it is neither counted nor sealed, and the run resumes it.
      readonly status: "SUSPENDED";
      readonly attempts: number;
      readonly suspension: ExecutionSuspension;
      readonly attemptCapsuleDigests: readonly Digest[];
    };

export interface GateRepairPorts {
  // Runs one full execute-then-gate attempt. Feedback is present only when the
  // declared policy allows it and a previous attempt failed. The meter, when
  // present, must be handed to the executor so this attempt spends from the
  // run's remaining budget instead of a fresh one.
  attempt(input: {
    readonly attempt: number;
    readonly feedback: GateAttemptFeedback | undefined;
    readonly budgetMeter: BudgetMeter | undefined;
  }): Promise<{ readonly passed: boolean; readonly failure?: GateFailure; readonly suspension?: ExecutionSuspension }>;
  // Builds the run's single meter, resuming from persisted consumption. The
  // caller closes over the declared budgets and price table, so this
  // coordinator owns the meter's lifetime without knowing what anything costs.
  budget?: { create(resume: BudgetLedger | undefined): BudgetMeter };
  // Builds bounded, redacted driver feedback from a gate failure. The
  // coordinator enforces the byte budget; redaction happens behind this port
  // through the existing egress boundary.
  buildFeedback(failure: GateFailure): Promise<GateAttemptFeedback>;
  // Seals one attempt capsule and returns its digest; capsules chain through
  // previousAttemptDigest so the whole repair history is one evidence trail.
  sealAttempt(input: {
    readonly attempt: number;
    readonly passed: boolean;
    readonly failure: GateFailure | undefined;
    readonly feedbackWithheld: boolean;
    readonly previousAttemptDigest: Digest | null;
  }): Promise<{ readonly capsuleDigest: Digest }>;
  // Durable repair state, so a crash between attempts resumes with correct
  // counts instead of double-running or blindly retrying.
  loadState(): Promise<unknown>;
  saveState(state: {
    readonly stage: "repair" | "escalated" | "converged" | "gate-failed" | "budget-exceeded";
    readonly attempts: number;
    readonly attemptCapsuleDigests: readonly Digest[];
    // Persisted so a crash between attempts resumes with the spend it already
    // made. Without this, a resumed run silently starts over at zero.
    readonly budgetLedger: BudgetLedger | null;
  }): Promise<void>;
}

export type GateRepairStatePort = Pick<GateRepairPorts, "loadState" | "saveState">;

function normalizePolicy(value: unknown): GateRepairPolicy {
  if (value === undefined) return Object.freeze({ maxAttempts: 1, feedbackToDriver: false, escalateAfter: 1 });
  if (value === null || typeof value !== "object") fail("VES_REPAIR_INPUT_INVALID", "repair policy is invalid");
  const policy = value as Record<string, unknown>;
  const keys = Object.keys(policy);
  if (keys.some((key) => !["maxAttempts", "feedbackToDriver", "escalateAfter"].includes(key)))
    fail("VES_REPAIR_INPUT_INVALID", "repair policy contains unknown fields");
  const maxAttempts = policy["maxAttempts"];
  const escalateAfter = policy["escalateAfter"];
  if (!Number.isSafeInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > 5)
    fail("VES_REPAIR_INPUT_INVALID", "maxAttempts must be an integer within [1, 5]");
  if (typeof policy["feedbackToDriver"] !== "boolean")
    fail("VES_REPAIR_INPUT_INVALID", "feedbackToDriver must be a boolean");
  if (
    !Number.isSafeInteger(escalateAfter) ||
    (escalateAfter as number) < 1 ||
    (escalateAfter as number) > (maxAttempts as number)
  )
    fail("VES_REPAIR_INPUT_INVALID", "escalateAfter must be an integer within [1, maxAttempts]");
  return Object.freeze({
    maxAttempts: maxAttempts as number,
    feedbackToDriver: policy["feedbackToDriver"] as boolean,
    escalateAfter: escalateAfter as number
  });
}

function normalizeState(value: unknown): {
  attempts: number;
  attemptCapsuleDigests: Digest[];
  budgetLedger: BudgetLedger | undefined;
} {
  if (value === undefined || value === null) return { attempts: 0, attemptCapsuleDigests: [], budgetLedger: undefined };
  if (typeof value !== "object") fail("VES_REPAIR_STATE_INVALID", "recovered repair state is invalid");
  const state = value as Record<string, unknown>;
  const attempts = state["attempts"];
  if (!Number.isSafeInteger(attempts) || (attempts as number) < 0 || (attempts as number) > 5)
    fail("VES_REPAIR_STATE_INVALID", "recovered attempt count is invalid");
  const digests = state["attemptCapsuleDigests"];
  if (!Array.isArray(digests) || digests.length !== attempts)
    fail("VES_REPAIR_STATE_INVALID", "recovered capsule chain does not match the attempt count");
  for (const entry of digests)
    if (typeof entry !== "string" || !DIGEST.test(entry))
      fail("VES_REPAIR_STATE_INVALID", "recovered capsule digest is invalid");
  // The ledger is validated by the meter on resume, which is the component that
  // owns what a valid ledger is; here it only has to be absent or an object.
  const ledger = state["budgetLedger"] ?? undefined;
  if (ledger !== undefined && (ledger === null || typeof ledger !== "object"))
    fail("VES_REPAIR_STATE_INVALID", "recovered budget ledger is invalid");
  return {
    attempts: attempts as number,
    attemptCapsuleDigests: [...(digests as Digest[])],
    budgetLedger: ledger as BudgetLedger | undefined
  };
}

function assertFeedback(feedback: GateAttemptFeedback): void {
  if (
    !SAFE.test(feedback.feedbackRef) ||
    !DIGEST.test(feedback.feedbackDigest) ||
    !Number.isSafeInteger(feedback.bytes) ||
    feedback.bytes < 0 ||
    feedback.bytes > FEEDBACK_BYTE_BUDGET
  )
    fail("VES_REPAIR_FEEDBACK_INVALID", "driver feedback is unbounded or malformed");
}

type RepairState = ReturnType<typeof normalizeState>;
type RepairStage = Parameters<GateRepairPorts["saveState"]>[0]["stage"];
type AttemptResult = Awaited<ReturnType<GateRepairPorts["attempt"]>>;

interface RepairRun {
  readonly ports: GateRepairPorts;
  readonly state: RepairState;
  readonly meter: BudgetMeter | undefined;
}

function saveStage(run: RepairRun, stage: RepairStage): Promise<void> {
  return run.ports.saveState({
    stage,
    attempts: run.state.attempts,
    attemptCapsuleDigests: run.state.attemptCapsuleDigests,
    budgetLedger: run.meter?.ledger() ?? null
  });
}

function capsuleChain(state: RepairState): readonly Digest[] {
  return Object.freeze([...state.attemptCapsuleDigests]);
}

function budgetStopReason(meter: BudgetMeter | undefined): string | undefined {
  const decision = meter?.shouldStop();
  if (decision?.stop !== true) return undefined;
  return decision.reason ?? "budget";
}

async function budgetExceeded(
  run: RepairRun,
  reason: string,
  failure: GateFailure | undefined
): Promise<GateRepairOutcome> {
  await saveStage(run, "budget-exceeded");
  return Object.freeze({
    status: "BUDGET_EXCEEDED",
    attempts: run.state.attempts,
    stopReason: reason,
    failure,
    attemptCapsuleDigests: capsuleChain(run.state)
  });
}

// invariant: SSI-60 and SSI-68. A suspended attempt saves the run's spend
// with the repair state as it stands, so the resumed meter continues from
// it and counts no time the run spent suspended.
async function suspended(run: RepairRun, suspension: ExecutionSuspension): Promise<GateRepairOutcome> {
  await saveStage(run, "repair");
  return Object.freeze({
    status: "SUSPENDED",
    attempts: run.state.attempts,
    suspension,
    attemptCapsuleDigests: capsuleChain(run.state)
  });
}

async function converged(run: RepairRun): Promise<GateRepairOutcome> {
  await saveStage(run, "converged");
  return Object.freeze({
    status: "CONVERGED",
    attempts: run.state.attempts,
    attemptCapsuleDigests: capsuleChain(run.state)
  });
}

async function escalated(run: RepairRun, failure: GateFailure): Promise<GateRepairOutcome> {
  await saveStage(run, "escalated");
  return Object.freeze({
    status: "ESCALATED",
    attempts: run.state.attempts,
    failure,
    attemptCapsuleDigests: capsuleChain(run.state)
  });
}

// The terminal stage after the last attempt is written once: a declared
// policy escalates, an absent one ends at gate-failed.
async function exhausted(
  run: RepairRun,
  declared: boolean,
  failure: GateFailure | undefined
): Promise<GateRepairOutcome> {
  if (failure === undefined) fail("VES_REPAIR_STATE_INVALID", "repair loop ended without a recorded failure");
  await saveStage(run, declared ? "escalated" : "gate-failed");
  return Object.freeze({
    status: declared ? "ESCALATED" : "GATE_FAILED",
    attempts: run.state.attempts,
    failure,
    attemptCapsuleDigests: capsuleChain(run.state)
  });
}

async function attemptFeedback(
  run: RepairRun,
  policy: GateRepairPolicy,
  lastFailure: GateFailure | undefined,
  current: GateAttemptFeedback | undefined
): Promise<{ readonly feedback: GateAttemptFeedback | undefined; readonly feedbackWithheld: boolean }> {
  if (lastFailure === undefined && run.state.attempts <= 0) return { feedback: current, feedbackWithheld: false };
  if (policy.feedbackToDriver && lastFailure !== undefined) {
    const feedback = await run.ports.buildFeedback(lastFailure);
    assertFeedback(feedback);
    return { feedback, feedbackWithheld: false };
  }
  // Withholding is a policy decision the evidence must show, not an
  // omission a reader has to infer (REP-03).
  return { feedback: undefined, feedbackWithheld: lastFailure !== undefined };
}

async function sealAndRecord(
  run: RepairRun,
  attempt: number,
  result: AttemptResult,
  feedbackWithheld: boolean
): Promise<void> {
  const previousAttemptDigest = run.state.attemptCapsuleDigests.at(-1) ?? null;
  const sealed = await run.ports.sealAttempt({
    attempt,
    passed: result.passed,
    failure: result.passed ? undefined : result.failure,
    feedbackWithheld,
    previousAttemptDigest
  });
  if (!DIGEST.test(sealed.capsuleDigest)) fail("VES_REPAIR_STATE_INVALID", "attempt capsule digest is invalid");
  run.state.attempts = attempt;
  run.state.attemptCapsuleDigests.push(sealed.capsuleDigest);
}

async function afterFailedAttempt(
  run: RepairRun,
  policy: GateRepairPolicy,
  declared: boolean,
  failure: GateFailure
): Promise<GateRepairOutcome | undefined> {
  // The budget outcome wins over escalation, for the same reason it wins over
  // the driver's own cancellation report: ESCALATED invites a human to
  // approve more attempts, and there is nothing left to spend on them. A
  // converged attempt is still converged, which is why this sits after the
  // passed branch rather than before it.
  const afterAttempt = budgetStopReason(run.meter);
  if (afterAttempt !== undefined) return budgetExceeded(run, afterAttempt, failure);

  // Escalation wins over further retries: no autonomous attempt past the
  // declared escalation point under any circumstances (REP-04). Exhaustion of
  // a declared policy is handled after the loop and also escalates.
  const { attempts } = run.state;
  if (declared && attempts >= policy.escalateAfter && attempts < policy.maxAttempts) return escalated(run, failure);

  // The repair stage is only durable state between attempts; the terminal
  // stage after the last attempt is written once, after the loop.
  if (attempts < policy.maxAttempts) await saveStage(run, "repair");
  return undefined;
}

function gateFailure(result: AttemptResult): GateFailure {
  if (result.failure === undefined || !SAFE.test(result.failure.failedGateId))
    fail("VES_REPAIR_INPUT_INVALID", "gate failure evidence is missing");
  return result.failure;
}

export async function runGateRepairLoop(
  input: { readonly onGateFailure?: unknown },
  ports: GateRepairPorts
): Promise<GateRepairOutcome> {
  // A declared policy that exhausts its attempts ends in human escalation; an
  // absent policy keeps today's terminal gate-failed. The difference is
  // deliberate: declaring a repair loop is opting into "a human decides what
  // happens when repair does not converge".
  const declared = input.onGateFailure !== undefined;
  const policy = normalizePolicy(input.onGateFailure);
  const state = normalizeState(await ports.loadState());
  // One meter for the whole run, resumed from whatever earlier attempts spent.
  const run: RepairRun = { ports, state, meter: ports.budget?.create(state.budgetLedger) };
  let lastFailure: GateFailure | undefined;
  let feedback: GateAttemptFeedback | undefined;

  while (state.attempts < policy.maxAttempts) {
    // The declared ceiling covers the run, so an exhausted budget ends the loop
    // rather than buying each remaining attempt its own allowance.
    const beforeAttempt = budgetStopReason(run.meter);
    if (beforeAttempt !== undefined) return budgetExceeded(run, beforeAttempt, lastFailure);
    const attempt = state.attempts + 1;
    const prepared = await attemptFeedback(run, policy, lastFailure, feedback);
    feedback = prepared.feedback;

    const result = await ports.attempt({ attempt, feedback, budgetMeter: run.meter });
    if (result.suspension !== undefined) return suspended(run, result.suspension);
    await sealAndRecord(run, attempt, result, prepared.feedbackWithheld);

    if (result.passed) return converged(run);

    lastFailure = gateFailure(result);
    const stop = await afterFailedAttempt(run, policy, declared, lastFailure);
    if (stop !== undefined) return stop;
  }

  return exhausted(run, declared, lastFailure);
}
