import { createHash } from "node:crypto";

import {
  buildIdempotencyKey,
  createEffectIntent,
  type EffectAdapter,
  type EffectApplyResult,
  type EffectIntent,
  type PriorEffectState
} from "@verchestra/effects";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/u;
const STATES = new Set([
  "DISCOVERY",
  "REFINEMENT",
  "SPECIFIED",
  "DESIGNED",
  "TASKS_READY",
  "EXECUTION_READY",
  "IMPLEMENTING",
  "VALIDATING",
  "HUMAN_REVIEW",
  "COMPLETED",
  "BLOCKED"
]);
const APPROVAL_STATUSES = new Set(["not-required", "required", "approved", "rejected", "expired"]);
const CLAIM_STATUSES = new Set(["active", "released"]);

export class JiraConnectorError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JiraConnectorError";
    this.code = code;
  }
}

type JsonRecord = Readonly<Record<string, unknown>> &
  Readonly<{
    schemaVersion?: unknown;
    product?: unknown;
    workspaceId?: unknown;
    projectKey?: unknown;
    correlationId?: unknown;
    package?: unknown;
    packageRef?: unknown;
    packageDigest?: unknown;
    owner?: unknown;
    ownerRef?: unknown;
    ownerDigest?: unknown;
    state?: unknown;
    currentTaskIds?: unknown;
    pendingTaskIds?: unknown;
    approvalStatus?: unknown;
    workClaim?: unknown;
    claimRef?: unknown;
    claimDigest?: unknown;
    status?: unknown;
    lastReconciledVersion?: unknown;
    canonicalRevisionDigest?: unknown;
    projectionDigest?: unknown;
    remaining?: unknown;
    retryAfterMs?: unknown;
    issueId?: unknown;
    issueKey?: unknown;
    version?: unknown;
    marker?: unknown;
    managed?: unknown;
    managedDigest?: unknown;
    pageSize?: unknown;
    maximumPages?: unknown;
    runId?: unknown;
    actorId?: unknown;
    claimId?: unknown;
    fencingToken?: unknown;
    issuedAt?: unknown;
    expiresAt?: unknown;
    releaseReason?: unknown;
    now?: unknown;
  }>;

export interface JiraProjectionInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectKey: string;
  readonly correlationId: string;
  readonly package: { readonly packageRef: string; readonly packageDigest: string };
  readonly owner: { readonly ownerRef: string; readonly ownerDigest: string };
  readonly state: string;
  readonly currentTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
  readonly approvalStatus: string;
  readonly workClaim: { readonly claimRef: string; readonly claimDigest: string; readonly status: string };
  readonly lastReconciledVersion: number;
  readonly canonicalRevisionDigest: string;
}

export interface JiraManagedProjection {
  readonly package: JiraProjectionInput["package"];
  readonly owner: JiraProjectionInput["owner"];
  readonly state: string;
  readonly currentTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
  readonly approvalStatus: string;
  readonly workClaim: JiraProjectionInput["workClaim"];
  readonly lastReconciledVersion: number;
  readonly canonicalRevisionDigest: string;
}

export interface JiraProjectionMarker {
  readonly schemaVersion: 1;
  readonly product: "verchestra";
  readonly correlationId: string;
  readonly packageDigest: string;
  readonly projectionDigest: string;
}

export interface JiraProjectionPlan {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectKey: string;
  readonly correlationId: string;
  readonly managed: JiraManagedProjection;
  readonly projectionDigest: string;
  readonly marker: JiraProjectionMarker;
  readonly idempotencyKey: string;
}

