// When a gate fails, gate-commit saves a gate-failed state and the semantics
// end there. This coordinator declares what happens next: a bounded,
// checkpointed repair loop whose policy comes from the Execution Package, so
// the evidence shows the declared path to convergence rather than only the
// destination. Absent policy keeps today's behavior: one attempt, stop at
// gate-failed, no escalation.

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
    };

export interface GateRepairPorts {
  // Runs one full execute-then-gate attempt. Feedback is present only when the
  // declared policy allows it and a previous attempt failed.
  attempt(input: {
    readonly attempt: number;
    readonly feedback: GateAttemptFeedback | undefined;
  }): Promise<{ readonly passed: boolean; readonly failure?: GateFailure }>;
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
    readonly stage: "repair" | "escalated" | "converged" | "gate-failed";
    readonly attempts: number;
    readonly attemptCapsuleDigests: readonly Digest[];
  }): Promise<void>;
}

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

function normalizeState(value: unknown): { attempts: number; attemptCapsuleDigests: Digest[] } {
  if (value === undefined || value === null) return { attempts: 0, attemptCapsuleDigests: [] };
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
  return { attempts: attempts as number, attemptCapsuleDigests: [...(digests as Digest[])] };
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
  let lastFailure: GateFailure | undefined;
  let feedback: GateAttemptFeedback | undefined;

  while (state.attempts < policy.maxAttempts) {
    const attempt = state.attempts + 1;
    let feedbackWithheld = false;
    if (lastFailure !== undefined || state.attempts > 0) {
      if (policy.feedbackToDriver && lastFailure !== undefined) {
        feedback = await ports.buildFeedback(lastFailure);
        if (
          !SAFE.test(feedback.feedbackRef) ||
          !DIGEST.test(feedback.feedbackDigest) ||
          !Number.isSafeInteger(feedback.bytes) ||
          feedback.bytes < 0 ||
          feedback.bytes > FEEDBACK_BYTE_BUDGET
        )
          fail("VES_REPAIR_FEEDBACK_INVALID", "driver feedback is unbounded or malformed");
      } else {
        feedback = undefined;
        // Withholding is a policy decision the evidence must show, not an
        // omission a reader has to infer (REP-03).
        feedbackWithheld = lastFailure !== undefined;
      }
    }

    const result = await ports.attempt({ attempt, feedback });
    const previousAttemptDigest = state.attemptCapsuleDigests.at(-1) ?? null;
    const sealed = await ports.sealAttempt({
      attempt,
      passed: result.passed,
      failure: result.passed ? undefined : result.failure,
      feedbackWithheld,
      previousAttemptDigest
    });
    if (!DIGEST.test(sealed.capsuleDigest)) fail("VES_REPAIR_STATE_INVALID", "attempt capsule digest is invalid");
    state.attempts = attempt;
    state.attemptCapsuleDigests.push(sealed.capsuleDigest);

    if (result.passed) {
      await ports.saveState({
        stage: "converged",
        attempts: state.attempts,
        attemptCapsuleDigests: state.attemptCapsuleDigests
      });
      return Object.freeze({
        status: "CONVERGED",
        attempts: state.attempts,
        attemptCapsuleDigests: Object.freeze([...state.attemptCapsuleDigests])
      });
    }

    if (result.failure === undefined || !SAFE.test(result.failure.failedGateId))
      fail("VES_REPAIR_INPUT_INVALID", "gate failure evidence is missing");
    lastFailure = result.failure;

    // Escalation wins over further retries: no autonomous attempt past the
    // declared escalation point under any circumstances (REP-04). Exhaustion of
    // a declared policy is handled after the loop and also escalates.
    if (declared && state.attempts >= policy.escalateAfter && state.attempts < policy.maxAttempts) {
      await ports.saveState({
        stage: "escalated",
        attempts: state.attempts,
        attemptCapsuleDigests: state.attemptCapsuleDigests
      });
      return Object.freeze({
        status: "ESCALATED",
        attempts: state.attempts,
        failure: lastFailure,
        attemptCapsuleDigests: Object.freeze([...state.attemptCapsuleDigests])
      });
    }

    // The repair stage is only durable state between attempts; the terminal
    // stage after the last attempt is written once, below.
    if (state.attempts < policy.maxAttempts) {
      await ports.saveState({
        stage: "repair",
        attempts: state.attempts,
        attemptCapsuleDigests: state.attemptCapsuleDigests
      });
    }
  }

  if (lastFailure === undefined) fail("VES_REPAIR_STATE_INVALID", "repair loop ended without a recorded failure");
  await ports.saveState({
    stage: declared ? "escalated" : "gate-failed",
    attempts: state.attempts,
    attemptCapsuleDigests: state.attemptCapsuleDigests
  });
  return Object.freeze({
    status: declared ? "ESCALATED" : "GATE_FAILED",
    attempts: state.attempts,
    failure: lastFailure,
    attemptCapsuleDigests: Object.freeze([...state.attemptCapsuleDigests])
  });
}
