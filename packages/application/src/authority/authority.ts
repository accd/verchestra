import { IsoInstant, StableId, type Clock, type UuidSource } from "@verchestra/domain";

import type { ContentDigestPort } from "../sync/workspace-reconcile.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const FORBIDDEN_AUTHORITY = /(?:\*|\binherit(?:ed)?\b)/iu;
const APPROVAL_ACTIONS = ["execution", "handoff-publication", "support-export", "recovery"] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export class AuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthorityError";
    this.code = code;
  }
}

export interface AuthorizedIdentity {
  readonly kind: "human";
  readonly id: string;
}

export interface ApprovalReviewSurface {
  readonly packageDigest: string;
  readonly sourceStateDigest: string;
  readonly scope: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly tasks: readonly string[];
  readonly dataAccess: readonly string[];
  readonly capabilities: readonly string[];
  readonly selectedPassports: readonly string[];
  readonly destinations: readonly string[];
  readonly budgets: readonly string[];
  readonly claims: readonly string[];
  readonly gates: readonly string[];
  readonly risks: readonly string[];
  readonly assumptions: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ApprovalIntent {
  readonly action: ApprovalAction;
  readonly workspaceId: string;
  readonly runId: string;
  readonly policyDigest: string;
  readonly contextRecipeDigest: string;
  readonly semanticObligationsDigest: string;
  readonly contextManifestDigest: string;
  readonly expiresAt: string;
  readonly review: ApprovalReviewSurface;
}

export interface ApprovalBinding {
  readonly workspaceId: string;
  readonly runId: string;
  readonly action: ApprovalAction;
  readonly packageDigest: string;
  readonly sourceStateDigest: string;
  readonly scopeDigest: string;
  readonly protectedPathsDigest: string;
  readonly tasksDigest: string;
  readonly dataAccessDigest: string;
  readonly capabilitiesDigest: string;
  readonly selectedPassportsDigest: string;
  readonly destinationsDigest: string;
  readonly budgetsDigest: string;
  readonly claimsDigest: string;
  readonly gatesDigest: string;
  readonly risksDigest: string;
  readonly assumptionsDigest: string;
  readonly completionCriteriaDigest: string;
  readonly evidenceDigest: string;
  readonly policyDigest: string;
  readonly contextRecipeDigest: string;
  readonly semanticObligationsDigest: string;
  readonly contextManifestDigest: string;
}

export interface ApprovalRequest {
  readonly schemaVersion: 1;
  readonly approvalId: string;
  readonly action: ApprovalAction;
  readonly workspaceId: string;
  readonly runId: string;
  readonly review: ApprovalReviewSurface;
  readonly binding: ApprovalBinding;
  readonly bindingDigest: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalGrantPayload {
  readonly schemaVersion: 1;
  readonly approvalId: string;
  readonly action: ApprovalAction;
  readonly approver: AuthorizedIdentity;
  readonly review: ApprovalReviewSurface;
  readonly binding: ApprovalBinding;
  readonly bindingDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SignedApprovalArtifact {
  readonly artifactId: string;
  readonly signature: string;
  readonly payload: ApprovalGrantPayload;
  readonly [key: string]: unknown;
}

export interface ApprovalRecord extends ApprovalGrantPayload {
  readonly artifact: SignedApprovalArtifact;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface ApprovalArtifactPort {
  seal(payload: ApprovalGrantPayload): Promise<SignedApprovalArtifact>;
  verify(artifact: SignedApprovalArtifact): Promise<{ readonly ok: boolean; readonly code?: string }>;
}

export interface AuthorityStorePort {
  saveApproval(record: ApprovalRecord): Promise<{ readonly created: boolean }>;
  loadApproval(approvalId: string): Promise<ApprovalRecord | undefined>;
  revokeApproval(approvalId: string, revokedAt: string, reason: string): Promise<boolean>;
  saveGrant(record: CapabilityGrant): Promise<{ readonly created: boolean }>;
  loadGrant(grantId: string): Promise<CapabilityGrant | undefined>;
  revokeGrant(grantId: string, revokedAt: string, reason: string): Promise<boolean>;
}

interface AuthorityDependencies {
  readonly store: AuthorityStorePort;
  readonly digest: ContentDigestPort;
  readonly clock: Clock;
  readonly uuid: UuidSource;
  readonly artifacts: ApprovalArtifactPort;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(code: string, message: string): never {
  throw new AuthorityError(code, message);
}

function assertDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) fail("VES_APPROVAL_INPUT_INVALID", `${field} is not a canonical digest`);
}

function assertValue(value: string, field: string, authority = false): void {
  if (!VALUE.test(value) || (authority && FORBIDDEN_AUTHORITY.test(value))) {
    fail(authority ? "VES_CAPABILITY_SCOPE_INVALID" : "VES_APPROVAL_INPUT_INVALID", `${field} is invalid`);
  }
}

function cloneList(values: readonly string[], field: string): readonly string[] {
  if (values.length === 0) fail("VES_APPROVAL_INPUT_INVALID", `${field} must not be empty`);
  for (const value of values) assertValue(value, field);
  return Object.freeze([...values]);
}

function normalizeReview(input: ApprovalReviewSurface): ApprovalReviewSurface {
  assertDigest(input.packageDigest, "packageDigest");
  assertDigest(input.sourceStateDigest, "sourceStateDigest");
  return Object.freeze({
    packageDigest: input.packageDigest,
    sourceStateDigest: input.sourceStateDigest,
    scope: cloneList(input.scope, "scope"),
    protectedPaths: cloneList(input.protectedPaths, "protectedPaths"),
    tasks: cloneList(input.tasks, "tasks"),
    dataAccess: cloneList(input.dataAccess, "dataAccess"),
    capabilities: cloneList(input.capabilities, "capabilities"),
    selectedPassports: cloneList(input.selectedPassports, "selectedPassports"),
    destinations: cloneList(input.destinations, "destinations"),
    budgets: cloneList(input.budgets, "budgets"),
    claims: cloneList(input.claims, "claims"),
    gates: cloneList(input.gates, "gates"),
    risks: cloneList(input.risks, "risks"),
    assumptions: cloneList(input.assumptions, "assumptions"),
    completionCriteria: cloneList(input.completionCriteria, "completionCriteria"),
    evidenceRefs: cloneList(input.evidenceRefs, "evidenceRefs")
  });
}

function bindingFrom(
  intent: ApprovalIntent,
  review: ApprovalReviewSurface,
  digest: ContentDigestPort
): ApprovalBinding {
  if (!APPROVAL_ACTIONS.includes(intent.action)) fail("VES_APPROVAL_INPUT_INVALID", "Approval action is invalid");
  StableId.parse(intent.workspaceId, "workspace");
  StableId.parse(intent.runId, "run");
  for (const [field, value] of [
    ["policyDigest", intent.policyDigest],
    ["contextRecipeDigest", intent.contextRecipeDigest],
    ["semanticObligationsDigest", intent.semanticObligationsDigest],
    ["contextManifestDigest", intent.contextManifestDigest]
  ] as const)
    assertDigest(value, field);
  const listDigest = (value: readonly string[]) => digest.sha256(canonicalJson(value));
  return Object.freeze({
    workspaceId: intent.workspaceId,
    runId: intent.runId,
    action: intent.action,
    packageDigest: review.packageDigest,
    sourceStateDigest: review.sourceStateDigest,
    scopeDigest: listDigest(review.scope),
    protectedPathsDigest: listDigest(review.protectedPaths),
    tasksDigest: listDigest(review.tasks),
    dataAccessDigest: listDigest(review.dataAccess),
    capabilitiesDigest: listDigest(review.capabilities),
    selectedPassportsDigest: listDigest(review.selectedPassports),
    destinationsDigest: listDigest(review.destinations),
    budgetsDigest: listDigest(review.budgets),
    claimsDigest: listDigest(review.claims),
    gatesDigest: listDigest(review.gates),
    risksDigest: listDigest(review.risks),
    assumptionsDigest: listDigest(review.assumptions),
    completionCriteriaDigest: listDigest(review.completionCriteria),
    evidenceDigest: listDigest(review.evidenceRefs),
    policyDigest: intent.policyDigest,
    contextRecipeDigest: intent.contextRecipeDigest,
    semanticObligationsDigest: intent.semanticObligationsDigest,
    contextManifestDigest: intent.contextManifestDigest
  });
}

function expired(expiresAt: string, now: IsoInstant): boolean {
  return IsoInstant.parse(expiresAt).compare(now) <= 0;
}

export class ApprovalService {
  readonly #store: AuthorityStorePort;
  readonly #digest: ContentDigestPort;
  readonly #clock: Clock;
  readonly #uuid: UuidSource;
  readonly #artifacts: ApprovalArtifactPort;

  constructor(dependencies: AuthorityDependencies) {
    this.#store = dependencies.store;
    this.#digest = dependencies.digest;
    this.#clock = dependencies.clock;
    this.#uuid = dependencies.uuid;
    this.#artifacts = dependencies.artifacts;
  }

  request(intent: ApprovalIntent): ApprovalRequest {
    const review = normalizeReview(intent.review);
    const binding = bindingFrom(intent, review, this.#digest);
    IsoInstant.parse(intent.expiresAt);
    const requestedAt = this.#clock.now().value;
    return Object.freeze({
      schemaVersion: 1,
      approvalId: StableId.create("approval", this.#uuid).value,
      action: intent.action,
      workspaceId: intent.workspaceId,
      runId: intent.runId,
      review,
      binding,
      bindingDigest: this.#digest.sha256(canonicalJson(binding)),
      requestedAt,
      expiresAt: intent.expiresAt
    });
  }

  async record(request: ApprovalRequest, approver: AuthorizedIdentity): Promise<ApprovalRecord> {
    if (approver.kind !== "human") fail("VES_APPROVAL_HUMAN_REQUIRED", "Only a human may approve");
    assertValue(approver.id, "approver");
    if (request.bindingDigest !== this.#digest.sha256(canonicalJson(request.binding))) {
      fail("VES_APPROVAL_STALE", "Approval request binding was modified");
    }
    const now = this.#clock.now();
    if (expired(request.expiresAt, now)) fail("VES_APPROVAL_EXPIRED", "Approval request is expired");
    const payload: ApprovalGrantPayload = Object.freeze({
      schemaVersion: 1,
      approvalId: request.approvalId,
      action: request.action,
      approver: Object.freeze({ ...approver }),
      review: request.review,
      binding: request.binding,
      bindingDigest: request.bindingDigest,
      issuedAt: now.value,
      expiresAt: request.expiresAt
    });
    const artifact = await this.#artifacts.seal(payload);
    const record: ApprovalRecord = Object.freeze({ ...payload, artifact });
    if (!(await this.#store.saveApproval(record)).created) {
      fail("VES_APPROVAL_CONFLICT", "Approval identity already exists");
    }
    return record;
  }

  async verify(
    approvalId: string,
    current: ApprovalBinding
  ): Promise<
    | { readonly valid: true; readonly approvalId: string; readonly bindingDigest: string }
    | { readonly valid: false; readonly code: string }
  > {
    const record = await this.#store.loadApproval(approvalId);
    if (record === undefined) return { valid: false, code: "VES_APPROVAL_NOT_FOUND" };
    if (record.revokedAt !== undefined) return { valid: false, code: "VES_APPROVAL_REVOKED" };
    if (expired(record.expiresAt, this.#clock.now())) return { valid: false, code: "VES_APPROVAL_EXPIRED" };
    const verified = await this.#artifacts.verify(record.artifact);
    if (!verified.ok) return { valid: false, code: "VES_APPROVAL_SIGNATURE_INVALID" };
    const reconstructedBinding = bindingFrom(
      {
        action: record.action,
        workspaceId: record.binding.workspaceId,
        runId: record.binding.runId,
        policyDigest: record.binding.policyDigest,
        contextRecipeDigest: record.binding.contextRecipeDigest,
        semanticObligationsDigest: record.binding.semanticObligationsDigest,
        contextManifestDigest: record.binding.contextManifestDigest,
        expiresAt: record.expiresAt,
        review: record.review
      },
      normalizeReview(record.review),
      this.#digest
    );
    if (
      canonicalJson(record.artifact.payload) !==
        canonicalJson({
          schemaVersion: record.schemaVersion,
          approvalId: record.approvalId,
          action: record.action,
          approver: record.approver,
          review: record.review,
          binding: record.binding,
          bindingDigest: record.bindingDigest,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt
        }) ||
      canonicalJson(record.binding) !== canonicalJson(reconstructedBinding) ||
      record.bindingDigest !== this.#digest.sha256(canonicalJson(record.binding)) ||
      record.bindingDigest !== this.#digest.sha256(canonicalJson(current))
    )
      return { valid: false, code: "VES_APPROVAL_STALE" };
    return { valid: true, approvalId, bindingDigest: record.bindingDigest };
  }

  async revoke(approvalId: string, reason: string): Promise<boolean> {
    assertValue(reason, "reason");
    return this.#store.revokeApproval(approvalId, this.#clock.now().value, reason);
  }
}

export interface EntityRef {
  readonly type: string;
  readonly id: string;
}

export interface CapabilityGrant {
  readonly schemaVersion: 1;
  readonly grantId: string;
  readonly principal: EntityRef;
  readonly action: EntityRef;
  readonly resource: EntityRef;
  readonly workspaceId: string;
  readonly runId: string;
  readonly constraints: readonly string[];
  readonly capability: string;
  readonly policyViewDigest: string;
  readonly policyDecisionDigest: string;
  readonly approvalRef: { readonly approvalId: string; readonly bindingDigest: string };
  readonly bindingDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface CapabilityRequest {
  readonly principal: EntityRef;
  readonly action: EntityRef;
  readonly resource: EntityRef;
  readonly workspaceId: string;
  readonly runId: string;
  readonly constraints: readonly string[];
  readonly capability: string;
  readonly expiresAt: string;
  readonly approvalRef: { readonly approvalId: string; readonly bindingDigest: string };
  readonly currentApprovalBinding: ApprovalBinding;
  readonly policyDecision: {
    readonly decision: string;
    readonly policyViewDigest: string;
    readonly evidenceDigest: string;
  };
  readonly policyRequest?: unknown;
}

export interface PolicyAuthorizationPort {
  authorize(request: unknown): Promise<{ readonly decision: string; readonly policyViewDigest: string }>;
}

function entity(value: EntityRef, field: string): EntityRef {
  assertValue(value.type, `${field}.type`, true);
  assertValue(value.id, `${field}.id`, true);
  return Object.freeze({ ...value });
}

function grantMaterial(grant: Omit<CapabilityGrant, "bindingDigest" | "revokedAt" | "revocationReason">) {
  return {
    schemaVersion: grant.schemaVersion,
    grantId: grant.grantId,
    principal: grant.principal,
    action: grant.action,
    resource: grant.resource,
    workspaceId: grant.workspaceId,
    runId: grant.runId,
    constraints: grant.constraints,
    capability: grant.capability,
    policyViewDigest: grant.policyViewDigest,
    policyDecisionDigest: grant.policyDecisionDigest,
    approvalRef: grant.approvalRef,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    nonce: grant.nonce
  };
}

export class CapabilityBroker {
  readonly #store: AuthorityStorePort;
  readonly #digest: ContentDigestPort;
  readonly #clock: Clock;
  readonly #uuid: UuidSource;
  readonly #approvals: ApprovalService;
  readonly #policy: PolicyAuthorizationPort;

  constructor(
    dependencies: Omit<AuthorityDependencies, "artifacts"> & {
      readonly approvals: ApprovalService;
      readonly policy: PolicyAuthorizationPort;
    }
  ) {
    this.#store = dependencies.store;
    this.#digest = dependencies.digest;
    this.#clock = dependencies.clock;
    this.#uuid = dependencies.uuid;
    this.#approvals = dependencies.approvals;
    this.#policy = dependencies.policy;
  }

  async grant(request: CapabilityRequest): Promise<CapabilityGrant> {
    const approval = await this.#approvals.verify(request.approvalRef.approvalId, request.currentApprovalBinding);
    if (!approval.valid || approval.bindingDigest !== request.approvalRef.bindingDigest) {
      fail("VES_CAPABILITY_APPROVAL_INVALID", "Capability requires a current exact Approval");
    }
    const approvalRecord = await this.#store.loadApproval(request.approvalRef.approvalId);
    if (approvalRecord === undefined || !approvalRecord.review.capabilities.includes(request.capability)) {
      fail("VES_CAPABILITY_APPROVAL_INVALID", "Capability is absent from the signed review surface");
    }
    const principal = entity(request.principal, "principal");
    const action = entity(request.action, "action");
    const resource = entity(request.resource, "resource");
    StableId.parse(request.workspaceId, "workspace");
    StableId.parse(request.runId, "run");
    const constraints = Object.freeze(
      request.constraints.map((value) => (assertValue(value, "constraint", true), value))
    );
    assertValue(request.capability, "capability", true);
    if (constraints.length === 0) fail("VES_CAPABILITY_SCOPE_INVALID", "Capability constraints must be explicit");
    IsoInstant.parse(request.expiresAt);
    const now = this.#clock.now();
    if (expired(request.expiresAt, now)) fail("VES_CAPABILITY_EXPIRED", "Capability expiry is not in the future");
    if (
      request.policyDecision.decision !== "allow" ||
      request.policyDecision.policyViewDigest !== request.currentApprovalBinding.policyDigest
    )
      fail("VES_CAPABILITY_POLICY_DENIED", "Policy evidence does not authorize the grant");
    assertDigest(request.policyDecision.evidenceDigest, "policyDecision.evidenceDigest");
    const currentPolicy = await this.#policy.authorize(request.policyRequest ?? {});
    if (
      currentPolicy.decision !== "allow" ||
      currentPolicy.policyViewDigest !== request.policyDecision.policyViewDigest
    )
      fail("VES_CAPABILITY_POLICY_DENIED", "Current policy does not authorize the grant");
    const base = Object.freeze({
      schemaVersion: 1 as const,
      grantId: StableId.create("grant", this.#uuid).value,
      principal,
      action,
      resource,
      workspaceId: request.workspaceId,
      runId: request.runId,
      constraints,
      capability: request.capability,
      policyViewDigest: request.policyDecision.policyViewDigest,
      policyDecisionDigest: request.policyDecision.evidenceDigest,
      approvalRef: Object.freeze({ ...request.approvalRef }),
      issuedAt: now.value,
      expiresAt: request.expiresAt,
      nonce: StableId.create("nonce", this.#uuid).value
    });
    const grant: CapabilityGrant = Object.freeze({
      ...base,
      bindingDigest: this.#digest.sha256(canonicalJson(grantMaterial(base)))
    });
    if (!(await this.#store.saveGrant(grant)).created) fail("VES_CAPABILITY_CONFLICT", "Grant identity exists");
    return grant;
  }

  async invoke<T>(
    invocation: {
      readonly grantId: string;
      readonly principal: EntityRef;
      readonly action: EntityRef;
      readonly resource: EntityRef;
      readonly workspaceId: string;
      readonly runId: string;
      readonly constraints: readonly string[];
      readonly capability: string;
      readonly currentApprovalBinding: ApprovalBinding;
      readonly policyRequest: unknown;
    },
    operation: () => Promise<T>
  ): Promise<T> {
    const grant = await this.#store.loadGrant(invocation.grantId);
    if (grant === undefined) fail("VES_CAPABILITY_NOT_FOUND", "Capability Grant was not found");
    if (grant.revokedAt !== undefined) fail("VES_CAPABILITY_REVOKED", "Capability Grant is revoked");
    if (expired(grant.expiresAt, this.#clock.now())) fail("VES_CAPABILITY_EXPIRED", "Capability Grant is expired");
    const exact =
      canonicalJson(grant.principal) === canonicalJson(invocation.principal) &&
      canonicalJson(grant.action) === canonicalJson(invocation.action) &&
      canonicalJson(grant.resource) === canonicalJson(invocation.resource) &&
      grant.workspaceId === invocation.workspaceId &&
      grant.runId === invocation.runId &&
      canonicalJson(grant.constraints) === canonicalJson(invocation.constraints);
    const exactCapability = grant.capability === invocation.capability;
    if (!exact || !exactCapability)
      fail("VES_CAPABILITY_BINDING_MISMATCH", "Invocation does not match the exact grant");
    if (grant.bindingDigest !== this.#digest.sha256(canonicalJson(grantMaterial(grant)))) {
      fail("VES_CAPABILITY_BINDING_MISMATCH", "Capability Grant integrity failed");
    }
    const approval = await this.#approvals.verify(grant.approvalRef.approvalId, invocation.currentApprovalBinding);
    if (!approval.valid || approval.bindingDigest !== grant.approvalRef.bindingDigest) {
      fail("VES_CAPABILITY_APPROVAL_INVALID", "Approval is no longer valid");
    }
    const policy = await this.#policy.authorize(invocation.policyRequest);
    if (policy.decision !== "allow" || policy.policyViewDigest !== grant.policyViewDigest) {
      fail("VES_CAPABILITY_POLICY_DENIED", "Current policy no longer authorizes invocation");
    }
    return operation();
  }

  async revoke(grantId: string, reason: string): Promise<boolean> {
    assertValue(reason, "reason");
    return this.#store.revokeGrant(grantId, this.#clock.now().value, reason);
  }
}
