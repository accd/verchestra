import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { link, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ArtifactSealer, sealedProjectionMatches } from "../integrity/artifact-sealer.ts";
import { canonicalizeJson, sha256Digest } from "../integrity/canonical.ts";
import type { JsonValue, SealedArtifact, TrustRoot } from "../integrity/types.ts";

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;

export interface ExecutionPackageArtifactRef {
  readonly artifactId: string;
  readonly digest: Digest;
}

export interface ExecutionRequirement {
  readonly requirementId: string;
  readonly priority: "must" | "should" | "could";
  readonly acceptanceCriteria: string;
  readonly assumptionState: "closed";
  readonly independentTest: string;
  readonly artifactDigest: Digest;
}

export interface ExecutionTask {
  readonly taskId: string;
  readonly sequence: number;
  readonly requirementIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly componentRefs: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly doneCriteria: readonly string[];
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly expectedCommit: string;
}

export interface TaskCompletionEvidence {
  readonly taskId: string;
  readonly result: "passed";
  readonly evidenceDigest: Digest;
  readonly sourceStateDigest: Digest;
}

export interface PendingTask {
  readonly taskId: string;
  readonly sequence: number;
  readonly blockedBy: readonly string[];
  readonly ready: boolean;
}

export interface ExecutionPackageBindings {
  readonly sourceState: Readonly<Record<string, Digest>>;
  readonly policyDigest: Digest;
  readonly skillLockDigest: Digest;
  readonly contextDigest: Digest;
  readonly dataAccessDigest: Digest;
  readonly effectPlanDigest: Digest;
  readonly verificationPlanDigest: Digest;
  readonly destinationDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly budgetDigest: Digest;
  readonly evidenceDigest: Digest;
}

export interface ExecutionPackagePayload {
  readonly schemaVersion: 1;
  readonly packageVersion: number;
  readonly workspaceId: string;
  readonly projectIds: readonly string[];
  readonly featureId: string;
  readonly executionContractDigest: Digest;
  readonly requirements: readonly ExecutionRequirement[];
  readonly decisions: readonly ExecutionPackageArtifactRef[];
  readonly tasks: readonly ExecutionTask[];
  readonly completedTaskEvidence: readonly TaskCompletionEvidence[];
  readonly pendingTasks: readonly PendingTask[];
  readonly contextRecipes: readonly ExecutionPackageArtifactRef[];
  readonly discoveryEvidence: readonly ExecutionPackageArtifactRef[];
  readonly dataPolicies: readonly ExecutionPackageArtifactRef[];
  readonly seedSpecifications: readonly ExecutionPackageArtifactRef[];
  readonly requiredCapabilities: readonly string[];
  readonly roleRequirements: readonly {
    readonly role: string;
    readonly capabilities: readonly string[];
    readonly minimumContextTokens: number;
    readonly reasoning: "medium" | "high" | "xhigh";
  }[];
  readonly gates: readonly {
    readonly gateId: string;
    readonly command: string;
    readonly evidenceRequired: boolean;
  }[];
  readonly approvalRequirements: readonly string[];
  readonly workClaimRequirement: { readonly scopeDigest: Digest; readonly mode: "exclusive" | "advisory" };
  readonly budgets: {
    readonly maximumCostUsd: number;
    readonly maximumTokens: number;
    readonly maximumDurationMs: number;
  };
  // Declared gate-repair policy (REP-01). Absent means today's semantics: one
  // attempt, stop at gate-failed. The policy lives in the package so the
  // evidence shows the declared path to convergence, not just the destination.
  readonly onGateFailure?: {
    readonly maxAttempts: number;
    readonly feedbackToDriver: boolean;
    readonly escalateAfter: number;
  };
  // Digest of the signed policy bundle in force when the package was sealed
  // (POL-04), so verification can prove which policies governed the work.
  readonly policyBundleDigest?: Digest;
  // Promoted read-only probe evidence that informed the plan (R8), referenced by
  // digest so whoever resumes the package can verify the same classified,
  // redacted database state the agent decided from.
  //
  // Every field is a digest, an opaque ref, a closed enum, or a count. That is
  // deliberate: a reference that could carry free text would be a way to smuggle
  // a probed value past the redaction that data-probe already applied, and this
  // payload is sealed and travels. `packages/evidence` and
  // `packages/data-probe` are siblings and cannot import each other, so this
  // stays pure data and verification goes through an application port.
  readonly probeEvidence?: readonly {
    readonly resultDigest: Digest;
    readonly schemaIdentityDigest: Digest;
    readonly registrationDigest: Digest;
    readonly queryFingerprint: Digest;
    readonly producingRunId: string;
    readonly protectedResultRef: string;
    readonly classification: "public" | "internal" | "confidential" | "restricted";
    readonly redactionApplied: boolean;
    readonly sanitizedClaimCount: number;
  }[];
  readonly completionCriteria: readonly {
    readonly criterionId: string;
    readonly requirementIds: readonly string[];
    readonly verificationRefs: readonly string[];
  }[];
  readonly canonicalLocation: { readonly gitOwnerId: Digest; readonly logicalPath: string };
  readonly createdByRunId: string;
  readonly createdAt: string;
  readonly bindings: ExecutionPackageBindings;
}

