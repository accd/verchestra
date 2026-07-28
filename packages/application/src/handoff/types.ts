// Structural contracts exchanged across the handoff boundary.

import type { RunSnapshot, WorkflowCommand, WorkflowDecision } from "@verchestra/domain";

import type { Digest, Row } from "./validation.ts";

export interface PackageReference {
  readonly packageRef: string;
  readonly packageDigest: Digest;
  readonly sourceStateDigest: Digest;
}

export interface Destination {
  readonly kind: "local" | "remote";
  readonly targetRef: string;
  readonly destinationDigest: Digest;
}

export interface ClaimPlan {
  readonly claimRef: string;
  readonly disposition: "release" | "transfer";
}

export interface PreparedArtifact {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly handoffId: Digest;
  readonly sourceRunId: string;
  readonly successorRunId: string;
  readonly package: PackageReference;
  readonly packageId: string;
  readonly firstPendingTaskId: string;
  readonly pendingTaskIds: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly requiredSecretNames: readonly string[];
  readonly requiredIntegrationNames: readonly string[];
  readonly semanticObligationsDigest: Digest;
  readonly destination: Destination;
  readonly claim: ClaimPlan;
  readonly receiverApprovalInherited: false;
}

export interface PackageProof {
  readonly workspaceId: string;
  readonly packageRef: string;
  readonly packageDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly semanticObligationsDigest: Digest;
  readonly packageId: string;
  readonly firstPendingTaskId: string;
  readonly pendingTaskIds: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly requiredSecretNames: readonly string[];
  readonly requiredIntegrationNames: readonly string[];
}

export interface HandoffPorts {
  readonly digest: { readonly sha256: (value: string) => string };
  readonly packages: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
  readonly artifacts: {
    readonly save: (artifact: PreparedArtifact) => Promise<unknown>;
    readonly open: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly workflow: {
    readonly apply: (snapshot: RunSnapshot, command: WorkflowCommand) => Promise<WorkflowDecision>;
  };
  readonly publicationApproval: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
  readonly effects: {
    readonly publish: (request: Readonly<Row>) => Promise<unknown>;
    readonly reconcile: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly claims: {
    readonly dispose: (request: Readonly<Row>) => Promise<unknown>;
    readonly acquire: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly capsules: {
    readonly seal: (request: Readonly<Row>) => Promise<unknown>;
    readonly verify: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly records: {
    readonly loadFinal: (handoffRef: string) => Promise<unknown>;
    readonly loadProgress: (handoffRef: string) => Promise<unknown>;
    readonly saveProgress: (record: Readonly<Row>) => Promise<unknown>;
    readonly saveFinal: (record: Readonly<Row>) => Promise<unknown>;
    readonly loadAcceptance: (handoffRef: string) => Promise<unknown>;
    readonly loadAcceptanceByRef: (acceptanceRef: string) => Promise<unknown>;
    readonly saveAcceptance: (record: Readonly<Row>) => Promise<unknown>;
    readonly loadContinuation: (acceptanceRef: string) => Promise<unknown>;
    readonly saveContinuation: (record: Readonly<Row>) => Promise<unknown>;
  };
  readonly bindings: { readonly resolve: (request: Readonly<Row>) => Promise<unknown> };
  readonly secrets: { readonly rebind: (request: Readonly<Row>) => Promise<unknown> };
  readonly integrations: { readonly rebind: (request: Readonly<Row>) => Promise<unknown> };
  readonly policy: { readonly reevaluate: (request: Readonly<Row>) => Promise<unknown> };
  readonly executionApproval: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
}
