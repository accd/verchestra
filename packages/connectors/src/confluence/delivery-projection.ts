import { createHash } from "node:crypto";

import {
  buildIdempotencyKey,
  createEffectIntent,
  type EffectAdapter,
  type EffectApplyResult,
  type EffectIntent,
  type PriorEffectState,
  type TrustEnvelope
} from "@verchestra/application";
import { DataClassification, IsoInstant, StableId, type DataClassificationValue } from "@verchestra/domain";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9:._/@+\-]{0,511}$/u;
const SPACE = /^[A-Z][A-Z0-9_]{1,31}$/u;
const STATUSES = new Set(["EXECUTION_READY", "IMPLEMENTING", "VALIDATING", "HUMAN_REVIEW", "COMPLETED", "BLOCKED"]);
const START_TOKEN = "<!-- verchestra:delivery:start";
const END_TOKEN = "<!-- verchestra:delivery:end";

export class ConfluenceDeliveryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfluenceDeliveryError";
    this.code = code;
  }
}

type RecordValue = Readonly<Record<string, unknown>> &
  Readonly<{
    schemaVersion?: unknown;
    workspaceId?: unknown;
    runId?: unknown;
    correlationId?: unknown;
    spaceKey?: unknown;
    pageId?: unknown;
    destinationId?: unknown;
    title?: unknown;
    package?: unknown;
    packageRef?: unknown;
    packageDigest?: unknown;
    handoff?: unknown;
    handoffRef?: unknown;
    handoffDigest?: unknown;
    owner?: unknown;
    status?: unknown;
    currentTaskIds?: unknown;
    pendingTaskIds?: unknown;
    approvalRef?: unknown;
    capabilityRef?: unknown;
    classification?: unknown;
    lastReconciledVersion?: unknown;
    lastReconciledSectionDigest?: unknown;
    generatedAt?: unknown;
    page?: unknown;
    rate?: unknown;
    remaining?: unknown;
    retryAfterMs?: unknown;
    version?: unknown;
    body?: unknown;
    allowed?: unknown;
    code?: unknown;
  }>;

export interface ConfluenceDeliveryInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly spaceKey: string;
  readonly pageId: string;
  readonly destinationId: string;
  readonly title: string;
  readonly package: { readonly packageRef: string; readonly packageDigest: string };
  readonly handoff: { readonly handoffRef: string; readonly handoffDigest: string };
  readonly owner: string;
  readonly status: string;
  readonly currentTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
  readonly approvalRef: string;
  readonly capabilityRef: string;
  readonly classification: DataClassificationValue;
  readonly lastReconciledVersion: number;
  readonly lastReconciledSectionDigest: string | null;
  readonly generatedAt: string;
}

export interface ConfluenceDeliveryPlan extends ConfluenceDeliveryInput {
  readonly content: string;
  readonly sectionDigest: string;
  readonly ownedSection: string;
  readonly idempotencyKey: string;
  readonly egressFragment: TrustEnvelope;
}

export type OwnedSectionInspection =
  | { readonly state: "absent" }
  | { readonly state: "invalid" }
  | { readonly state: "drifted"; readonly declaredDigest: string; readonly actualDigest: string }
  | {
      readonly state: "valid";
      readonly sectionDigest: string;
      readonly ownedSection: string;
      readonly prefix: string;
      readonly suffix: string;
    };

export interface ConfluenceDeliveryTransport {
  getDeliveryPage(input: { readonly spaceKey: string; readonly pageId: string }): Promise<unknown>;
  createDeliveryPage(input: {
    readonly spaceKey: string;
    readonly pageId: string;
    readonly title: string;
    readonly body: string;
  }): Promise<unknown>;
  updateDeliveryPage(input: {
    readonly spaceKey: string;
    readonly pageId: string;
    readonly expectedVersion: number;
    readonly body: string;
  }): Promise<unknown>;
}

