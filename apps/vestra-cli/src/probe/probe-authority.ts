import { createHash, randomUUID } from "node:crypto";

import {
  ApprovalRecorder,
  ApprovalRequester,
  ApprovalVerifier,
  CapabilityBroker,
  type ApprovalIntent,
  type ApprovalRecord,
  type ApprovalRequest,
  type CapabilityGrant,
  type CapabilityRequest
} from "@verchestra/application";
import type { ProbePlan } from "@verchestra/data-probe";
import { FixedClock, IsoInstant, canonicalizeJsonV2, type Clock } from "@verchestra/domain";
import type { EvidenceSigner, TrustRoot } from "@verchestra/evidence";
import { NodeContentDigest, RuntimeAuthorityStore, SystemClock, type RuntimeStore } from "@verchestra/platform-node";
import {
  CedarPolicyAdapter,
  policyViewDigest,
  type CedarRequest,
  type PolicyDecision,
  type PolicyView
} from "@verchestra/policy";

import { approvalSealing, approvalVerification, policyAuthorization } from "../task/task-authority.ts";
import { HUMAN_ACTOR } from "../task/task-plan-record.ts";
import { cedarEngine } from "../task/task-policy.ts";
import { probeError } from "./probe-errors.ts";

export const DATABASE_READ = "database-read";
// invariant: AD-086 (door 3). A probe grant serves one run: it expires 10
// minutes after it is issued and the command revokes it when the run ends.
// The approval it is issued under expires as soon after the review is shown.
export const PROBE_GRANT_LIFETIME_MS = 10 * 60 * 1000;
// why: the review lists door 2 gives a probe no value for; the approval
// surface requires every list to be non-empty.
const NOT_APPLICABLE: readonly string[] = Object.freeze(["not-applicable"]);
// invariant: door 2. A probe compiles no context, so each context digest of
// its binding is the digest of the canonical empty object.
export const EMPTY_CONTEXT_DIGEST = `sha256:${createHash("sha256").update(canonicalizeJsonV2({})).digest("hex")}`;

const CONTEXT = { type: "Record", attributes: { approved: { type: "Boolean" } } } as const;

// invariant: door 3. The built-in probe policy view: an Actor may read a
// Database only under an approval, and nothing else is in it, so a probe
// grant satisfies no task check and a task grant no probe check.
export const PROBE_POLICY_SCHEMA = Object.freeze({
  Vestra: {
    entityTypes: { Actor: {}, Database: {} },
    actions: {
      [DATABASE_READ]: { appliesTo: { principalTypes: ["Actor"], resourceTypes: ["Database"], context: CONTEXT } }
    }
  }
});
export const PROBE_POLICY = `permit(principal, action == Vestra::Action::"database-read", resource) when { context.approved };`;

export interface ProbePolicy {
  readonly view: PolicyView;
  readonly digest: string;
  authorize(request: CedarRequest): PolicyDecision;
}

export async function loadProbePolicy(): Promise<ProbePolicy> {
  const view: PolicyView = Object.freeze({
    schemaVersion: 1,
    generation: 1,
    schema: PROBE_POLICY_SCHEMA,
    layers: Object.freeze({ builtIn: Object.freeze({ databaseRead: PROBE_POLICY }) })
  });
  const adapter = new CedarPolicyAdapter({ engine: await cedarEngine() });
  const validation = adapter.validateView(view);
  if (!validation.valid)
    throw probeError("VES_PROBE_FAILED", { reason: validation.code }, "The probe policy view does not validate");
  return Object.freeze({
    view,
    digest: policyViewDigest(view),
    authorize: (request: CedarRequest) => adapter.authorize({ view, request, entities: [] })
  });
}

// why: what a probe approval binds: the run, the plan made before any grant
// exists, and the worker's approved launch.
export interface ProbeApprovalSubject {
  readonly workspaceId: string;
  readonly runId: string;
  readonly plan: ProbePlan;
  readonly extensionId: string;
  readonly launchDigest: string;
  readonly expiresAt: string;
}

// invariant: door 2 of .specs/features/probe-run/plan.md, literally.
export function probeApprovalIntent(subject: ProbeApprovalSubject, policyDigest: string): ApprovalIntent {
  const { plan } = subject;
  const { bounds } = plan;
  return {
    action: "probe-execution",
    workspaceId: subject.workspaceId,
    runId: subject.runId,
    policyDigest,
    contextRecipeDigest: EMPTY_CONTEXT_DIGEST,
    semanticObligationsDigest: EMPTY_CONTEXT_DIGEST,
    contextManifestDigest: EMPTY_CONTEXT_DIGEST,
    expiresAt: subject.expiresAt,
    review: {
      packageDigest: plan.statementFingerprint,
      sourceStateDigest: plan.registrationDigest,
      scope: [`database:${plan.databaseId}`],
      protectedPaths: NOT_APPLICABLE,
      tasks: NOT_APPLICABLE,
      dataAccess: plan.operation.objects.map((object) => `${object.schema}.${object.name}`),
      capabilities: [DATABASE_READ],
      selectedPassports: [subject.extensionId],
      destinations: NOT_APPLICABLE,
      budgets: [
        `rows:${bounds.rowLimit}`,
        `bytes:${bounds.byteLimit}`,
        `timeout-ms:${bounds.timeoutMs}`,
        `concurrency:${bounds.concurrencyLimit}`
      ],
      claims: NOT_APPLICABLE,
      gates: NOT_APPLICABLE,
      risks: NOT_APPLICABLE,
      assumptions: NOT_APPLICABLE,
      completionCriteria: NOT_APPLICABLE,
      evidenceRefs: [`registration:${plan.registrationDigest}`, `launch:${subject.launchDigest}`]
    }
  };
}