export type ExecutionPackageBuildInput = Omit<ExecutionPackagePayload, "pendingTasks">;
export type SignedExecutionPackage = SealedArtifact<JsonValue> & { readonly payload: ExecutionPackagePayload };

export interface ExecutionPackageCurrentState extends ExecutionPackageBindings {
  readonly workspaceId: string;
  readonly evaluatedAt: string;
}

export interface ExecutionPackageInvalidation {
  readonly field: string;
  readonly expectedDigest: string;
  readonly actualDigest: string;
  readonly approvalInvalidated: true;
}

export type ExecutionPackageVerification =
  | {
      readonly ok: true;
      readonly packageId: string;
      readonly firstPendingTaskId: string | null;
      readonly pendingTasks: readonly PendingTask[];
    }
  | { readonly ok: false; readonly code: string; readonly invalidations?: readonly ExecutionPackageInvalidation[] };

export class ExecutionPackageError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExecutionPackageError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_ID = /^[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const REQUIREMENT = /^VES-[A-Z]{3}-[0-9]{3}$/u;
const PROHIBITED_FIELDS = new Set([
  "provider",
  "providerId",
  "backend",
  "backendId",
  "model",
  "modelId",
  "session",
  "sessionId",
  "threadId",
  "turnId",
  "transcript",
  "credential",
  "secretValue",
  "providerToken",
  "token",
  "localPath",
  "absolutePath"
]);
const BINDING_FIELDS = [
  "policyDigest",
  "skillLockDigest",
  "contextDigest",
  "dataAccessDigest",
  "effectPlanDigest",
  "verificationPlanDigest",
  "destinationDigest",
  "capabilityDigest",
  "budgetDigest",
  "evidenceDigest"
] as const;

function fail(code: string, message: string): never {
  throw new ExecutionPackageError(code, message);
}

function record(value: unknown, name: string, keys: readonly string[], code = "VES_EXECUTION_PACKAGE_INVALID"): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${name} must be an object`);
  const row = value as Row;
  const extras = Object.keys(row).filter((key) => !keys.includes(key));
  if (extras.length > 0) fail(code, `${name} contains unsupported fields: ${extras.sort().join(", ")}`);
  return row;
}

function rejectPrivateShape(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("VES_EXECUTION_PACKAGE_INVALID", "Execution Package input is cyclic");
  seen.add(value);
  for (const [key, entry] of Object.entries(value as Row)) {
    if (PROHIBITED_FIELDS.has(key))
      fail("VES_EXECUTION_PACKAGE_INVALID", `Execution Package field is prohibited: ${key}`);
    rejectPrivateShape(entry, seen);
  }
  seen.delete(value);
}

function rejectAbsoluteStrings(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|file:|\/(?:home|Users|private|tmp|var)\/)/u.test(value))
      fail("VES_EXECUTION_PACKAGE_LOCAL_PATH", "Execution Package contains a machine-local absolute path");
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const entry of Object.values(value as Row)) rejectAbsoluteStrings(entry, seen);
}

function text(value: unknown, name: string, maximum = 2048): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f]/u.test(value)
  )
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value;
}

function safe(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value;
}

function digest(value: unknown, name: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value as Digest;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value;
}

function boundedNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value;
}

function instant(value: unknown, name: string): string {
  if (typeof value !== "string") fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value;
}

function values<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} is invalid`);
  return value as T;
}

function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("VES_EXECUTION_PACKAGE_INVALID", `${name} must be an array`);
  return value;
}