export interface ConfluenceDeliveryAuthorityPort {
  verify(input: {
    readonly action: "handoff-publication";
    readonly workspaceId: string;
    readonly runId: string;
    readonly approvalRef: string;
    readonly capabilityRef: string;
    readonly destinationId: string;
    readonly packageDigest: string;
    readonly projectionDigest: string;
  }): Promise<{ readonly allowed: boolean }>;
}

export interface ConfluenceDeliveryEgressPort {
  authorize(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly mode: "online";
    readonly fragments: readonly TrustEnvelope[];
    readonly purpose: "handoff-publication";
    readonly destinationId: string;
    readonly retention: "project-lifetime";
    readonly approvalRef: string;
    readonly capabilityRef: string;
  }): Promise<Readonly<Record<string, unknown>> & { readonly allowed: boolean; readonly code: string }>;
}

interface RemotePage {
  readonly spaceKey: string;
  readonly pageId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
}

const record = (value: unknown, code: string, label: string): RecordValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfluenceDeliveryError(code, `${label} must be an object`);
  }
  return value as RecordValue;
};

const exact = (value: RecordValue, keys: readonly string[], code: string, label: string): void => {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new ConfluenceDeliveryError(code, `${label} has missing or unknown fields`);
  }
};

const safe = (value: unknown, code: string, label: string, pattern = SAFE): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw new ConfluenceDeliveryError(code, `${label} is invalid`);
  return value;
};

const text = (value: unknown, code: string, label: string, maximum = 10_000): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximum ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw new ConfluenceDeliveryError(code, `${label} is invalid`);
  }
  return value;
};

const digest = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
};

const list = (value: unknown, code: string, label: string, nonempty: boolean): readonly string[] => {
  if (!Array.isArray(value) || (nonempty && value.length === 0))
    throw new ConfluenceDeliveryError(code, `${label} is invalid`);
  const normalized = value.map((entry, index) => safe(entry, code, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length)
    throw new ConfluenceDeliveryError(code, `${label} contains duplicates`);
  return Object.freeze([...normalized].sort());
};

const pair = (value: unknown, kind: "package" | "handoff", code: string) => {
  const input = record(value, code, kind);
  const ref = `${kind}Ref` as "packageRef" | "handoffRef";
  const dig = `${kind}Digest` as "packageDigest" | "handoffDigest";
  exact(input, [ref, dig], code, kind);
  return Object.freeze({ [ref]: safe(input[ref], code, ref), [dig]: safe(input[dig], code, dig, DIGEST) });
};

const uuidFrom = (value: string): string => {
  const hex = digest(value).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const renderContent = (input: ConfluenceDeliveryInput): string =>
  [
    `## ${input.title}`,
    "",
    `- Package: \`${input.package.packageRef}\` (\`${input.package.packageDigest}\`)`,
    `- Handoff: \`${input.handoff.handoffRef}\` (\`${input.handoff.handoffDigest}\`)`,
    `- Owner: \`${input.owner}\``,
    `- Status: \`${input.status}\``,
    `- Current tasks: ${input.currentTaskIds.map((entry) => `\`${entry}\``).join(", ")}`,
    `- Pending tasks: ${input.pendingTaskIds.map((entry) => `\`${entry}\``).join(", ") || "none"}`,
    `- Generated: \`${input.generatedAt}\``
  ].join("\n");

const renderSection = (correlationId: string, content: string, sectionDigest: string): string =>
  `${START_TOKEN} correlation="${correlationId}" digest="${sectionDigest}" -->\n${content}\n${END_TOKEN} correlation="${correlationId}" -->`;

