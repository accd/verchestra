import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CedarPolicyAdapter,
  createCedarEngine,
  installedCedarWasmPath,
  policyViewDigest,
  type CedarEnginePort,
  type CedarRequest,
  type PolicyDecision,
  type PolicyView
} from "@verchestra/policy";

import { isSealedRelease } from "../release-manifest.ts";
import { taskError } from "./task-errors.ts";
import { objectRow, readJsonFile } from "./task-files.ts";

export type TaskPolicyAction = "task-start" | "tool-effect" | "gate-commit" | "human-review";

const CONTEXT = {
  type: "Record",
  attributes: {
    approved: { type: "Boolean" },
    capabilityGranted: { type: "Boolean" },
    workspace: { type: "String" },
    risk: { type: "String" },
    taskId: { type: "String" }
  }
} as const;

const applies = { appliesTo: { principalTypes: ["Actor"], resourceTypes: ["Task"], context: CONTEXT } };

// invariant: the built-in layer is the only layer that may permit; a
// Workspace can narrow it with forbid policies and can never widen it
// (CedarPolicyAdapter refuses a non-forbid policy outside builtIn).
export const TASK_POLICY_SCHEMA = Object.freeze({
  Vestra: {
    entityTypes: { Actor: {}, Task: {} },
    actions: { "task-start": applies, "tool-effect": applies, "gate-commit": applies, "human-review": applies }
  }
});

const BUILT_IN = Object.freeze({
  taskStart: `permit(principal, action == Vestra::Action::"task-start", resource) when { context.approved };`,
  toolEffect: `permit(principal, action == Vestra::Action::"tool-effect", resource) when { context.approved && context.capabilityGranted };`,
  gateCommit: `permit(principal, action == Vestra::Action::"gate-commit", resource) when { context.approved };`,
  humanReview: `permit(principal, action == Vestra::Action::"human-review", resource) when { context.approved };`
});

// why: machine-local Workspace narrowing lives beside the Workspace metadata,
// not in the task request, so a request can never relax its own authority.
export const WORKSPACE_POLICY_PATH = ".verchestra/policy/task-authority.json";

let engine: CedarEnginePort | undefined;

async function cedarEngine(): Promise<CedarEnginePort> {
  if (engine !== undefined) return engine;
  const path = isSealedRelease()
    ? fileURLToPath(new URL("../native/cedar-wasm.wasm", import.meta.url))
    : installedCedarWasmPath();
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw taskError("VES_TASK_FAILED", { reason: "VES_POLICY_ENGINE_UNAVAILABLE" }, "Cedar is unavailable", {
      cause: error
    });
  }
  engine = createCedarEngine(bytes);
  return engine;
}

function codeUnitCompare(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

function forbidLayer(stored: unknown): Readonly<Record<string, string>> {
  const row = objectRow(stored, "task authority policy");
  const forbid = objectRow(row["forbid"], "task authority policy forbid");
  if (row["schemaVersion"] !== 1 || Object.keys(row).sort(codeUnitCompare).join(",") !== "forbid,schemaVersion")
    throw taskError("VES_TASK_FAILED", { reason: "VES_POLICY_VIEW_INVALID" }, "Task authority policy is invalid");
  for (const value of Object.values(forbid))
    if (typeof value !== "string")
      throw taskError("VES_TASK_FAILED", { reason: "VES_POLICY_VIEW_INVALID" }, "Task authority policy is invalid");
  return forbid as Readonly<Record<string, string>>;
}

export interface TaskPolicy {
  readonly view: PolicyView;
  readonly digest: `sha256:${string}`;
  decide(action: TaskPolicyAction, context: TaskPolicyContext): PolicyDecision;
  authorize(request: CedarRequest): PolicyDecision;
}

export interface TaskPolicyContext {
  readonly approved: boolean;
  readonly capabilityGranted: boolean;
  readonly workspaceId: string;
  readonly risk: string;
  readonly taskId: string;
}

export function policyRequest(action: TaskPolicyAction, context: TaskPolicyContext): CedarRequest {
  return Object.freeze({
    principal: { type: "Vestra::Actor", id: action === "human-review" ? "human-reviewer" : "task-implementer" },
    action: { type: "Vestra::Action", id: action },
    resource: { type: "Vestra::Task", id: context.taskId },
    context: {
      approved: context.approved,
      capabilityGranted: context.capabilityGranted,
      workspace: context.workspaceId,
      risk: context.risk,
      taskId: context.taskId
    }
  });
}

export async function loadTaskPolicy(controlRoot: string): Promise<TaskPolicy> {
  const stored = await readJsonFile(join(controlRoot, ...WORKSPACE_POLICY_PATH.split("/")), "task authority policy");
  const view: PolicyView = Object.freeze({
    schemaVersion: 1,
    generation: 1,
    schema: TASK_POLICY_SCHEMA,
    layers: Object.freeze({ builtIn: BUILT_IN, ...(stored === undefined ? {} : { workspace: forbidLayer(stored) }) })
  });
  const adapter = new CedarPolicyAdapter({ engine: await cedarEngine() });
  const validation = adapter.validateView(view);
  if (!validation.valid)
    throw taskError("VES_TASK_FAILED", { reason: validation.code }, "Task authority policy does not validate");
  const authorize = (request: CedarRequest) => adapter.authorize({ view, request, entities: [] });
  return Object.freeze({
    view,
    digest: policyViewDigest(view) as `sha256:${string}`,
    authorize,
    decide: (action: TaskPolicyAction, context: TaskPolicyContext) => authorize(policyRequest(action, context))
  });
}
