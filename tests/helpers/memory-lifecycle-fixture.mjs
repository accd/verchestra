import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createWritePlan } from "../../packages/workspace/src/index.ts";

export const artifactPlanner = Object.freeze({ createWritePlan });

export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
export const projectId = "project_018f0b6d-7b1a-7abc-8def-0123456789ab";
export const controlOwnerId = `sha256:${"a".repeat(64)}`;
export const childOwnerId = `sha256:${"b".repeat(64)}`;
export const now = "2026-07-15T12:00:00.000Z";
export const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function placementSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    controlOwnerId,
    placementMode: "colocated",
    defaultProjectPlacement: "colocated",
    nestedGitDefault: "centralized",
    requireExplicitNestedRepositoryWrites: true,
    projects: [
      {
        projectId,
        slug: "api",
        sourceLogicalPath: ".",
        gitOwnerId: controlOwnerId,
        gitRelation: "control",
        ignoredByControl: false,
        placement: "inherit",
        nestedWriteAuthorized: false
      }
    ],
    ...overrides
  };
}

export function memoryHit(index = 1, overrides = {}) {
  const content = overrides.content ?? `Reviewed memory ${index}`;
  return {
    rank: index,
    fragmentId: digest(`fragment-${index}`),
    workspaceId,
    projectId,
    sourceId: `source-${index}`,
    chunkId: `chunk-${index}`,
    classification: "internal",
    trust: "untrusted-data",
    content,
    contentDigest: digest(content),
    confidence: 0.9,
    provenance: {
      sourceKind: "repository",
      sourceId: `source-${index}`,
      revision: `revision-${index}`,
      manifestRef: `manifest:${index}`,
      retrievedAt: "2026-07-15T11:00:00.000Z",
      validUntil: "2026-07-16T12:00:00.000Z",
      contentDigest: digest(content),
      lexicalGenerationId: digest("lexical-generation"),
      vectorGenerationId: digest("vector-generation")
    },
    explanation: {
      algorithm: "rrf-v1",
      rrfConstant: 60,
      modalityRanks: { lexical: index, vector: index },
      contributions: { lexical: 0.01, vector: 0.01 },
      providerSignals: { lexicalScore: -index, vectorDistance: index / 10 },
      rrfScore: 0.02,
      freshnessFactor: 1,
      finalScore: 0.02,
      tieBreaker: digest(`fragment-${index}`)
    },
    ...overrides
  };
}

export function promotionInput(overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    title: "Refund policy memory",
    purpose: "canonical-knowledge",
    classification: "internal",
    retrievalSearchId: digest("retrieval-search"),
    fragments: [memoryHit(1), memoryHit(2)],
    target: {
      scope: "project",
      projectId,
      artifactClass: "context",
      logicalName: "promoted/refund-policy.json"
    },
    placement: placementSnapshot(),
    generatorVersion: "1.0.0",
    ...overrides
  };
}

export function approval(plan, overrides = {}) {
  return {
    schemaVersion: 1,
    decision: "approved",
    planId: plan.planId,
    artifactDigest: plan.artifactDigest,
    reviewer: { kind: "human", id: "person:reviewer" },
    reviewedAt: now,
    ...overrides
  };
}

export async function lifecycleRoot() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-memory-lifecycle-"));
  const controlRoot = join(root, "control");
  const objectRoot = join(root, "objects");
  await mkdir(controlRoot, { recursive: true });
  await mkdir(objectRoot, { recursive: true });
  return {
    root,
    controlRoot,
    objectRoot,
    dbPath: join(root, "memory.sqlite"),
    ownerRoots: { [controlOwnerId]: controlRoot },
    artifactPlanner
  };
}

export function objectInput(index, overrides = {}) {
  const content = overrides.content ?? `managed object ${index}`;
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    kind: "cache",
    classification: "internal",
    content,
    contentDigest: digest(content),
    retainUntil: "2026-07-14T12:00:00.000Z",
    protection: "none",
    encryptionKeyRef: null,
    ...overrides
  };
}