export function inspectConfluenceOwnedSection(body: string, correlationId: string): OwnedSectionInspection {
  if (!body.includes(START_TOKEN) && !body.includes(END_TOKEN)) return Object.freeze({ state: "absent" });
  const starts = [
    ...body.matchAll(/<!-- verchestra:delivery:start correlation="([^"]+)" digest="(sha256:[a-f0-9]{64})" -->/gu)
  ];
  const ends = [...body.matchAll(/<!-- verchestra:delivery:end correlation="([^"]+)" -->/gu)];
  if (starts.length !== 1 || ends.length !== 1) return Object.freeze({ state: "invalid" });
  const start = starts[0];
  const end = ends[0];
  if (start === undefined || end === undefined || start[1] !== correlationId || end[1] !== correlationId) {
    return Object.freeze({ state: "invalid" });
  }
  const startIndex = start.index;
  const contentStart = startIndex + start[0].length + 1;
  const endIndex = end.index;
  if (
    body.slice(startIndex + start[0].length, contentStart) !== "\n" ||
    endIndex <= contentStart ||
    body[endIndex - 1] !== "\n"
  ) {
    return Object.freeze({ state: "invalid" });
  }
  const content = body.slice(contentStart, endIndex - 1);
  const declaredDigest = start[2] as string;
  const actualDigest = digest(content);
  if (declaredDigest !== actualDigest) return Object.freeze({ state: "drifted", declaredDigest, actualDigest });
  const sectionEnd = endIndex + end[0].length;
  return Object.freeze({
    state: "valid",
    sectionDigest: actualDigest,
    ownedSection: body.slice(startIndex, sectionEnd),
    prefix: body.slice(0, startIndex),
    suffix: body.slice(sectionEnd)
  });
}

export function buildConfluenceDeliveryPlan(value: unknown): ConfluenceDeliveryPlan {
  const code = "VES_CONFLUENCE_DELIVERY_INVALID";
  const input = record(value, code, "delivery input");
  exact(
    input,
    [
      "schemaVersion",
      "workspaceId",
      "runId",
      "correlationId",
      "spaceKey",
      "pageId",
      "destinationId",
      "title",
      "package",
      "handoff",
      "owner",
      "status",
      "currentTaskIds",
      "pendingTaskIds",
      "approvalRef",
      "capabilityRef",
      "classification",
      "lastReconciledVersion",
      "lastReconciledSectionDigest",
      "generatedAt"
    ],
    code,
    "delivery input"
  );
  if (input.schemaVersion !== 1) throw new ConfluenceDeliveryError(code, "schemaVersion must be 1");
  const workspaceId = safe(input.workspaceId, code, "workspaceId");
  const runId = safe(input.runId, code, "runId");
  try {
    StableId.parse(workspaceId, "workspace");
    StableId.parse(runId, "run");
  } catch {
    throw new ConfluenceDeliveryError(code, "Workspace or run identity is invalid");
  }
  const status = safe(input.status, code, "status");
  if (!STATUSES.has(status)) throw new ConfluenceDeliveryError(code, "status is invalid");
  if (!Number.isSafeInteger(input.lastReconciledVersion) || (input.lastReconciledVersion as number) < 0) {
    throw new ConfluenceDeliveryError(code, "lastReconciledVersion is invalid");
  }
  const lastReconciledSectionDigest =
    input.lastReconciledSectionDigest === null
      ? null
      : safe(input.lastReconciledSectionDigest, code, "lastReconciledSectionDigest", DIGEST);
  if (input.lastReconciledVersion === 0 && lastReconciledSectionDigest !== null) {
    throw new ConfluenceDeliveryError(code, "zero remote version cannot bind a prior section digest");
  }
  let generatedAt: string;
  let classification: DataClassificationValue;
  try {
    generatedAt = IsoInstant.parse(safe(input.generatedAt, code, "generatedAt")).value;
    classification = DataClassification.parse(safe(input.classification, code, "classification")).value;
  } catch {
    throw new ConfluenceDeliveryError(code, "classification or generatedAt is invalid");
  }
  const normalized: ConfluenceDeliveryInput = Object.freeze({
    schemaVersion: 1,
    workspaceId,
    runId,
    correlationId: safe(input.correlationId, code, "correlationId"),
    spaceKey: safe(input.spaceKey, code, "spaceKey", SPACE),
    pageId: safe(input.pageId, code, "pageId"),
    destinationId: safe(input.destinationId, code, "destinationId"),
    title: text(input.title, code, "title", 500),
    package: pair(input.package, "package", code) as ConfluenceDeliveryInput["package"],
    handoff: pair(input.handoff, "handoff", code) as ConfluenceDeliveryInput["handoff"],
    owner: safe(input.owner, code, "owner"),
    status,
    currentTaskIds: list(input.currentTaskIds, code, "currentTaskIds", true),
    pendingTaskIds: list(input.pendingTaskIds, code, "pendingTaskIds", false),
    approvalRef: safe(input.approvalRef, code, "approvalRef"),
    capabilityRef: safe(input.capabilityRef, code, "capabilityRef"),
    classification,
    lastReconciledVersion: input.lastReconciledVersion as number,
    lastReconciledSectionDigest,
    generatedAt
  });
  const content = renderContent(normalized);
  const sectionDigest = digest(content);
  const ownedSection = renderSection(normalized.correlationId, content, sectionDigest);
  const identity = {
    operationKind: "confluence.delivery.upsert",
    workspaceId,
    logicalTarget: `confluence:${normalized.spaceKey}:${normalized.pageId}:${normalized.correlationId}`,
    canonicalInputDigest: sectionDigest,
    semanticIdentity: normalized.correlationId
  };
  const egressFragment: TrustEnvelope = Object.freeze({
    schemaVersion: 1,
    fragmentId: `fragment_${uuidFrom(sectionDigest)}`,
    workspaceId,
    source: Object.freeze({ kind: "generated", identity: "verchestra-delivery", revision: sectionDigest }),
    retrievedAt: generatedAt,
    classification,
    trust: "generated-content",
    contentDigest: digest(ownedSection),
    content: ownedSection,
    inputFragmentIds: Object.freeze([])
  });
  return Object.freeze({
    ...normalized,
    content,
    sectionDigest,
    ownedSection,
    idempotencyKey: buildIdempotencyKey(identity),
    egressFragment
  });
}

