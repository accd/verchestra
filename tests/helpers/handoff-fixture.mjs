import { createHash } from "node:crypto";

import { PortableHandoffCoordinator } from "../../packages/application/src/index.ts";
import { WorkflowMachine } from "../../packages/domain/src/index.ts";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-512345678901";
export const sourceRunId = "run_018f0b6d-7b1a-7abc-8def-612345678901";
export const successorRunId = "run_018f0b6d-7b1a-7abc-8def-712345678901";

export const prepareInput = (overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  source: {
    runId: sourceRunId,
    runKind: "feature",
    state: "EXECUTION_READY",
    version: 20,
    repairCycles: 0,
    approval: { bindingDigest: sha("source-approval") },
    implementationActorId: "actor:source-implementer"
  },
  successorRunId,
  package: {
    packageRef: "execution-package:001",
    packageDigest: sha("execution-package"),
    sourceStateDigest: sha("source-state")
  },
  currentSourceStateDigest: sha("source-state"),
  semanticObligationsDigest: sha("semantic-obligations"),
  destination: {
    kind: "remote",
    targetRef: "destination:canonical-git",
    destinationDigest: sha("destination")
  },
  claim: { claimRef: "claim:source:001", disposition: "release" },
  ...overrides
});

export const publishInput = (prepared, overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  source: prepared.source,
  handoffRef: prepared.handoffRef,
  handoffDigest: prepared.handoffDigest,
  publicationApproval: {
    approvalRef: "approval:handoff-publication:001",
    approvalDigest: sha("handoff-publication-approval")
  },
  ...overrides
});

export const acceptInput = (published, overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  handoffRef: published.handoffRef,
  handoffDigest: published.handoffDigest,
  capsuleRef: published.capsuleRef,
  capsuleDigest: published.capsuleDigest,
  successorRunId,
  receiver: { actorId: "actor:qwen-implementer", machineProfileRef: "machine-profile:opencode-qwen" },
  currentSourceStateDigest: sha("source-state"),
  ...overrides
});

export const continueInput = (accepted, overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  successor: accepted.successor,
  acceptanceRef: accepted.acceptanceRef,
  acceptanceDigest: accepted.acceptanceDigest,
  currentBindingDigest: accepted.localBindingDigest,
  executionApproval: {
    approvalRef: "approval:execution:receiver:001",
    approvalDigest: sha("receiver-execution-approval"),
    bindingDigest: accepted.localBindingDigest
  },
  ...overrides
});