export function probePolicyRequest(approver: string, databaseId: string): CedarRequest {
  return Object.freeze({
    principal: { type: "Vestra::Actor", id: approver },
    action: { type: "Vestra::Action", id: DATABASE_READ },
    resource: { type: "Vestra::Database", id: databaseId },
    context: { approved: true }
  });
}

// invariant: door 3 of .specs/features/probe-run/plan.md, literally: the
// approver reads the database under the recorded approval, constrained to the
// registration, the statement and the worker's launch it was approved for.
export function probeGrantRequest(input: {
  readonly approval: ApprovalRecord;
  readonly subject: Omit<ProbeApprovalSubject, "expiresAt">;
  readonly decision: PolicyDecision;
  readonly issuedAt: IsoInstant;
}): CapabilityRequest {
  const { approval, subject } = input;
  const { plan } = subject;
  const policyRequest = probePolicyRequest(approval.approver.id, plan.databaseId);
  return {
    principal: policyRequest.principal,
    action: policyRequest.action,
    resource: policyRequest.resource,
    workspaceId: subject.workspaceId,
    runId: subject.runId,
    constraints: [
      `databaseId:${plan.databaseId}`,
      `registrationDigest:${plan.registrationDigest}`,
      `statementFingerprint:${plan.statementFingerprint}`,
      `extensionId:${subject.extensionId}`,
      `launchDigest:${subject.launchDigest}`
    ],
    capability: DATABASE_READ,
    expiresAt: input.issuedAt.addMilliseconds(PROBE_GRANT_LIFETIME_MS).value,
    approvalRef: { approvalId: approval.approvalId, bindingDigest: approval.bindingDigest },
    currentApprovalBinding: approval.binding,
    policyDecision: {
      decision: input.decision.decision,
      policyViewDigest: input.decision.policyViewDigest,
      evidenceDigest: input.decision.evidenceDigest
    },
    policyRequest
  };
}

// why: the authority glue of one probe run. It lives in the composition root
// because it joins the runtime store, evidence sealing and Cedar, adapters that
// may not import each other, as TaskAuthority does for a task run.
export class ProbeAuthority {
  readonly #store: RuntimeAuthorityStore;
  readonly #trust: TrustRoot;
  readonly #policy: ProbePolicy;
  readonly #digest = new NodeContentDigest();

  constructor(options: { readonly runtime: RuntimeStore; readonly trust: TrustRoot; readonly policy: ProbePolicy }) {
    this.#store = new RuntimeAuthorityStore(options.runtime);
    this.#trust = options.trust;
    this.#policy = options.policy;
  }

  request(subject: ProbeApprovalSubject): ApprovalRequest {
    const requester = new ApprovalRequester({ digest: this.#digest, clock: new SystemClock(), uuid: randomUUID });
    return requester.request(probeApprovalIntent(subject, this.#policy.digest));
  }

  record(request: ApprovalRequest, signer: EvidenceSigner): Promise<ApprovalRecord> {
    return new ApprovalRecorder({
      store: this.#store,
      digest: this.#digest,
      clock: new SystemClock(),
      artifacts: approvalSealing(signer)
    }).record(request, { kind: "human", id: HUMAN_ACTOR });
  }

  #broker(clock: Clock): CapabilityBroker {
    return new CapabilityBroker({
      store: this.#store,
      digest: this.#digest,
      clock,
      uuid: randomUUID,
      approvals: new ApprovalVerifier({
        store: this.#store,
        digest: this.#digest,
        clock,
        artifacts: approvalVerification(this.#trust)
      }),
      policy: policyAuthorization((request) => this.#policy.authorize(request))
    });
  }

  // why: one instant is the grant's issue time and the start of its lifetime,
  // so it expires exactly PROBE_GRANT_LIFETIME_MS after it is issued.
  grant(approval: ApprovalRecord, subject: Omit<ProbeApprovalSubject, "expiresAt">): Promise<CapabilityGrant> {
    const issuedAt = IsoInstant.fromDate(new Date());
    const decision = this.#policy.authorize(probePolicyRequest(approval.approver.id, subject.plan.databaseId));
    return this.#broker(new FixedClock(issuedAt)).grant(probeGrantRequest({ approval, subject, decision, issuedAt }));
  }

  revoke(grantId: string, reason: string): Promise<boolean> {
    return this.#broker(new SystemClock()).revoke(grantId, reason);
  }
}