export function createConfluenceDeliveryIntent(
  plan: ConfluenceDeliveryPlan,
  metadata: { readonly effectId: string; readonly createdAt: string }
): EffectIntent {
  return createEffectIntent({
    effectId: metadata.effectId,
    idempotencyKey: plan.idempotencyKey,
    operationKind: "confluence.delivery.upsert",
    workspaceId: plan.workspaceId,
    runId: plan.runId,
    logicalTarget: `confluence:${plan.spaceKey}:${plan.pageId}:${plan.correlationId}`,
    canonicalInputDigest: plan.sectionDigest,
    semanticIdentity: plan.correlationId,
    riskTier: "high",
    grantRef: plan.capabilityRef,
    expectedRemoteVersion: String(plan.lastReconciledVersion),
    createdAt: metadata.createdAt
  });
}

const normalizeRate = (value: unknown): void => {
  const item = record(value, "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "rate");
  exact(item, ["remaining", "retryAfterMs"], "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "rate");
  if (
    !Number.isSafeInteger(item.remaining) ||
    !Number.isSafeInteger(item.retryAfterMs) ||
    (item.retryAfterMs as number) < 0
  ) {
    throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "rate is invalid");
  }
  if ((item.remaining as number) <= 0)
    throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_RATE_LIMITED", "rate budget is exhausted");
};

const normalizePage = (value: unknown): RemotePage => {
  const code = "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID";
  const item = record(value, code, "delivery page");
  exact(item, ["spaceKey", "pageId", "version", "title", "body"], code, "delivery page");
  if (!Number.isSafeInteger(item.version) || (item.version as number) < 1)
    throw new ConfluenceDeliveryError(code, "page version is invalid");
  return Object.freeze({
    spaceKey: safe(item.spaceKey, code, "spaceKey", SPACE),
    pageId: safe(item.pageId, code, "pageId"),
    version: item.version as number,
    title: text(item.title, code, "title", 500),
    body:
      typeof item.body === "string" && Buffer.byteLength(item.body) <= 2_000_000
        ? item.body
        : (() => {
            throw new ConfluenceDeliveryError(code, "body is invalid");
          })()
  });
};

const evidence = (
  page: RemotePage,
  plan: ConfluenceDeliveryPlan,
  outcome: "applied" | "already-applied"
): EffectApplyResult => ({
  outcome,
  remoteIdentity: `${page.spaceKey}:${page.pageId}`,
  remoteVersion: String(page.version),
  outputDigest: plan.sectionDigest,
  safeEvidenceRefs: Object.freeze([
    `confluence:${page.spaceKey}:${page.pageId}`,
    `confluence-section:${plan.correlationId}`
  ])
});

export class ConfluenceDeliveryEffectAdapter implements EffectAdapter {
  readonly adapterId = "confluence-delivery-v1";
  readonly #transport: ConfluenceDeliveryTransport;
  readonly #authority: ConfluenceDeliveryAuthorityPort;
  readonly #egress: ConfluenceDeliveryEgressPort;
  readonly #plans = new Map<string, ConfluenceDeliveryPlan>();

  constructor(options: {
    readonly transport: ConfluenceDeliveryTransport;
    readonly authority: ConfluenceDeliveryAuthorityPort;
    readonly egress: ConfluenceDeliveryEgressPort;
  }) {
    this.#transport = options.transport;
    this.#authority = options.authority;
    this.#egress = options.egress;
  }

  register(plan: ConfluenceDeliveryPlan): void {
    const current = this.#plans.get(plan.idempotencyKey);
    if (current !== undefined && canonical(current) !== canonical(plan))
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_PLAN_CONFLICT", "plan identity conflict");
    this.#plans.set(plan.idempotencyKey, plan);
  }

  async apply(intent: EffectIntent, signal: AbortSignal): Promise<EffectApplyResult> {
    signal.throwIfAborted();
    const plan = this.#plan(intent);
    const authority = await this.#authority.verify({
      action: "handoff-publication",
      workspaceId: plan.workspaceId,
      runId: plan.runId,
      approvalRef: plan.approvalRef,
      capabilityRef: plan.capabilityRef,
      destinationId: plan.destinationId,
      packageDigest: plan.package.packageDigest,
      projectionDigest: plan.sectionDigest
    });
    if (authority.allowed !== true)
      throw new ConfluenceDeliveryError(
        "VES_CONFLUENCE_DELIVERY_AUTHORITY_DENIED",
        "handoff publication authority denied"
      );
    const egress = await this.#egress.authorize({
      workspaceId: plan.workspaceId,
      runId: plan.runId,
      mode: "online",
      fragments: Object.freeze([plan.egressFragment]),
      purpose: "handoff-publication",
      destinationId: plan.destinationId,
      retention: "project-lifetime",
      approvalRef: plan.approvalRef,
      capabilityRef: plan.capabilityRef
    });
    if (egress.allowed !== true)
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_EGRESS_DENIED", "delivery egress denied");
    const observed = record(
      await this.#transport.getDeliveryPage({ spaceKey: plan.spaceKey, pageId: plan.pageId }),
      "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID",
      "get response"
    );
    exact(observed, ["page", "rate"], "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "get response");
    normalizeRate(observed.rate);
    if (observed.page === undefined) return this.#create(plan);
    const page = normalizePage(observed.page);
    this.#target(page, plan);
    const inspected = inspectConfluenceOwnedSection(page.body, plan.correlationId);
    if (inspected.state === "valid" && inspected.sectionDigest === plan.sectionDigest)
      return evidence(page, plan, "already-applied");
    if (inspected.state === "invalid" || inspected.state === "drifted")
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_DRIFT", "managed section drifted");
    if (
      (inspected.state === "absent" && plan.lastReconciledSectionDigest !== null) ||
      (inspected.state === "valid" &&
        (plan.lastReconciledSectionDigest === null || inspected.sectionDigest !== plan.lastReconciledSectionDigest))
    ) {
      throw new ConfluenceDeliveryError(
        "VES_CONFLUENCE_DELIVERY_DRIFT",
        "managed section differs from the last reconciled digest"
      );
    }
    if (page.version !== plan.lastReconciledVersion)
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_VERSION_CONFLICT", "page version is stale");
    const body =
      inspected.state === "absent"
        ? `${page.body}${page.body.length === 0 || page.body.endsWith("\n") ? "" : "\n"}${plan.ownedSection}`
        : `${inspected.prefix}${plan.ownedSection}${inspected.suffix}`;
    return this.#update(plan, page.version, body);
  }

  async inspect(intent: EffectIntent): Promise<PriorEffectState> {
    const plan = this.#plan(intent);
    const observed = record(
      await this.#transport.getDeliveryPage({ spaceKey: plan.spaceKey, pageId: plan.pageId }),
      "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID",
      "get response"
    );
    exact(observed, ["page", "rate"], "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "get response");
    normalizeRate(observed.rate);
    if (observed.page === undefined) return Object.freeze({ state: "not-applied" });
    const page = normalizePage(observed.page);
    this.#target(page, plan);
    const section = inspectConfluenceOwnedSection(page.body, plan.correlationId);
    if (section.state === "valid" && section.sectionDigest === plan.sectionDigest) {
      return Object.freeze({
        state: "applied",
        remoteIdentity: `${page.spaceKey}:${page.pageId}`,
        remoteVersion: String(page.version),
        outputDigest: plan.sectionDigest
      });
    }
    return Object.freeze({
      state: section.state === "absent" || section.state === "valid" ? "not-applied" : "unknown"
    });
  }

  async #create(plan: ConfluenceDeliveryPlan): Promise<EffectApplyResult> {
    if (plan.lastReconciledVersion !== 0 || plan.lastReconciledSectionDigest !== null)
      throw new ConfluenceDeliveryError(
        "VES_CONFLUENCE_DELIVERY_VERSION_CONFLICT",
        "missing page has nonzero expected version"
      );
    const response = record(
      await this.#transport.createDeliveryPage({
        spaceKey: plan.spaceKey,
        pageId: plan.pageId,
        title: plan.title,
        body: plan.ownedSection
      }),
      "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID",
      "create response"
    );
    exact(response, ["page", "rate"], "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "create response");
    normalizeRate(response.rate);
    const page = normalizePage(response.page);
    this.#exact(page, plan);
    return evidence(page, plan, "applied");
  }

  async #update(plan: ConfluenceDeliveryPlan, expectedVersion: number, body: string): Promise<EffectApplyResult> {
    const response = record(
      await this.#transport.updateDeliveryPage({ spaceKey: plan.spaceKey, pageId: plan.pageId, expectedVersion, body }),
      "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID",
      "update response"
    );
    normalizeRate(response.rate);
    if (response.status === "version-conflict")
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_VERSION_CONFLICT", "page CAS lost");
    exact(response, ["status", "page", "rate"], "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "update response");
    if (response.status !== "updated")
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "update status is invalid");
    const page = normalizePage(response.page);
    this.#exact(page, plan);
    return evidence(page, plan, "applied");
  }

  #plan(intent: EffectIntent): ConfluenceDeliveryPlan {
    const plan = this.#plans.get(intent.idempotencyKey);
    if (
      plan === undefined ||
      intent.operationKind !== "confluence.delivery.upsert" ||
      intent.canonicalInputDigest !== plan.sectionDigest ||
      intent.semanticIdentity !== plan.correlationId
    ) {
      throw new ConfluenceDeliveryError(
        "VES_CONFLUENCE_DELIVERY_PLAN_MISSING",
        "effect is not bound to a delivery plan"
      );
    }
    return plan;
  }

  #target(page: RemotePage, plan: ConfluenceDeliveryPlan): void {
    if (page.spaceKey !== plan.spaceKey || page.pageId !== plan.pageId)
      throw new ConfluenceDeliveryError("VES_CONFLUENCE_DELIVERY_REMOTE_INVALID", "page identity was substituted");
  }

  #exact(page: RemotePage, plan: ConfluenceDeliveryPlan): void {
    this.#target(page, plan);
    const section = inspectConfluenceOwnedSection(page.body, plan.correlationId);
    if (section.state !== "valid" || section.sectionDigest !== plan.sectionDigest)
      throw new ConfluenceDeliveryError(
        "VES_CONFLUENCE_DELIVERY_REMOTE_INVALID",
        "write response does not prove exact section"
      );
  }
}