export function handoffPorts(overrides = {}) {
  const state = {
    calls: [],
    artifacts: new Map(),
    finals: new Map(),
    progress: new Map(),
    acceptances: new Map(),
    continuations: new Map(),
    decisions: [],
    effects: 0,
    claimsDisposed: 0,
    claimsAcquired: 0,
    capsules: 0
  };
  const ports = {
    digest: { sha256: sha },
    packages: {
      verify: async (request) => {
        state.calls.push("package:verify");
        return {
          valid: true,
          workspaceId: request.workspaceId,
          packageRef: request.packageRef,
          packageDigest: request.packageDigest,
          sourceStateDigest: request.sourceStateDigest,
          semanticObligationsDigest: sha("semantic-obligations"),
          packageId: "package:verified:001",
          firstPendingTaskId: "T61",
          pendingTaskIds: ["T61", "T62"],
          requiredRoles: ["implementer", "verifier"],
          requiredSecretNames: ["jira.token"],
          requiredIntegrationNames: ["jira"]
        };
      },
      ...overrides.packages
    },
    artifacts: {
      save: async (artifact) => {
        state.calls.push("artifact:save");
        const handoffDigest = sha(canonical(artifact));
        const receipt = { handoffRef: `handoff:${handoffDigest.slice(-16)}`, handoffDigest };
        state.artifacts.set(receipt.handoffRef, { artifact, ...receipt });
        return receipt;
      },
      open: async ({ handoffRef }) => {
        state.calls.push("artifact:open");
        const stored = state.artifacts.get(handoffRef);
        return stored === undefined ? { valid: false } : { valid: true, ...stored };
      },
      ...overrides.artifacts
    },
    workflow: {
      apply: async (snapshot, command) => {
        state.calls.push(`workflow:${command.type}`);
        const decision = WorkflowMachine.decide(snapshot, command);
        state.decisions.push(decision);
        return decision;
      },
      ...overrides.workflow
    },
    publicationApproval: {
      verify: async () => ({
        valid: true,
        action: "handoff-publication",
        approvalRef: "approval:handoff-publication:001",
        bindingDigest: sha("publication-binding")
      }),
      ...overrides.publicationApproval
    },
    effects: {
      publish: async (request) => {
        state.calls.push("effect:publish");
        state.effects += 1;
        return {
          status: "completed",
          idempotencyKey: request.idempotencyKey,
          receiptRef: "receipt:handoff-publication:001",
          receiptDigest: sha("publication-receipt")
        };
      },
      reconcile: async (request) => ({
        status: "applied",
        idempotencyKey: request.idempotencyKey,
        receiptRef: "receipt:handoff-publication:001",
        receiptDigest: sha("publication-receipt")
      }),
      ...overrides.effects
    },
    claims: {
      dispose: async (request) => {
        state.calls.push(`claim:${request.disposition}`);
        state.claimsDisposed += 1;
        return {
          valid: true,
          claimDispositionRef: "claim-disposition:001",
          claimDispositionDigest: sha("claim-disposition")
        };
      },
      acquire: async () => {
        state.calls.push("claim:acquire");
        state.claimsAcquired += 1;
        return { acquired: true, claimRef: "claim:receiver:001", claimDigest: sha("receiver-claim") };
      },
      ...overrides.claims
    },
    capsules: {
      seal: async (request) => {
        state.calls.push("capsule:seal");
        state.capsules += 1;
        return {
          capsuleRef: "run-capsule:handoff:001",
          capsuleDigest: sha(JSON.stringify(request)),
          status: "HANDED_OFF",
          sourceRunId: request.source.runId,
          successorRunId: request.source.successorRunId,
          packageRef: request.artifact.package.packageRef,
          packageDigest: request.artifact.package.packageDigest,
          receiverApprovalInherited: false
        };
      },
      verify: async (request) => ({
        valid: true,
        status: "HANDED_OFF",
        sourceRunId,
        successorRunId,
        packageRef: request.artifact.package.packageRef,
        packageDigest: request.artifact.package.packageDigest,
        sourceStateDigest: sha("source-state"),
        receiverApprovalInherited: false
      }),
      ...overrides.capsules
    },
    records: {
      loadFinal: async (handoffRef) => state.finals.get(handoffRef),
      loadProgress: async (handoffRef) => state.progress.get(handoffRef),
      saveProgress: async (record) => {
        state.calls.push(`progress:${record.stage}`);
        const saved = { ...record, progressDigest: sha(canonical(record)) };
        state.progress.set(record.handoffRef, saved);
        return saved;
      },
      saveFinal: async (record) => {
        state.calls.push("final:save");
        const final = { ...record, recordRef: "handoff-final:001", recordDigest: sha(JSON.stringify(record)) };
        state.finals.set(record.handoffRef, final);
        return final;
      },
      loadAcceptance: async (handoffRef) => state.acceptances.get(handoffRef),
      loadAcceptanceByRef: async (acceptanceRef) =>
        [...state.acceptances.values()].find((record) => record.acceptanceRef === acceptanceRef),
      saveAcceptance: async (record) => {
        state.calls.push("acceptance:save");
        const saved = {
          ...record,
          acceptanceRef: "handoff-acceptance:001",
          acceptanceDigest: sha(JSON.stringify(record))
        };
        state.acceptances.set(record.handoffRef, saved);
        return saved;
      },
      loadContinuation: async (acceptanceRef) => state.continuations.get(acceptanceRef),
      saveContinuation: async (record) => {
        state.calls.push("continuation:save");
        const saved = { ...record, continuationDigest: sha(JSON.stringify(record)) };
        state.continuations.set(record.acceptanceRef, saved);
        return saved;
      },
      ...overrides.records
    },
    bindings: {
      resolve: async () => {
        state.calls.push("bindings:resolve");
        return {
          ready: true,
          localBindingDigest: sha("receiver-bindings"),
          passportRefs: ["passport:local:implementer", "passport:local:verifier"]
        };
      },
      ...overrides.bindings
    },
    secrets: {
      rebind: async () => {
        state.calls.push("secrets:rebind");
        return { ready: true, bindingDigest: sha("secret-bindings") };
      },
      ...overrides.secrets
    },
    integrations: {
      rebind: async () => {
        state.calls.push("integrations:rebind");
        return { ready: true, bindingDigest: sha("integration-bindings") };
      },
      ...overrides.integrations
    },
    policy: {
      reevaluate: async () => {
        state.calls.push("policy:reevaluate");
        return { allowed: true, policyDigest: sha("receiver-policy"), approvalInvalidated: true };
      },
      ...overrides.policy
    },
    executionApproval: {
      verify: async (request) => ({
        valid: true,
        action: "execution",
        approvalRef: request.approval.approvalRef,
        bindingDigest: request.currentBindingDigest
      }),
      ...overrides.executionApproval
    }
  };
  return { state, ports };
}

export const coordinator = (ports) => new PortableHandoffCoordinator(ports);

export async function preparedFixture(overrides = {}) {
  const fixture = handoffPorts(overrides);
  const prepared = await coordinator(fixture.ports).prepare(prepareInput());
  return { ...fixture, prepared };
}

export async function publishedFixture(overrides = {}) {
  const fixture = await preparedFixture(overrides);
  const published = await coordinator(fixture.ports).publish(publishInput(fixture.prepared));
  return { ...fixture, published };
}
