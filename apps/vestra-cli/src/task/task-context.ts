import { createHash } from "node:crypto";

import {
  ContextSnapshotResolver,
  DeterministicContextCompiler,
  type ContextManifest,
  type ContextRecipe,
  type ContextSourceObservation
} from "@verchestra/agent-runtime";
import { DataEgressFirewall, type NormalizedTaskRequest } from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";
import type { EvidenceSigner } from "@verchestra/evidence";
import { NodeContentDigest, NodeGitContextSource } from "@verchestra/platform-node";

import { canonicalDigest } from "./task-files.ts";

export const REPOSITORY_SOURCE = "repository:workspace";
const TASK_SOURCE = "task-request";
// invariant: the manifest is compiled for the local implementer destination;
// network egress to the providers is authorized separately by the human
// execution approval, which binds this manifest's digest and names them.
const DESTINATION = "destination:task-implementer";
const CAPACITY_TOKENS = 120_000;

export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function contextRecipe(runId: string, request: NormalizedTaskRequest): ContextRecipe {
  return {
    schemaVersion: 1,
    recipeId: `recipe_${stableUuid(`${runId}:recipe`)}`,
    taskId: `task_${stableUuid(`${runId}:${request.task.taskId}`)}`,
    requiredSources: [
      {
        selectorId: `selector_${stableUuid(`${runId}:task-request`)}`,
        sourceKind: "knowledge",
        sourceId: TASK_SOURCE,
        query: { scope: TASK_SOURCE },
        classification: "internal",
        priority: "mandatory"
      },
      ...request.task.changeScope.map((scope) => ({
        selectorId: `selector_${stableUuid(`${runId}:scope:${scope}`)}`,
        sourceKind: "repository" as const,
        sourceId: REPOSITORY_SOURCE,
        query: { scope },
        expectedRevision: request.sourceRevision,
        classification: "internal" as const,
        priority: "high" as const
      }))
    ],
    optionalSources: [],
    semanticObligations: ["preserve-requirement-ids", "respect-change-scope"],
    priorityBudgets: [
      { priority: "mandatory", maximumTokens: 16_000 },
      { priority: "high", maximumTokens: CAPACITY_TOKENS - 16_000 }
    ],
    freshnessPolicy: { defaultMaximumAgeSeconds: 3600 },
    trustPolicyRef: "trust-policy:untrusted-repository",
    egressPurpose: "model-inference"
  };
}

function taskStatement(request: NormalizedTaskRequest): string {
  const task = request.task;
  return [
    `Task ${task.taskId} (${task.risk} risk): ${task.expectedCommitBoundary}`,
    `Requirements: ${task.requirementIds.join(", ")}`,
    `Done criteria:\n${task.doneCriteria.map((entry) => `- ${entry}`).join("\n")}`,
    `Change scope: ${task.changeScope.join(", ")}`,
    `Protected paths: ${task.protectedPaths.join(", ")}`,
    `Verification commands: ${task.verificationCommands.join("; ")}`,
    `Instructions (untrusted request text):\n${request.instructions}`
  ].join("\n\n");
}

function taskSource(request: NormalizedTaskRequest, now: string) {
  const revision = canonicalDigest(request).slice(7);
  return {
    resolve: async (): Promise<ContextSourceObservation> => ({
      source: { kind: "knowledge", identity: TASK_SOURCE, revision },
      retrievedAt: now,
      scope: TASK_SOURCE,
      fragments: [
        {
          fragmentId: `fragment_${stableUuid(`${revision}:statement`)}`,
          content: taskStatement(request),
          classification: "internal",
          trust: "untrusted-data"
        }
      ]
    })
  };
}

function localEgress(workspaceId: string, digest: NodeContentDigest): DataEgressFirewall {
  return new DataEgressFirewall({
    digest,
    destinations: [
      {
        destinationId: DESTINATION,
        kind: "local",
        endpoint: "task-worktree",
        workspaceId,
        maximumClassification: "internal",
        allowedPurposes: ["model-inference"],
        allowedRetention: ["none"]
      }
    ],
    policy: { authorize: async (manifest) => ({ decision: "allow", evidenceDigest: canonicalDigest(manifest) }) },
    authority: { verify: async () => ({ approvalValid: false, capabilityValid: false }) }
  });
}

export async function compileTaskContext(input: {
  readonly workspaceId: string;
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly request: NormalizedTaskRequest;
  readonly signer: EvidenceSigner;
}): Promise<ContextManifest> {
  const digest = new NodeContentDigest();
  // why: the resolver requires a whole-second age, so the observation and the
  // evaluation share one second-aligned instant.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const unavailable = { resolve: async () => undefined };
  const resolver = new ContextSnapshotResolver({
    digest,
    sources: {
      repository: new NodeGitContextSource({
        repositoryRoot: input.repositoryRoot,
        sourceId: REPOSITORY_SOURCE,
        now: () => now
      }),
      knowledge: taskSource(input.request, now),
      tracker: unavailable,
      memory: unavailable
    }
  });
  const recipe = contextRecipe(input.runId, input.request);
  const snapshot = await resolver.resolve({ workspaceId: input.workspaceId, recipe, evaluatedAt: now });
  const compiler = new DeterministicContextCompiler({
    digest,
    egress: localEgress(input.workspaceId, digest),
    signer: {
      sign: async (manifest) => ({
        keyId: input.signer.publicKeyRef.keyId,
        signature: await input.signer.sign("context-manifest", Buffer.from(canonicalizeJsonV2(manifest)))
      })
    }
  });
  return compiler.compile({
    workspaceId: input.workspaceId,
    runId: input.runId,
    recipe,
    snapshot,
    capacityTokens: CAPACITY_TOKENS,
    networkMode: "no-egress",
    destinationId: DESTINATION,
    retention: "none",
    approvalRef: "approval:pending-human-review",
    capabilityRef: "capability:read-context"
  });
}