export interface JiraRateState {
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface JiraRemoteIssue {
  readonly issueId: string;
  readonly issueKey: string;
  readonly projectKey: string;
  readonly version: number;
  readonly correlationId: string;
  readonly marker: JiraProjectionMarker;
  readonly managed: JiraManagedProjection;
  readonly managedDigest: string;
}

export interface JiraClaimOwner {
  readonly runId: string;
  readonly actorId: string;
}

export interface JiraRemoteClaim {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly correlationId: string;
  readonly claimId: string;
  readonly owner: JiraClaimOwner;
  readonly fencingToken: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly status: "active" | "released";
  readonly releaseReason?: string;
  readonly version: number;
}

export interface JiraTransport {
  getManaged(input: {
    readonly projectKey: string;
    readonly correlationId: string;
  }): Promise<{ readonly issue?: unknown; readonly rate: JiraRateState }>;
  createManaged(input: {
    readonly projectKey: string;
    readonly correlationId: string;
    readonly marker: JiraProjectionMarker;
    readonly managed: JiraManagedProjection;
  }): Promise<{ readonly issue: unknown; readonly rate: JiraRateState }>;
  updateManaged(input: {
    readonly projectKey: string;
    readonly correlationId: string;
    readonly expectedVersion: number;
    readonly marker: JiraProjectionMarker;
    readonly managed: JiraManagedProjection;
  }): Promise<
    | { readonly status: "updated"; readonly issue: unknown; readonly rate: JiraRateState }
    | { readonly status: "version-conflict"; readonly rate: JiraRateState }
  >;
  listManaged(input: { readonly projectKey: string; readonly cursor?: string; readonly pageSize: number }): Promise<{
    readonly issues: readonly unknown[];
    readonly nextCursor?: string;
    readonly rate: JiraRateState;
  }>;
  readClaim(input: {
    readonly correlationId: string;
  }): Promise<{ readonly claim?: unknown; readonly rate: JiraRateState }>;
  compareAndSwapClaim(input: {
    readonly correlationId: string;
    readonly expectedVersion: number;
    readonly claim: Omit<JiraRemoteClaim, "version">;
  }): Promise<
    | { readonly status: "updated"; readonly claim: unknown; readonly rate: JiraRateState }
    | { readonly status: "conflict"; readonly claim?: unknown; readonly rate: JiraRateState }
  >;
}

const exactKeys = (value: JsonRecord, expected: readonly string[], code: string, label: string): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new JiraConnectorError(code, `${label} has missing or unknown fields`);
  }
};

const asRecord = (value: unknown, code: string, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JiraConnectorError(code, `${label} must be an object`);
  }
  return value as JsonRecord;
};

const requireString = (value: unknown, code: string, label: string, pattern = SAFE_TOKEN): string => {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new JiraConnectorError(code, `${label} is invalid`);
  }
  return value;
};

const requireDigest = (value: unknown, code: string, label: string): string =>
  requireString(value, code, label, DIGEST);

const requireTimestamp = (value: unknown, code: string, label: string): string => {
  const timestamp = requireString(value, code, label);
  if (Number.isNaN(Date.parse(timestamp))) throw new JiraConnectorError(code, `${label} is invalid`);
  return timestamp;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
};

const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;

