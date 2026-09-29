import { randomUUID } from "node:crypto";

import {
  ApprovalService,
  CapabilityBroker,
  type ApprovalBinding,
  type ApprovalRecord,
  type CapabilityGrant,
  type ExecutionAuthorityPort,
  type SignedApprovalArtifact
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";
import { ArtifactSealer, type EvidenceSigner, type TrustRoot } from "@verchestra/evidence";
import { NodeContentDigest, RuntimeAuthorityStore, SystemClock, type RuntimeStore } from "@verchestra/platform-node";

import { stateInvalid } from "./task-errors.ts";
import { HUMAN_ACTOR, WRITE_CAPABILITY, type TaskPlanRecord } from "./task-plan-record.ts";
import { policyRequest, type TaskPolicy, type TaskPolicyAction } from "./task-policy.ts";

const APPROVAL_SCHEMA = Object.freeze({ name: "approval-grant", version: 1 });

function approvalBinding(approvalId: string, sourceStateDigest: string) {
  return {
    schema: APPROVAL_SCHEMA,
    purpose: "approval",
    bindingId: approvalId,
    sourceStateDigest: sourceStateDigest.slice(7)
  };
}

export interface TaskAuthorityOptions {
  readonly runtime: RuntimeStore;
  readonly plan: TaskPlanRecord;
  readonly policy: TaskPolicy;
  readonly trust: TrustRoot;
  // why: present only for `approve`, the one command that seals an approval.
  readonly signer?: EvidenceSigner;
}

// why: the Cedar glue between the durable approval, the capability grant, and
// the task policy view. It lives in the composition root because it joins
// three adapters (runtime store, evidence sealing, Cedar) that may not import
// each other.
export class TaskAuthority {
  readonly #plan: TaskPlanRecord;
  readonly #policy: TaskPolicy;
  readonly #store: RuntimeAuthorityStore;
  readonly #approvals: ApprovalService;
  readonly #capabilities: CapabilityBroker;

  constructor(options: TaskAuthorityOptions) {
    this.#plan = options.plan;
    this.#policy = options.policy;
    this.#store = new RuntimeAuthorityStore(options.runtime);
    const sealer = options.signer === undefined ? undefined : new ArtifactSealer({ signer: options.signer });
    const verifier = new ArtifactSealer({
      signer: { publicKeyRef: options.trust.keys[0]!, sign: async () => Promise.reject(new Error("verify only")) }
    });
    const dependencies = {
      store: this.#store,
      digest: new NodeContentDigest(),
      clock: new SystemClock(),
      uuid: randomUUID
    };
    this.#approvals = new ApprovalService({
      ...dependencies,
      artifacts: {
        seal: async (payload) => {
          if (sealer === undefined) throw new Error("This command cannot seal approvals");
          return (await sealer.seal(
            payload as never,
            approvalBinding(payload.approvalId, payload.binding.sourceStateDigest)
          )) as unknown as SignedApprovalArtifact;
        },
        verify: async (artifact) =>
          verifier.verify(artifact as never, options.trust, {
            ...approvalBinding(artifact.payload.approvalId, artifact.payload.binding.sourceStateDigest),
            now: new Date()
          })
      }
    });
    this.#capabilities = new CapabilityBroker({
      ...dependencies,
      approvals: this.#approvals,
      policy: {
        authorize: async (request) => {
          const decision = this.#policy.authorize(request as never);
          return { decision: decision.decision, policyViewDigest: decision.policyViewDigest };
        }
      }
    });
  }

  // invariant: the binding a check compares against is rebuilt from the plan
  // and the policy view in force now, so a changed Workspace policy makes the
  // approval stale instead of silently still valid.
  currentBinding(): ApprovalBinding {
    return this.#approvals.request({ ...this.#plan.approvalIntent, policyDigest: this.#policy.digest }).binding;
  }

  currentBindingDigest(): string {
    return new NodeContentDigest().sha256(canonicalizeJsonV2(this.currentBinding()));
  }

  async record(): Promise<ApprovalRecord> {
    const existing = await this.#store.loadApproval(this.#plan.approvalRequest.approvalId);
    if (existing !== undefined) return existing;
    return this.#approvals.record(this.#plan.approvalRequest, { kind: "human", id: HUMAN_ACTOR });
  }

  async approval(): Promise<{ readonly valid: boolean; readonly bindingDigest?: string; readonly code?: string }> {
    const verified = await this.#approvals.verify(this.#plan.approvalRequest.approvalId, this.currentBinding());
    return verified.valid ? { valid: true, bindingDigest: verified.bindingDigest } : verified;
  }

  decide(action: TaskPolicyAction, approved: boolean, capabilityGranted = false) {
    return this.#policy.decide(action, {
      approved,
      capabilityGranted,
      workspaceId: this.#plan.workspaceId,
      risk: this.#plan.request.task.risk,
      taskId: this.#plan.request.task.taskId
    });
  }

  #invocation(grant: Pick<CapabilityGrant, "grantId">) {
    return {
      grantId: grant.grantId,
      ...this.#grantShape(),
      currentApprovalBinding: this.currentBinding(),
      policyRequest: this.#toolRequest()
    };
  }

  #toolRequest() {
    return policyRequest("tool-effect", {
      approved: true,
      capabilityGranted: true,
      workspaceId: this.#plan.workspaceId,
      risk: this.#plan.request.task.risk,
      taskId: this.#plan.request.task.taskId
    });
  }

  #grantShape() {
    const task = this.#plan.request.task;
    return {
      principal: { type: "Vestra::Actor", id: "task-implementer" },
      action: { type: "Vestra::Action", id: "tool-effect" },
      resource: { type: "Vestra::Task", id: task.taskId },
      workspaceId: this.#plan.workspaceId,
      runId: this.#plan.runId,
      constraints: [
        ...task.changeScope.map((path) => `scope:${path}`),
        ...task.protectedPaths.map((path) => `protected:${path}`)
      ],
      capability: WRITE_CAPABILITY
    };
  }

  // why: the writer capability is granted once per run, only against a
  // currently valid approval and a current Cedar allow; every tool effect then
  // re-proves the same grant, approval, and policy through the broker.
  async grant(expiresAt: string): Promise<CapabilityGrant> {
    const approval = await this.approval();
    if (!approval.valid || approval.bindingDigest === undefined)
      throw stateInvalid(approval.code ?? "VES_APPROVAL_STALE", "The execution approval is not valid");
    const decision = this.#policy.authorize(this.#toolRequest());
    return this.#capabilities.grant({
      ...this.#grantShape(),
      expiresAt,
      approvalRef: { approvalId: this.#plan.approvalRequest.approvalId, bindingDigest: approval.bindingDigest },
      currentApprovalBinding: this.currentBinding(),
      policyDecision: {
        decision: decision.decision,
        policyViewDigest: decision.policyViewDigest,
        evidenceDigest: decision.evidenceDigest
      },
      policyRequest: this.#toolRequest()
    });
  }

  async loadGrant(grantId: string): Promise<CapabilityGrant | undefined> {
    return this.#store.loadGrant(grantId);
  }

  async #granted(grantId: string): Promise<boolean> {
    try {
      return await this.#capabilities.invoke(this.#invocation({ grantId }), async () => true);
    } catch {
      return false;
    }
  }

  executor(grantId: string): ExecutionAuthorityPort {
    return {
      verify: async (_input, phase) => {
        const approval = await this.approval();
        if (!approval.valid) return { authorized: false };
        const granted = phase === "start" ? true : await this.#granted(grantId);
        const decision = this.decide(phase === "start" ? "task-start" : "tool-effect", true, granted);
        return {
          authorized: granted && decision.decision === "allow",
          ...(approval.bindingDigest === undefined ? {} : { bindingDigest: approval.bindingDigest })
        };
      }
    };
  }

  gates() {
    return {
      verify: async () => {
        const approval = await this.approval();
        const allowed = approval.valid && this.decide("gate-commit", true).decision === "allow";
        return {
          authorized: allowed,
          ...(approval.bindingDigest === undefined ? {} : { bindingDigest: approval.bindingDigest }),
          gatePlanDigest: this.#plan.gatePlanDigest
        };
      }
    };
  }
}
