import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { CoordinationLimits, CoordinationPlan } from "./coordination-plan.ts";

type Row = Readonly<Record<string, unknown>>;

// invariant: the value a swarm node names in `next` to end the swarm. Node
// identifiers match `^[a-z][a-z0-9-]{0,31}$`, so it can never name a node.
export const COORDINATION_COMPLETE = "<complete>" as const;
export const NODE_RESULT_SUMMARY_CHARACTERS = 8192;
export const HANDOFF_MESSAGE_CHARACTERS = 4096;

// invariant: the stable codes a coordinated run fails with. They travel as the
// `reason` of the existing public `VES_TASK_FAILED`, so no public code is added.
export type CoordinationErrorCode =
  | "VES_COORDINATION_RESULT_INVALID"
  | "VES_COORDINATION_RESULT_TOO_LARGE"
  | "VES_COORDINATION_HANDOFF_UNDECLARED"
  | "VES_COORDINATION_HANDOFF_LIMIT"
  | "VES_COORDINATION_LIMIT"
  | "VES_COORDINATION_ORDER_INVALID"
  | "VES_COORDINATION_SCOPE_DENIED"
  | "VES_COORDINATION_NODE_FAILED"
  | "VES_COORDINATION_NODE_BLOCKED"
  | "VES_COORDINATION_INCOMPLETE"
  | "VES_COORDINATION_ENGINE_FAILED"
  | "VES_COORDINATION_LEDGER_INVALID"
  | "VES_TASK_NODE_UNCERTAIN";

export class CoordinationRunError extends Error {
  readonly code: CoordinationErrorCode;

  constructor(code: CoordinationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoordinationRunError";
    this.code = code;
  }
}

export interface NodeResult {
  readonly outcome: "done" | "blocked";
  readonly summary: string;
  // invariant: present exactly on a swarm node's result: a declared target or
  // COORDINATION_COMPLETE, and the bounded message the next node receives.
  readonly next?: string;
  readonly message?: string;
}

// invariant: the destinations a swarm node may hand off to, as the approved
// plan declares them; a node without a handoff entry may only end the swarm.
export function handoffTargets(plan: CoordinationPlan, nodeId: string): readonly string[] {
  if (plan.mode !== "swarm") return [];
  return plan.handoffs.find((handoff) => handoff.from === nodeId)?.to ?? [];
}

// invariant: SSI-43. A closed draft-07 object that Claude Code and Codex both
// accept: every member required, string enums, bounded strings, nothing open.
// A swarm node's `next` lists only its declared targets and the completion
// value, so the provider is held to the approved destinations.
export function nodeResultSchema(plan: CoordinationPlan, nodeId: string): Row {
  const base = {
    outcome: { enum: ["done", "blocked"] },
    summary: { type: "string", maxLength: NODE_RESULT_SUMMARY_CHARACTERS }
  };
  if (plan.mode !== "swarm")
    return { type: "object", additionalProperties: false, required: ["outcome", "summary"], properties: base };
  return {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "summary", "next", "message"],
    properties: {
      ...base,
      next: { enum: [...handoffTargets(plan, nodeId), COORDINATION_COMPLETE] },
      message: { type: "string", maxLength: HANDOFF_MESSAGE_CHARACTERS }
    }
  };
}

function invalid(message: string): never {
  throw new CoordinationRunError("VES_COORDINATION_RESULT_INVALID", message);
}

// why: JSON Schema bounds a string by its characters, not its UTF-16 units.
function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || [...value].length > maximum) invalid(`${label} is not bounded text`);
  return value;
}

function parsed(bytes: Uint8Array): Row {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return invalid("the node result is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("the node result is not an object");
  // invariant: the bytes a result is persisted and digested as are its
  // canonical text, so one answer has one digest.
  if (canonicalizeJsonV2(value) !== text) invalid("the node result is not canonical JSON");
  return value as Row;
}

function exactMembers(row: Row, members: readonly string[]): void {
  const keys = Object.keys(row);
  if (keys.length !== members.length || members.some((member) => !Object.hasOwn(row, member)))
    invalid("the node result does not hold exactly its schema's members");
}

// invariant: SSI-44 and SSI-46. The application's validator of a node result,
// the authority over what any engine is told: a member outside the schema, a
// missing member, a value of the wrong kind, or an unbounded string is
// VES_COORDINATION_RESULT_INVALID; a swarm decision that names anything other
// than a declared target or the completion value is
// VES_COORDINATION_HANDOFF_UNDECLARED. Nothing is repaired or retried.
export function readNodeResult(bytes: Uint8Array, plan: CoordinationPlan, nodeId: string): NodeResult {
  const row = parsed(bytes);
  const swarm = plan.mode === "swarm";
  exactMembers(row, swarm ? ["outcome", "summary", "next", "message"] : ["outcome", "summary"]);
  const outcome = row["outcome"];
  if (outcome !== "done" && outcome !== "blocked") invalid("the node result outcome is not done or blocked");
  const summary = boundedText(row["summary"], NODE_RESULT_SUMMARY_CHARACTERS, "summary");
  if (!swarm) return Object.freeze({ outcome, summary });
  const next = row["next"];
  if (typeof next !== "string") invalid("the handoff decision names no destination");
  if (next !== COORDINATION_COMPLETE && !handoffTargets(plan, nodeId).includes(next))
    throw new CoordinationRunError(
      "VES_COORDINATION_HANDOFF_UNDECLARED",
      "the handoff names an undeclared destination"
    );
  const message = boundedText(row["message"], HANDOFF_MESSAGE_CHARACTERS, "message");
  return Object.freeze({ outcome, summary, next, message });
}

// invariant: SSI-47. A result is refused before it is persisted when it is
// larger than one node may return, or would take the run's materialized
// results past the run's limit.
export function assertResultBounds(bytes: number, persistedBytes: number, limits: CoordinationLimits): void {
  if (bytes > limits.nodeResultBytes || persistedBytes + bytes > limits.runResultBytes)
    throw new CoordinationRunError("VES_COORDINATION_RESULT_TOO_LARGE", "the node result exceeds its limit");
}