function uniqueStrings(value: unknown, name: string, allowEmpty = false): readonly string[] {
  const normalized = array(value, name).map((entry, index) => safe(entry, `${name}[${index}]`));
  if ((!allowEmpty && normalized.length === 0) || new Set(normalized).size !== normalized.length)
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} must contain unique values`);
  return Object.freeze([...normalized].sort());
}

function artifactRefs(value: unknown, name: string): readonly ExecutionPackageArtifactRef[] {
  const refs = array(value, name).map((entry, index) => {
    const row = record(entry, `${name}[${index}]`, ["artifactId", "digest"]);
    return Object.freeze({
      artifactId: safe(row["artifactId"], "artifactId"),
      digest: digest(row["digest"], "digest")
    });
  });
  if (new Set(refs.map((entry) => entry.artifactId)).size !== refs.length)
    fail("VES_EXECUTION_PACKAGE_INVALID", `${name} contains duplicate artifact IDs`);
  return Object.freeze(refs.sort((left, right) => left.artifactId.localeCompare(right.artifactId)));
}

function logicalPath(value: unknown): string {
  const path = text(value, "canonicalLocation.logicalPath", 1024);
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some((segment) => segment === ".." || segment === ""))
    fail("VES_EXECUTION_PACKAGE_LOCAL_PATH", "Canonical location must be a relative logical path");
  return path;
}

function normalizeRequirements(value: unknown): readonly ExecutionRequirement[] {
  const requirements = array(value, "requirements").map((entry, index) => {
    const row = record(
      entry,
      `requirements[${index}]`,
      ["requirementId", "priority", "acceptanceCriteria", "assumptionState", "independentTest", "artifactDigest"],
      "VES_EXECUTION_PACKAGE_REQUIREMENT_INVALID"
    );
    const requirementId = row["requirementId"];
    const acceptanceCriteria = row["acceptanceCriteria"];
    if (
      typeof requirementId !== "string" ||
      !REQUIREMENT.test(requirementId) ||
      row["assumptionState"] !== "closed" ||
      typeof acceptanceCriteria !== "string" ||
      !/\bWHEN\b.+\bTHEN\b.+\bSHALL\b/u.test(acceptanceCriteria)
    )
      fail("VES_EXECUTION_PACKAGE_REQUIREMENT_INVALID", "Requirement contract is incomplete");
    return Object.freeze({
      requirementId,
      priority: values(row["priority"], ["must", "should", "could"] as const, "priority"),
      acceptanceCriteria: text(acceptanceCriteria, "acceptanceCriteria", 4096),
      assumptionState: "closed" as const,
      independentTest: text(row["independentTest"], "independentTest", 2048),
      artifactDigest: digest(row["artifactDigest"], "artifactDigest")
    });
  });
  if (
    requirements.length === 0 ||
    new Set(requirements.map((entry) => entry.requirementId)).size !== requirements.length
  )
    fail("VES_EXECUTION_PACKAGE_REQUIREMENT_INVALID", "Requirements must be nonempty and unique");
  return Object.freeze(requirements.sort((left, right) => left.requirementId.localeCompare(right.requirementId)));
}

function normalizeTasks(value: unknown, requirements: ReadonlySet<string>): readonly ExecutionTask[] {
  const tasks = array(value, "tasks").map((entry, index) => {
    const row = record(
      entry,
      `tasks[${index}]`,
      [
        "taskId",
        "sequence",
        "requirementIds",
        "dependsOn",
        "componentRefs",
        "verificationCommands",
        "doneCriteria",
        "risk",
        "expectedCommit"
      ],
      "VES_EXECUTION_PACKAGE_TASK_INVALID"
    );
    const requirementIds = uniqueStrings(row["requirementIds"], "requirementIds");
    if (requirementIds.some((id) => !requirements.has(id)))
      fail("VES_EXECUTION_PACKAGE_TASK_INVALID", "Task references an unknown requirement");
    const componentRefs = array(row["componentRefs"], "componentRefs").map((item) => text(item, "componentRef"));
    const verificationCommands = array(row["verificationCommands"], "verificationCommands").map((item) =>
      text(item, "verificationCommand")
    );
    const doneCriteria = array(row["doneCriteria"], "doneCriteria").map((item) => text(item, "doneCriterion"));
    if (componentRefs.length === 0 || verificationCommands.length === 0 || doneCriteria.length === 0)
      fail("VES_EXECUTION_PACKAGE_TASK_INVALID", "Task execution contract is incomplete");
    return Object.freeze({
      taskId: safe(row["taskId"], "taskId"),
      sequence: positive(row["sequence"], "sequence"),
      requirementIds,
      dependsOn: uniqueStrings(row["dependsOn"], "dependsOn", true),
      componentRefs: Object.freeze([...componentRefs].sort()),
      verificationCommands: Object.freeze([...verificationCommands].sort()),
      doneCriteria: Object.freeze([...doneCriteria].sort()),
      risk: values(row["risk"], ["low", "medium", "high", "critical"] as const, "risk"),
      expectedCommit: text(row["expectedCommit"], "expectedCommit", 256)
    });
  });
  if (tasks.length === 0) fail("VES_EXECUTION_PACKAGE_TASK_INVALID", "Task graph is empty");
  const ids = new Set(tasks.map((task) => task.taskId));
  const sequences = new Set(tasks.map((task) => task.sequence));
  if (ids.size !== tasks.length || sequences.size !== tasks.length)
    fail("VES_EXECUTION_PACKAGE_TASK_INVALID", "Task IDs and sequence numbers must be unique");
  if (tasks.some((task) => task.dependsOn.some((dependency) => !ids.has(dependency) || dependency === task.taskId)))
    fail("VES_EXECUTION_PACKAGE_TASK_INVALID", "Task dependency is invalid");
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) fail("VES_EXECUTION_PACKAGE_TASK_CYCLE", "Task graph contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return Object.freeze(
    tasks.sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId))
  );
}

function sourceStateDigest(sourceState: Readonly<Record<string, Digest>>): Digest {
  return `sha256:${sha256Digest(sourceState)}`;
}

function normalizeCompletions(
  value: unknown,
  tasks: readonly ExecutionTask[],
  expectedSourceStateDigest: Digest
): readonly TaskCompletionEvidence[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const completions = array(value, "completedTaskEvidence").map((entry, index) => {
    const row = record(
      entry,
      `completedTaskEvidence[${index}]`,
      ["taskId", "result", "evidenceDigest", "sourceStateDigest"],
      "VES_EXECUTION_PACKAGE_COMPLETION_INVALID"
    );
    const taskId = safe(row["taskId"], "taskId");
    if (!byId.has(taskId) || row["result"] !== "passed" || row["sourceStateDigest"] !== expectedSourceStateDigest)
      fail("VES_EXECUTION_PACKAGE_COMPLETION_INVALID", "Task completion evidence is invalid");
    return Object.freeze({
      taskId,
      result: "passed" as const,
      evidenceDigest: digest(row["evidenceDigest"], "evidenceDigest"),
      sourceStateDigest: digest(row["sourceStateDigest"], "sourceStateDigest")
    });
  });
  const completed = new Set(completions.map((entry) => entry.taskId));
  if (completed.size !== completions.length)
    fail("VES_EXECUTION_PACKAGE_COMPLETION_INVALID", "Task completion evidence is duplicated");
  for (const taskId of completed)
    if (byId.get(taskId)?.dependsOn.some((dependency) => !completed.has(dependency)) === true)
      fail("VES_EXECUTION_PACKAGE_COMPLETION_INVALID", "Completed task has an incomplete dependency");
  return Object.freeze(completions.sort((left, right) => left.taskId.localeCompare(right.taskId)));
}

export function derivePendingTasks(
  tasks: readonly ExecutionTask[],
  completedTaskEvidence: readonly TaskCompletionEvidence[]
): readonly PendingTask[] {
  const completed = new Set(completedTaskEvidence.map((entry) => entry.taskId));
  return Object.freeze(
    tasks
      .filter((task) => !completed.has(task.taskId))
      .map((task) => {
        const blockedBy = Object.freeze(task.dependsOn.filter((dependency) => !completed.has(dependency)).sort());
        return Object.freeze({
          taskId: task.taskId,
          sequence: task.sequence,
          blockedBy,
          ready: blockedBy.length === 0
        });
      })
      .sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId))
  );
}

function normalizeBindings(value: unknown): ExecutionPackageBindings {
  const row = record(value, "bindings", ["sourceState", ...BINDING_FIELDS]);
  const sourceInput = row["sourceState"];
  if (sourceInput === null || typeof sourceInput !== "object" || Array.isArray(sourceInput))
    fail("VES_EXECUTION_PACKAGE_INVALID", "sourceState must be an object");
  const source = record(sourceInput, "sourceState", Object.keys(sourceInput));
  const entries = Object.entries(source).map(
    ([key, entry]) => [safe(key, "sourceState key"), digest(entry, "sourceState digest")] as const
  );
  if (entries.length === 0) fail("VES_EXECUTION_PACKAGE_INVALID", "sourceState is empty");
  const sourceState = Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))));
  return Object.freeze({
    sourceState,
    policyDigest: digest(row["policyDigest"], "policyDigest"),
    skillLockDigest: digest(row["skillLockDigest"], "skillLockDigest"),
    contextDigest: digest(row["contextDigest"], "contextDigest"),
    dataAccessDigest: digest(row["dataAccessDigest"], "dataAccessDigest"),
    effectPlanDigest: digest(row["effectPlanDigest"], "effectPlanDigest"),
    verificationPlanDigest: digest(row["verificationPlanDigest"], "verificationPlanDigest"),
    destinationDigest: digest(row["destinationDigest"], "destinationDigest"),
    capabilityDigest: digest(row["capabilityDigest"], "capabilityDigest"),
    budgetDigest: digest(row["budgetDigest"], "budgetDigest"),
    evidenceDigest: digest(row["evidenceDigest"], "evidenceDigest")
  });
}

const BASE_KEYS = [
  "schemaVersion",
  "packageVersion",
  "workspaceId",
  "projectIds",
  "featureId",
  "executionContractDigest",
  "requirements",
  "decisions",
  "tasks",
  "completedTaskEvidence",
  "contextRecipes",
  "discoveryEvidence",
  "dataPolicies",
  "seedSpecifications",
  "requiredCapabilities",
  "roleRequirements",
  "gates",
  "approvalRequirements",
  "workClaimRequirement",
  "budgets",
  "onGateFailure",
  "policyBundleDigest",
  "probeEvidence",
  "completionCriteria",
  "canonicalLocation",
  "createdByRunId",
  "createdAt",
  "bindings"
] as const;

function normalizeBuildInput(value: unknown): ExecutionPackageBuildInput {
  rejectPrivateShape(value);
  rejectAbsoluteStrings(value);
  const row = record(value, "Execution Package", BASE_KEYS);
  if (row["schemaVersion"] !== 1) fail("VES_EXECUTION_PACKAGE_INVALID", "schemaVersion must equal 1");
  const bindings = normalizeBindings(row["bindings"]);
  const requirements = normalizeRequirements(row["requirements"]);
  const tasks = normalizeTasks(row["tasks"], new Set(requirements.map((entry) => entry.requirementId)));
  const completedTaskEvidence = normalizeCompletions(
    row["completedTaskEvidence"],
    tasks,
    sourceStateDigest(bindings.sourceState)
  );
  const roles = array(row["roleRequirements"], "roleRequirements").map((entry, index) => {
    const role = record(entry, `roleRequirements[${index}]`, [
      "role",
      "capabilities",
      "minimumContextTokens",
      "reasoning"
    ]);
    return Object.freeze({
      role: safe(role["role"], "role"),
      capabilities: uniqueStrings(role["capabilities"], "capabilities"),
      minimumContextTokens: positive(role["minimumContextTokens"], "minimumContextTokens"),
      reasoning: values(role["reasoning"], ["medium", "high", "xhigh"] as const, "reasoning")
    });
  });
  if (roles.length === 0 || new Set(roles.map((entry) => entry.role)).size !== roles.length)
    fail("VES_EXECUTION_PACKAGE_INVALID", "roleRequirements are invalid");
  const gates = array(row["gates"], "gates").map((entry, index) => {
    const gate = record(entry, `gates[${index}]`, ["gateId", "command", "evidenceRequired"]);
    if (typeof gate["evidenceRequired"] !== "boolean") fail("VES_EXECUTION_PACKAGE_INVALID", "gate is invalid");
    return Object.freeze({
      gateId: safe(gate["gateId"], "gateId"),
      command: text(gate["command"], "command"),
      evidenceRequired: gate["evidenceRequired"]
    });
  });
  if (gates.length === 0 || new Set(gates.map((entry) => entry.gateId)).size !== gates.length)
    fail("VES_EXECUTION_PACKAGE_INVALID", "gates are invalid");
  const workClaim = record(row["workClaimRequirement"], "workClaimRequirement", ["scopeDigest", "mode"]);
  const budgets = record(row["budgets"], "budgets", ["maximumCostUsd", "maximumTokens", "maximumDurationMs"]);
  let onGateFailure;
  if (row["onGateFailure"] !== undefined) {
    const policy = record(row["onGateFailure"], "onGateFailure", ["maxAttempts", "feedbackToDriver", "escalateAfter"]);
    const maxAttempts = policy["maxAttempts"];
    const escalateAfter = policy["escalateAfter"];
    // Bounded and totally ordered: unbounded retries are an autonomy leak, and
    // an escalation point past the last attempt could never fire.
    if (!Number.isSafeInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > 5)
      fail("VES_EXECUTION_PACKAGE_INVALID", "onGateFailure.maxAttempts must be an integer within [1, 5]");
    if (typeof policy["feedbackToDriver"] !== "boolean")
      fail("VES_EXECUTION_PACKAGE_INVALID", "onGateFailure.feedbackToDriver must be a boolean");
    if (
      !Number.isSafeInteger(escalateAfter) ||
      (escalateAfter as number) < 1 ||
      (escalateAfter as number) > (maxAttempts as number)
    )
      fail("VES_EXECUTION_PACKAGE_INVALID", "onGateFailure.escalateAfter must be an integer within [1, maxAttempts]");
    onGateFailure = Object.freeze({
      maxAttempts: maxAttempts as number,
      feedbackToDriver: policy["feedbackToDriver"] as boolean,
      escalateAfter: escalateAfter as number
    });
  }
  const policyBundleDigest =
    row["policyBundleDigest"] === undefined ? undefined : digest(row["policyBundleDigest"], "policyBundleDigest");
  let probeEvidence;
  if (row["probeEvidence"] !== undefined) {
    const entries = array(row["probeEvidence"], "probeEvidence");
    if (entries.length === 0) fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence is present but empty");
    probeEvidence = Object.freeze(
      entries.map((entry, index) => {
        const probe = record(entry, `probeEvidence[${index}]`, [
          "resultDigest",
          "schemaIdentityDigest",
          "registrationDigest",
          "queryFingerprint",
          "producingRunId",
          "protectedResultRef",
          "classification",
          "redactionApplied",
          "sanitizedClaimCount"
        ]);
        const classification = probe["classification"];
        if (!["public", "internal", "confidential", "restricted"].includes(classification as string))
          fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence classification is not a declared class");
        if (typeof probe["redactionApplied"] !== "boolean")
          fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence redactionApplied must be a boolean");
        const claimCount = probe["sanitizedClaimCount"];
        if (!Number.isSafeInteger(claimCount) || (claimCount as number) < 0)
          fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence sanitizedClaimCount is invalid");
        // Anything above public must already have been redacted before it was
        // promoted. Sealing an unredacted confidential probe would put the
        // decision's inputs beyond the boundary that classified them.
        if (classification !== "public" && probe["redactionApplied"] !== true)
          fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence above public class must be redacted");
        return Object.freeze({
          resultDigest: digest(probe["resultDigest"], "probeEvidence.resultDigest"),
          schemaIdentityDigest: digest(probe["schemaIdentityDigest"], "probeEvidence.schemaIdentityDigest"),
          registrationDigest: digest(probe["registrationDigest"], "probeEvidence.registrationDigest"),
          queryFingerprint: digest(probe["queryFingerprint"], "probeEvidence.queryFingerprint"),
          producingRunId: safe(probe["producingRunId"], "probeEvidence.producingRunId"),
          protectedResultRef: safe(probe["protectedResultRef"], "probeEvidence.protectedResultRef"),
          classification: classification as "public" | "internal" | "confidential" | "restricted",
          redactionApplied: probe["redactionApplied"] as boolean,
          sanitizedClaimCount: claimCount as number
        });
      })
    );
    const digests = probeEvidence.map((entry) => entry.resultDigest);
    if (new Set(digests).size !== digests.length)
      fail("VES_EXECUTION_PACKAGE_INVALID", "probeEvidence repeats a result digest");
  }
  const completionCriteria = array(row["completionCriteria"], "completionCriteria").map((entry, index) => {
    const criterion = record(entry, `completionCriteria[${index}]`, [
      "criterionId",
      "requirementIds",
      "verificationRefs"
    ]);
    const requirementIds = uniqueStrings(criterion["requirementIds"], "requirementIds");
    if (requirementIds.some((id) => !requirements.some((requirement) => requirement.requirementId === id)))
      fail("VES_EXECUTION_PACKAGE_INVALID", "completion criterion references an unknown requirement");
    return Object.freeze({
      criterionId: safe(criterion["criterionId"], "criterionId"),
      requirementIds,
      verificationRefs: uniqueStrings(criterion["verificationRefs"], "verificationRefs")
    });
  });
  if (completionCriteria.length === 0) fail("VES_EXECUTION_PACKAGE_INVALID", "completionCriteria are empty");
  const location = record(row["canonicalLocation"], "canonicalLocation", ["gitOwnerId", "logicalPath"]);
  return Object.freeze({
    schemaVersion: 1 as const,
    packageVersion: positive(row["packageVersion"], "packageVersion"),
    workspaceId: safe(row["workspaceId"], "workspaceId"),
    projectIds: uniqueStrings(row["projectIds"], "projectIds"),
    featureId: safe(row["featureId"], "featureId"),
    executionContractDigest: digest(row["executionContractDigest"], "executionContractDigest"),
    requirements,
    decisions: artifactRefs(row["decisions"], "decisions"),
    tasks,
    completedTaskEvidence,
    contextRecipes: artifactRefs(row["contextRecipes"], "contextRecipes"),
    discoveryEvidence: artifactRefs(row["discoveryEvidence"], "discoveryEvidence"),
    dataPolicies: artifactRefs(row["dataPolicies"], "dataPolicies"),
    seedSpecifications: artifactRefs(row["seedSpecifications"], "seedSpecifications"),
    requiredCapabilities: uniqueStrings(row["requiredCapabilities"], "requiredCapabilities"),
    roleRequirements: Object.freeze(roles.sort((left, right) => left.role.localeCompare(right.role))),
    gates: Object.freeze(gates.sort((left, right) => left.gateId.localeCompare(right.gateId))),
    approvalRequirements: uniqueStrings(row["approvalRequirements"], "approvalRequirements"),
    workClaimRequirement: Object.freeze({
      scopeDigest: digest(workClaim["scopeDigest"], "scopeDigest"),
      mode: values(workClaim["mode"], ["exclusive", "advisory"] as const, "mode")
    }),
    budgets: Object.freeze({
      maximumCostUsd: boundedNumber(budgets["maximumCostUsd"], "maximumCostUsd"),
      maximumTokens: positive(budgets["maximumTokens"], "maximumTokens"),
      maximumDurationMs: positive(budgets["maximumDurationMs"], "maximumDurationMs")
    }),
    ...(onGateFailure === undefined ? {} : { onGateFailure }),
    ...(policyBundleDigest === undefined ? {} : { policyBundleDigest }),
    ...(probeEvidence === undefined ? {} : { probeEvidence }),
    completionCriteria: Object.freeze(
      completionCriteria.sort((left, right) => left.criterionId.localeCompare(right.criterionId))
    ),
    canonicalLocation: Object.freeze({
      gitOwnerId: digest(location["gitOwnerId"], "gitOwnerId"),
      logicalPath: logicalPath(location["logicalPath"])
    }),
    createdByRunId: safe(row["createdByRunId"], "createdByRunId"),
    createdAt: instant(row["createdAt"], "createdAt"),
    bindings
  });
}

function normalizePending(value: unknown): readonly PendingTask[] {
  return Object.freeze(
    array(value, "pendingTasks")
      .map((entry, index) => {
        const row = record(entry, `pendingTasks[${index}]`, ["taskId", "sequence", "blockedBy", "ready"]);
        const blockedBy = uniqueStrings(row["blockedBy"], "blockedBy", true);
        if (typeof row["ready"] !== "boolean" || row["ready"] !== (blockedBy.length === 0))
          fail("VES_EXECUTION_PACKAGE_DERIVATION_INVALID", "Pending task readiness is inconsistent");
        return Object.freeze({
          taskId: safe(row["taskId"], "taskId"),
          sequence: positive(row["sequence"], "sequence"),
          blockedBy,
          ready: row["ready"]
        });
      })
      .sort((left, right) => left.sequence - right.sequence || left.taskId.localeCompare(right.taskId))
  );
}

function normalizePayload(value: unknown): ExecutionPackagePayload {
  const row = record(value, "Execution Package payload", [...BASE_KEYS, "pendingTasks"]);
  const base = Object.fromEntries(BASE_KEYS.map((key) => [key, row[key]]));
  const normalized = normalizeBuildInput(base);
  return Object.freeze({ ...normalized, pendingTasks: normalizePending(row["pendingTasks"]) });
}

function bindingFor(payload: ExecutionPackagePayload) {
  return Object.freeze({
    schema: Object.freeze({ name: "execution-package", version: 1 }),
    purpose: "execution-package",
    bindingId: `${payload.workspaceId}:${payload.featureId}:v${payload.packageVersion}`,
    sourceStateDigest: sha256Digest(payload.bindings.sourceState)
  });
}

function digestValue(value: unknown): string {
  return `sha256:${sha256Digest(value as JsonValue)}`;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function normalizeCurrent(value: unknown): ExecutionPackageCurrentState {
  const row = record(
    value,
    "current state",
    ["workspaceId", "sourceState", ...BINDING_FIELDS, "evaluatedAt"],
    "VES_EXECUTION_PACKAGE_CURRENT_STATE_INVALID"
  );
  try {
    const bindings = normalizeBindings(
      Object.fromEntries(["sourceState", ...BINDING_FIELDS].map((key) => [key, row[key]]))
    );
    return Object.freeze({
      workspaceId: safe(row["workspaceId"], "workspaceId"),
      ...bindings,
      evaluatedAt: instant(row["evaluatedAt"], "evaluatedAt")
    });
  } catch (error) {
    if (error instanceof ExecutionPackageError)
      throw new ExecutionPackageError(
        "VES_EXECUTION_PACKAGE_CURRENT_STATE_INVALID",
        "Current state is invalid",
        false,
        {
          cause: error
        }
      );
    throw error;
  }
}

function invalidations(
  payload: ExecutionPackagePayload,
  current: ExecutionPackageCurrentState
): readonly ExecutionPackageInvalidation[] {
  if (payload.workspaceId !== current.workspaceId)
    return Object.freeze([
      Object.freeze({
        field: "workspaceId",
        expectedDigest: digestValue(payload.workspaceId),
        actualDigest: digestValue(current.workspaceId),
        approvalInvalidated: true as const
      })
    ]);
  const results: ExecutionPackageInvalidation[] = [];
  const sourceIds = new Set([...Object.keys(payload.bindings.sourceState), ...Object.keys(current.sourceState)]);
  for (const sourceId of sourceIds) {
    const expected = payload.bindings.sourceState[sourceId];
    const actual = current.sourceState[sourceId];
    if (expected !== actual)
      results.push({
        field: `bindings.sourceState.${sourceId}`,
        expectedDigest: expected ?? digestValue(null),
        actualDigest: actual ?? digestValue(null),
        approvalInvalidated: true
      });
  }
  for (const field of BINDING_FIELDS)
    if (payload.bindings[field] !== current[field])
      results.push({
        field: `bindings.${field}`,
        expectedDigest: payload.bindings[field],
        actualDigest: current[field],
        approvalInvalidated: true
      });
  return Object.freeze(
    results.sort((left, right) => left.field.localeCompare(right.field)).map((entry) => Object.freeze(entry))
  );
}

export class ExecutionPackageBuilder {
  readonly #sealer: ArtifactSealer;

  constructor(options: { readonly sealer: ArtifactSealer }) {
    this.#sealer = options.sealer;
  }

  async build(value: unknown): Promise<SignedExecutionPackage> {
    const base = normalizeBuildInput(value);
    const payload = Object.freeze({
      ...base,
      pendingTasks: derivePendingTasks(base.tasks, base.completedTaskEvidence)
    });
    return deepFreeze(
      (await this.#sealer.seal(payload as unknown as JsonValue, bindingFor(payload))) as SignedExecutionPackage
    );
  }

  async verify(
    artifact: SignedExecutionPackage,
    trust: TrustRoot,
    currentInput: unknown
  ): Promise<ExecutionPackageVerification> {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      artifact.schema === null ||
      typeof artifact.schema !== "object"
    )
      return Object.freeze({ ok: false, code: "VES_EXECUTION_PACKAGE_INVALID" });
    const cryptographic = await this.#sealer.verify(artifact, trust, {
      schema: artifact.schema,
      purpose: artifact.purpose,
      bindingId: artifact.bindingId,
      sourceStateDigest: artifact.sourceStateDigest,
      now: new Date(
        typeof (currentInput as Row | null)?.["evaluatedAt"] === "string"
          ? String((currentInput as Row)["evaluatedAt"])
          : 0
      )
    });
    if (!cryptographic.ok) return Object.freeze({ ok: false, code: cryptographic.code });
    let payload: ExecutionPackagePayload;
    try {
      payload = normalizePayload(artifact.payload);
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: error instanceof ExecutionPackageError ? error.code : "VES_EXECUTION_PACKAGE_INVALID"
      });
    }
    const binding = bindingFor(payload);
    if (
      artifact.schema.name !== binding.schema.name ||
      artifact.schema.version !== binding.schema.version ||
      artifact.purpose !== binding.purpose ||
      artifact.bindingId !== binding.bindingId ||
      artifact.sourceStateDigest !== binding.sourceStateDigest
    )
      return Object.freeze({ ok: false, code: "VES_EXECUTION_PACKAGE_BINDING_INVALID" });
    const derived = derivePendingTasks(payload.tasks, payload.completedTaskEvidence);
    if (
      canonicalizeJson(derived as unknown as JsonValue) !==
      canonicalizeJson(payload.pendingTasks as unknown as JsonValue)
    )
      return Object.freeze({ ok: false, code: "VES_EXECUTION_PACKAGE_DERIVATION_INVALID" });
    let current: ExecutionPackageCurrentState;
    try {
      current = normalizeCurrent(currentInput);
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: error instanceof ExecutionPackageError ? error.code : "VES_EXECUTION_PACKAGE_CURRENT_STATE_INVALID"
      });
    }
    const changed = invalidations(payload, current);
    if (changed.length > 0)
      return Object.freeze({ ok: false, code: "VES_EXECUTION_PACKAGE_STALE", invalidations: changed });
    return Object.freeze({
      ok: true,
      packageId: artifact.artifactId,
      firstPendingTaskId: derived.find((task) => task.ready)?.taskId ?? null,
      pendingTasks: derived
    });
  }
}

function assertEnvelopeIntegrity(artifact: SignedExecutionPackage, expectedId?: string): void {
  try {
    if (
      !ARTIFACT_ID.test(artifact.artifactId) ||
      (expectedId !== undefined && artifact.artifactId !== expectedId) ||
      sha256Digest(artifact.payload as unknown as JsonValue) !== artifact.payloadDigest ||
      !sealedProjectionMatches(artifact)
    )
      fail("VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY", "Stored package content address is invalid");
  } catch (error) {
    if (error instanceof ExecutionPackageError) throw error;
    throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY", "Stored package is invalid", false, {
      cause: error
    });
  }
}

async function safeRoot(path: string): Promise<string> {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink())
    throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INVALID", "Package store root is linked");
  return realpath(path);
}

async function safeTarget(root: string, target: string): Promise<void> {
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith("..") || resolve(root, fromRoot) !== target)
    throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INVALID", "Package target escapes its root");
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INVALID", "Package target is linked");
    if (relative(root, await realpath(target)).startsWith(".."))
      throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INVALID", "Package target leaves its root");
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
  }
}

export class FileExecutionPackageStore {
  readonly #configuredRoot: string;

  constructor(options: { readonly root: string }) {
    this.#configuredRoot = options.root;
  }

  async put(
    artifact: SignedExecutionPackage
  ): Promise<{ readonly packageId: string; readonly outcome: "published" | "already-published" }> {
    assertEnvelopeIntegrity(artifact);
    const root = await safeRoot(this.#configuredRoot);
    const target = join(root, `${artifact.artifactId}.json`);
    await safeTarget(root, target);
    const bytes = `${canonicalizeJson(artifact as unknown as JsonValue)}\n`;
    try {
      const existing = await readFile(target, "utf8");
      if (existing !== bytes)
        throw new ExecutionPackageError(
          "VES_EXECUTION_PACKAGE_STORAGE_CONFLICT",
          "Canonical package target contains different bytes"
        );
      return Object.freeze({ packageId: artifact.artifactId, outcome: "already-published" as const });
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
    }
    const staging = join(root, `.execution-package-${randomUUID()}.tmp`);
    try {
      await writeFile(staging, bytes, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
      await safeTarget(root, target);
      try {
        await link(staging, target);
      } catch (error) {
        if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
        const existing = await readFile(target, "utf8");
        if (existing !== bytes)
          throw new ExecutionPackageError(
            "VES_EXECUTION_PACKAGE_STORAGE_CONFLICT",
            "Canonical package target changed during publication"
          );
        return Object.freeze({ packageId: artifact.artifactId, outcome: "already-published" as const });
      }
      return Object.freeze({ packageId: artifact.artifactId, outcome: "published" as const });
    } finally {
      await rm(staging, { force: true });
    }
  }

  async get(packageId: string): Promise<SignedExecutionPackage> {
    if (!ARTIFACT_ID.test(packageId))
      throw new ExecutionPackageError("VES_EXECUTION_PACKAGE_STORAGE_INVALID", "Package ID is invalid");
    const root = await safeRoot(this.#configuredRoot);
    const target = join(root, `${packageId}.json`);
    await safeTarget(root, target);
    let artifact: SignedExecutionPackage;
    try {
      artifact = JSON.parse(await readFile(target, "utf8")) as SignedExecutionPackage;
    } catch (error) {
      throw new ExecutionPackageError(
        "VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY",
        "Stored package is unreadable",
        false,
        {
          cause: error
        }
      );
    }
    assertEnvelopeIntegrity(artifact, packageId);
    return deepFreeze(artifact);
  }
}