const canonicalTokens = (value: unknown, code: string, label: string, allowEmpty: boolean): readonly string[] => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new JiraConnectorError(code, `${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const tokens = value.map((entry, index) => requireString(entry, code, `${label}[${index}]`));
  if (new Set(tokens).size !== tokens.length) throw new JiraConnectorError(code, `${label} contains duplicates`);
  return Object.freeze([...tokens].sort());
};

const normalizePackage = (value: unknown, code: string): JiraProjectionInput["package"] => {
  const record = asRecord(value, code, "package");
  exactKeys(record, ["packageRef", "packageDigest"], code, "package");
  return Object.freeze({
    packageRef: requireString(record.packageRef, code, "package.packageRef"),
    packageDigest: requireDigest(record.packageDigest, code, "package.packageDigest")
  });
};

const normalizeOwner = (value: unknown, code: string): JiraProjectionInput["owner"] => {
  const record = asRecord(value, code, "owner");
  exactKeys(record, ["ownerRef", "ownerDigest"], code, "owner");
  return Object.freeze({
    ownerRef: requireString(record.ownerRef, code, "owner.ownerRef"),
    ownerDigest: requireDigest(record.ownerDigest, code, "owner.ownerDigest")
  });
};

const normalizeWorkClaim = (value: unknown, code: string): JiraProjectionInput["workClaim"] => {
  const record = asRecord(value, code, "workClaim");
  exactKeys(record, ["claimRef", "claimDigest", "status"], code, "workClaim");
  const status = requireString(record.status, code, "workClaim.status");
  if (!CLAIM_STATUSES.has(status)) throw new JiraConnectorError(code, "workClaim.status is invalid");
  return Object.freeze({
    claimRef: requireString(record.claimRef, code, "workClaim.claimRef"),
    claimDigest: requireDigest(record.claimDigest, code, "workClaim.claimDigest"),
    status
  });
};

const normalizeManaged = (value: unknown, code: string): JiraManagedProjection => {
  const record = asRecord(value, code, "managed projection");
  exactKeys(
    record,
    [
      "package",
      "owner",
      "state",
      "currentTaskIds",
      "pendingTaskIds",
      "approvalStatus",
      "workClaim",
      "lastReconciledVersion",
      "canonicalRevisionDigest"
    ],
    code,
    "managed projection"
  );
  const state = requireString(record.state, code, "state");
  if (!STATES.has(state)) throw new JiraConnectorError(code, "state is invalid");
  const approvalStatus = requireString(record.approvalStatus, code, "approvalStatus");
  if (!APPROVAL_STATUSES.has(approvalStatus)) throw new JiraConnectorError(code, "approvalStatus is invalid");
  if (!Number.isSafeInteger(record.lastReconciledVersion) || (record.lastReconciledVersion as number) < 0) {
    throw new JiraConnectorError(code, "lastReconciledVersion is invalid");
  }
  return Object.freeze({
    package: normalizePackage(record.package, code),
    owner: normalizeOwner(record.owner, code),
    state,
    currentTaskIds: canonicalTokens(record.currentTaskIds, code, "currentTaskIds", false),
    pendingTaskIds: canonicalTokens(record.pendingTaskIds, code, "pendingTaskIds", true),
    approvalStatus,
    workClaim: normalizeWorkClaim(record.workClaim, code),
    lastReconciledVersion: record.lastReconciledVersion as number,
    canonicalRevisionDigest: requireDigest(record.canonicalRevisionDigest, code, "canonicalRevisionDigest")
  });
};

const normalizeMarker = (value: unknown, code: string): JiraProjectionMarker => {
  const record = asRecord(value, code, "projection marker");
  exactKeys(
    record,
    ["schemaVersion", "product", "correlationId", "packageDigest", "projectionDigest"],
    code,
    "projection marker"
  );
  if (record.schemaVersion !== 1 || record.product !== "verchestra") {
    throw new JiraConnectorError(code, "projection marker identity is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    product: "verchestra",
    correlationId: requireString(record.correlationId, code, "marker.correlationId"),
    packageDigest: requireDigest(record.packageDigest, code, "marker.packageDigest"),
    projectionDigest: requireDigest(record.projectionDigest, code, "marker.projectionDigest")
  });
};

const normalizeRate = (value: unknown): JiraRateState => {
  const record = asRecord(value, "VES_JIRA_REMOTE_INVALID", "rate state");
  if (
    !Number.isSafeInteger(record.remaining) ||
    !Number.isSafeInteger(record.retryAfterMs) ||
    (record.retryAfterMs as number) < 0
  ) {
    throw new JiraConnectorError("VES_JIRA_REMOTE_INVALID", "rate state is invalid");
  }
  const rate = { remaining: record.remaining as number, retryAfterMs: record.retryAfterMs as number };
  if (rate.remaining <= 0) {
    throw new JiraConnectorError(
      "VES_JIRA_RATE_LIMITED",
      `Jira rate budget is exhausted; retry after ${rate.retryAfterMs}ms`
    );
  }
  return Object.freeze(rate);
};

const normalizeIssue = (value: unknown): JiraRemoteIssue => {
  const code = "VES_JIRA_REMOTE_INVALID";
  const record = asRecord(value, code, "remote Jira issue");
  exactKeys(
    record,
    ["issueId", "issueKey", "projectKey", "version", "correlationId", "marker", "managed", "managedDigest"],
    code,
    "remote Jira issue"
  );
  const marker = normalizeMarker(record.marker, code);
  const managed = normalizeManaged(record.managed, code);
  const correlationId = requireString(record.correlationId, code, "correlationId");
  const projectKey = requireString(record.projectKey, code, "projectKey", PROJECT_KEY);
  const managedDigest = requireDigest(record.managedDigest, code, "managedDigest");
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) {
    throw new JiraConnectorError(code, "remote Jira version is invalid");
  }
  if (marker.correlationId !== correlationId || marker.packageDigest !== managed.package.packageDigest) {
    throw new JiraConnectorError(code, "remote Jira marker does not bind its managed projection");
  }
  return Object.freeze({
    issueId: requireString(record.issueId, code, "issueId"),
    issueKey: requireString(record.issueKey, code, "issueKey"),
    projectKey,
    version: record.version as number,
    correlationId,
    marker,
    managed,
    managedDigest
  });
};

export function buildJiraProjectionPlan(value: unknown): JiraProjectionPlan {
  const code = "VES_JIRA_PROJECTION_INVALID";
  const input = asRecord(value, code, "Jira projection input");
  exactKeys(
    input,
    [
      "schemaVersion",
      "workspaceId",
      "projectKey",
      "correlationId",
      "package",
      "owner",
      "state",
      "currentTaskIds",
      "pendingTaskIds",
      "approvalStatus",
      "workClaim",
      "lastReconciledVersion",
      "canonicalRevisionDigest"
    ],
    code,
    "Jira projection input"
  );
  if (input.schemaVersion !== 1) throw new JiraConnectorError(code, "schemaVersion must be 1");
  const workspaceId = requireString(input.workspaceId, code, "workspaceId");
  const projectKey = requireString(input.projectKey, code, "projectKey", PROJECT_KEY);
  const correlationId = requireString(input.correlationId, code, "correlationId");
  const managed = normalizeManaged(
    {
      package: input.package,
      owner: input.owner,
      state: input.state,
      currentTaskIds: input.currentTaskIds,
      pendingTaskIds: input.pendingTaskIds,
      approvalStatus: input.approvalStatus,
      workClaim: input.workClaim,
      lastReconciledVersion: input.lastReconciledVersion,
      canonicalRevisionDigest: input.canonicalRevisionDigest
    },
    code
  );
  const projectionDigest = sha256({ schemaVersion: 1, workspaceId, projectKey, correlationId, managed });
  const marker = Object.freeze({
    schemaVersion: 1 as const,
    product: "verchestra" as const,
    correlationId,
    packageDigest: managed.package.packageDigest,
    projectionDigest
  });
  const identity = {
    operationKind: "jira.projection.upsert",
    workspaceId,
    logicalTarget: `jira:${projectKey}:${correlationId}`,
    canonicalInputDigest: projectionDigest,
    semanticIdentity: correlationId
  };
  return Object.freeze({
    schemaVersion: 1,
    workspaceId,
    projectKey,
    correlationId,
    managed,
    projectionDigest,
    marker,
    idempotencyKey: buildIdempotencyKey(identity)
  });
}

export function createJiraProjectionIntent(
  plan: JiraProjectionPlan,
  metadata: {
    readonly effectId: string;
    readonly grantRef: string;
    readonly createdAt: string;
    readonly runId?: string;
  }
): EffectIntent {
  return createEffectIntent({
    effectId: metadata.effectId,
    idempotencyKey: plan.idempotencyKey,
    operationKind: "jira.projection.upsert",
    workspaceId: plan.workspaceId,
    logicalTarget: `jira:${plan.projectKey}:${plan.correlationId}`,
    canonicalInputDigest: plan.projectionDigest,
    semanticIdentity: plan.correlationId,
    riskTier: "high",
    grantRef: metadata.grantRef,
    expectedRemoteVersion: String(plan.managed.lastReconciledVersion),
    createdAt: metadata.createdAt,
    ...(metadata.runId === undefined ? {} : { runId: metadata.runId })
  });
}

const issueEvidence = (issue: JiraRemoteIssue, outcome: "applied" | "already-applied"): EffectApplyResult => ({
  outcome,
  remoteIdentity: issue.issueKey,
  remoteVersion: String(issue.version),
  outputDigest: issue.marker.projectionDigest,
  safeEvidenceRefs: Object.freeze([`jira:${issue.issueKey}`, `jira-marker:${issue.marker.correlationId}`])
});

export class JiraProjectionEffectAdapter implements EffectAdapter {
  readonly adapterId = "jira-managed-projection-v1";
  readonly #transport: JiraTransport;
  readonly #plans = new Map<string, JiraProjectionPlan>();

  constructor(options: { readonly transport: JiraTransport }) {
    this.#transport = options.transport;
  }

  register(plan: JiraProjectionPlan): void {
    const current = this.#plans.get(plan.idempotencyKey);
    if (current !== undefined && canonicalJson(current) !== canonicalJson(plan)) {
      throw new JiraConnectorError(
        "VES_JIRA_PLAN_CONFLICT",
        "Idempotency key is already registered to different Jira content"
      );
    }
    this.#plans.set(plan.idempotencyKey, plan);
  }

  async apply(intent: EffectIntent, signal: AbortSignal): Promise<EffectApplyResult> {
    signal.throwIfAborted();
    const plan = this.#requirePlan(intent);
    const observed = await this.#transport.getManaged({
      projectKey: plan.projectKey,
      correlationId: plan.correlationId
    });
    normalizeRate(observed.rate);
    if (observed.issue === undefined) {
      if (plan.managed.lastReconciledVersion !== 0) {
        throw new JiraConnectorError(
          "VES_JIRA_VERSION_CONFLICT",
          "Expected Jira issue is absent at a nonzero canonical version"
        );
      }
      const created = await this.#transport.createManaged({
        projectKey: plan.projectKey,
        correlationId: plan.correlationId,
        marker: plan.marker,
        managed: plan.managed
      });
      normalizeRate(created.rate);
      const issue = normalizeIssue(created.issue);
      this.#assertExactApplied(issue, plan);
      return issueEvidence(issue, "applied");
    }
    const current = normalizeIssue(observed.issue);
    this.#assertTarget(current, plan);
    if (current.marker.projectionDigest === plan.projectionDigest && current.managedDigest === plan.projectionDigest) {
      return issueEvidence(current, "already-applied");
    }
    if (current.managedDigest !== current.marker.projectionDigest) {
      throw new JiraConnectorError(
        "VES_JIRA_MANAGED_DRIFT",
        "Managed Jira fields were edited outside canonical reconciliation"
      );
    }
    if (current.version !== plan.managed.lastReconciledVersion) {
      throw new JiraConnectorError(
        "VES_JIRA_VERSION_CONFLICT",
        "Jira version differs from the last canonical reconciliation"
      );
    }
    const updated = await this.#transport.updateManaged({
      projectKey: plan.projectKey,
      correlationId: plan.correlationId,
      expectedVersion: current.version,
      marker: plan.marker,
      managed: plan.managed
    });
    normalizeRate(updated.rate);
    if (updated.status === "version-conflict") {
      throw new JiraConnectorError("VES_JIRA_VERSION_CONFLICT", "Jira optimistic update lost a concurrent race");
    }
    const issue = normalizeIssue(updated.issue);
    this.#assertExactApplied(issue, plan);
    return issueEvidence(issue, "applied");
  }

  async inspect(intent: EffectIntent): Promise<PriorEffectState> {
    const plan = this.#requirePlan(intent);
    const observed = await this.#transport.getManaged({
      projectKey: plan.projectKey,
      correlationId: plan.correlationId
    });
    normalizeRate(observed.rate);
    if (observed.issue === undefined) return Object.freeze({ state: "not-applied" });
    const issue = normalizeIssue(observed.issue);
    this.#assertTarget(issue, plan);
    if (issue.managedDigest !== issue.marker.projectionDigest) return Object.freeze({ state: "unknown" });
    if (issue.marker.projectionDigest !== plan.projectionDigest) return Object.freeze({ state: "not-applied" });
    return Object.freeze({
      state: "applied",
      remoteIdentity: issue.issueKey,
      remoteVersion: String(issue.version),
      outputDigest: issue.marker.projectionDigest,
      safeEvidenceRefs: Object.freeze([`jira:${issue.issueKey}`, `jira-marker:${issue.marker.correlationId}`])
    });
  }

  #requirePlan(intent: EffectIntent): JiraProjectionPlan {
    const plan = this.#plans.get(intent.idempotencyKey);
    if (
      plan === undefined ||
      intent.operationKind !== "jira.projection.upsert" ||
      intent.canonicalInputDigest !== plan.projectionDigest ||
      intent.semanticIdentity !== plan.correlationId
    ) {
      throw new JiraConnectorError("VES_JIRA_PLAN_MISSING", "Effect intent is not bound to a registered Jira plan");
    }
    return plan;
  }

  #assertTarget(issue: JiraRemoteIssue, plan: JiraProjectionPlan): void {
    if (issue.projectKey !== plan.projectKey || issue.correlationId !== plan.correlationId) {
      throw new JiraConnectorError("VES_JIRA_REMOTE_INVALID", "Jira issue does not match its requested target");
    }
  }

  #assertExactApplied(issue: JiraRemoteIssue, plan: JiraProjectionPlan): void {
    this.#assertTarget(issue, plan);
    if (
      issue.marker.projectionDigest !== plan.projectionDigest ||
      issue.managedDigest !== plan.projectionDigest ||
      canonicalJson(issue.managed) !== canonicalJson(plan.managed)
    ) {
      throw new JiraConnectorError(
        "VES_JIRA_REMOTE_INVALID",
        "Jira write response does not prove the requested projection"
      );
    }
  }
}

export class JiraManagedReadConnector {
  readonly #transport: JiraTransport;

  constructor(options: { readonly transport: JiraTransport }) {
    this.#transport = options.transport;
  }

  async list(value: unknown): Promise<{
    readonly schemaVersion: 1;
    readonly workspaceId: string;
    readonly items: readonly (JiraRemoteIssue & { readonly provenance: "jira-managed-projection" })[];
  }> {
    const code = "VES_JIRA_READ_INVALID";
    const input = asRecord(value, code, "Jira read input");
    exactKeys(
      input,
      ["schemaVersion", "workspaceId", "projectKey", "pageSize", "maximumPages"],
      code,
      "Jira read input"
    );
    if (input.schemaVersion !== 1) throw new JiraConnectorError(code, "schemaVersion must be 1");
    const workspaceId = requireString(input.workspaceId, code, "workspaceId");
    const projectKey = requireString(input.projectKey, code, "projectKey", PROJECT_KEY);
    if (!Number.isSafeInteger(input.pageSize) || (input.pageSize as number) < 1 || (input.pageSize as number) > 100) {
      throw new JiraConnectorError(code, "pageSize must be from 1 through 100");
    }
    if (
      !Number.isSafeInteger(input.maximumPages) ||
      (input.maximumPages as number) < 1 ||
      (input.maximumPages as number) > 100
    ) {
      throw new JiraConnectorError(code, "maximumPages must be from 1 through 100");
    }
    const items: (JiraRemoteIssue & { readonly provenance: "jira-managed-projection" })[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < (input.maximumPages as number); page += 1) {
      const response = await this.#transport.listManaged({
        projectKey,
        ...(cursor === undefined ? {} : { cursor }),
        pageSize: input.pageSize as number
      });
      normalizeRate(response.rate);
      if (!Array.isArray(response.issues))
        throw new JiraConnectorError("VES_JIRA_REMOTE_INVALID", "Jira page issues are invalid");
      for (const candidate of response.issues) {
        const issue = normalizeIssue(candidate);
        if (issue.projectKey !== projectKey)
          throw new JiraConnectorError("VES_JIRA_REMOTE_INVALID", "Jira page crossed project boundary");
        items.push(Object.freeze({ ...issue, provenance: "jira-managed-projection" }));
      }
      if (response.nextCursor === undefined) {
        return Object.freeze({ schemaVersion: 1, workspaceId, items: Object.freeze(items) });
      }
      const next = requireString(response.nextCursor, "VES_JIRA_PAGINATION_INVALID", "nextCursor");
      if (seen.has(next))
        throw new JiraConnectorError("VES_JIRA_PAGINATION_INVALID", "Jira pagination cursor repeated");
      seen.add(next);
      cursor = next;
    }
    throw new JiraConnectorError("VES_JIRA_PAGINATION_LIMIT", "Jira result exceeded the configured page bound");
  }
}

const normalizeClaimOwner = (value: unknown, code: string): JiraClaimOwner => {
  const record = asRecord(value, code, "claim owner");
  exactKeys(record, ["runId", "actorId"], code, "claim owner");
  return Object.freeze({
    runId: requireString(record.runId, code, "owner.runId"),
    actorId: requireString(record.actorId, code, "owner.actorId")
  });
};

const normalizeClaim = (value: unknown): JiraRemoteClaim => {
  const code = "VES_JIRA_CLAIM_REMOTE_INVALID";
  const record = asRecord(value, code, "remote claim");
  const allowed = [
    "schemaVersion",
    "workspaceId",
    "correlationId",
    "claimId",
    "owner",
    "fencingToken",
    "issuedAt",
    "expiresAt",
    "status",
    "version",
    ...(Object.hasOwn(record, "releaseReason") ? ["releaseReason"] : [])
  ];
  exactKeys(record, allowed, code, "remote claim");
  if (record.schemaVersion !== 1) throw new JiraConnectorError(code, "claim schemaVersion must be 1");
  if (!Number.isSafeInteger(record.fencingToken) || (record.fencingToken as number) < 1)
    throw new JiraConnectorError(code, "claim fencingToken is invalid");
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1)
    throw new JiraConnectorError(code, "claim version is invalid");
  const status = requireString(record.status, code, "claim status");
  if (!CLAIM_STATUSES.has(status)) throw new JiraConnectorError(code, "claim status is invalid");
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: requireString(record.workspaceId, code, "claim workspaceId"),
    correlationId: requireString(record.correlationId, code, "claim correlationId"),
    claimId: requireString(record.claimId, code, "claimId"),
    owner: normalizeClaimOwner(record.owner, code),
    fencingToken: record.fencingToken as number,
    issuedAt: requireTimestamp(record.issuedAt, code, "issuedAt"),
    expiresAt: requireTimestamp(record.expiresAt, code, "expiresAt"),
    status: status as "active" | "released",
    ...(record.releaseReason === undefined
      ? {}
      : { releaseReason: requireString(record.releaseReason, code, "releaseReason") }),
    version: record.version as number
  });
};

const sameOwner = (left: JiraClaimOwner, right: JiraClaimOwner): boolean =>
  left.runId === right.runId && left.actorId === right.actorId;

export class JiraClaimConnector {
  readonly #transport: JiraTransport;

  constructor(options: { readonly transport: JiraTransport }) {
    this.#transport = options.transport;
  }

  async acquire(
    value: unknown
  ): Promise<{ readonly status: "acquired" | "conflict"; readonly claim: JiraRemoteClaim }> {
    const code = "VES_JIRA_CLAIM_INVALID";
    const input = asRecord(value, code, "claim acquire input");
    exactKeys(
      input,
      ["schemaVersion", "workspaceId", "correlationId", "owner", "now", "expiresAt"],
      code,
      "claim acquire input"
    );
    if (input.schemaVersion !== 1) throw new JiraConnectorError(code, "schemaVersion must be 1");
    const workspaceId = requireString(input.workspaceId, code, "workspaceId");
    const correlationId = requireString(input.correlationId, code, "correlationId");
    const owner = normalizeClaimOwner(input.owner, code);
    const now = requireTimestamp(input.now, code, "now");
    const expiresAt = requireTimestamp(input.expiresAt, code, "expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(now)) throw new JiraConnectorError(code, "expiresAt must be after now");
    const observed = await this.#transport.readClaim({ correlationId });
    normalizeRate(observed.rate);
    const current = observed.claim === undefined ? undefined : normalizeClaim(observed.claim);
    if (current !== undefined && current.workspaceId !== workspaceId)
      throw new JiraConnectorError("VES_JIRA_CLAIM_REMOTE_INVALID", "claim crossed workspace boundary");
    if (current !== undefined && current.status === "active" && Date.parse(current.expiresAt) > Date.parse(now)) {
      return Object.freeze({ status: sameOwner(current.owner, owner) ? "acquired" : "conflict", claim: current });
    }
    const fencingToken = (current?.fencingToken ?? 0) + 1;
    const candidate = Object.freeze({
      schemaVersion: 1 as const,
      workspaceId,
      correlationId,
      claimId: `jira-claim:${sha256({ workspaceId, correlationId, fencingToken }).slice(7, 31)}`,
      owner,
      fencingToken,
      issuedAt: now,
      expiresAt,
      status: "active" as const
    });
    const result = await this.#transport.compareAndSwapClaim({
      correlationId,
      expectedVersion: current?.version ?? 0,
      claim: candidate
    });
    normalizeRate(result.rate);
    if (result.status === "conflict") {
      if (result.claim === undefined)
        throw new JiraConnectorError("VES_JIRA_CLAIM_CONFLICT", "claim CAS conflicted without current evidence");
      return Object.freeze({ status: "conflict", claim: normalizeClaim(result.claim) });
    }
    return Object.freeze({ status: "acquired", claim: normalizeClaim(result.claim) });
  }

  async heartbeat(value: unknown): Promise<boolean> {
    const requested = normalizeClaim(value);
    if (requested.status !== "active") return false;
    const observed = await this.#transport.readClaim({ correlationId: requested.correlationId });
    normalizeRate(observed.rate);
    if (observed.claim === undefined) return false;
    const current = normalizeClaim(observed.claim);
    if (!this.#sameLease(current, requested)) return false;
    const candidate = { ...current, expiresAt: requested.expiresAt };
    const result = await this.#transport.compareAndSwapClaim({
      correlationId: current.correlationId,
      expectedVersion: current.version,
      claim: this.#withoutVersion(candidate)
    });
    normalizeRate(result.rate);
    return result.status === "updated";
  }

  async release(value: unknown, reason: string): Promise<boolean> {
    const requested = normalizeClaim(value);
    const releaseReason = requireString(reason, "VES_JIRA_CLAIM_INVALID", "release reason");
    const observed = await this.#transport.readClaim({ correlationId: requested.correlationId });
    normalizeRate(observed.rate);
    if (observed.claim === undefined) return false;
    const current = normalizeClaim(observed.claim);
    if (current.status !== "active" || !this.#sameLease(current, requested)) return false;
    const candidate = { ...current, status: "released" as const, releaseReason };
    const result = await this.#transport.compareAndSwapClaim({
      correlationId: current.correlationId,
      expectedVersion: current.version,
      claim: this.#withoutVersion(candidate)
    });
    normalizeRate(result.rate);
    return result.status === "updated";
  }

  #sameLease(current: JiraRemoteClaim, requested: JiraRemoteClaim): boolean {
    return (
      current.workspaceId === requested.workspaceId &&
      current.correlationId === requested.correlationId &&
      current.claimId === requested.claimId &&
      current.fencingToken === requested.fencingToken &&
      sameOwner(current.owner, requested.owner)
    );
  }

  #withoutVersion(claim: JiraRemoteClaim): Omit<JiraRemoteClaim, "version"> {
    return {
      schemaVersion: claim.schemaVersion,
      workspaceId: claim.workspaceId,
      correlationId: claim.correlationId,
      claimId: claim.claimId,
      owner: claim.owner,
      fencingToken: claim.fencingToken,
      issuedAt: claim.issuedAt,
      expiresAt: claim.expiresAt,
      status: claim.status,
      ...(claim.releaseReason === undefined ? {} : { releaseReason: claim.releaseReason })
    };
  }
}
