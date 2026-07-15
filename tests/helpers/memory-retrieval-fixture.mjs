import { createHash } from "node:crypto";

export const workspaceId = "workspace-alpha";
export const projectId = "project-api";
export const evaluatedAt = "2026-07-15T12:00:00.000Z";
export const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function record(index, override = {}) {
  const content = override.content ?? `memory content ${index}`;
  return {
    workspaceId,
    projectId,
    sourceId: `source-${index}`,
    chunkId: `chunk-${index}`,
    kind: "repository",
    revision: `revision-${index}`,
    retrievedAt: "2026-07-15T11:00:00.000Z",
    validUntil: "2026-07-16T12:00:00.000Z",
    classification: "internal",
    manifestRef: `manifest:${index}`,
    content,
    contentDigest: digest(content),
    state: "active",
    ...override
  };
}

export function lexicalCandidate(value, rank, override = {}) {
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    contentDigest: value.contentDigest,
    rank,
    lexicalScore: -rank,
    ...override
  };
}

export function vectorCandidate(value, rank, override = {}) {
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    contentDigest: value.contentDigest,
    rank,
    distance: rank / 10,
    ...override
  };
}

export function retrievalInput(override = {}) {
  const records = override.records ?? [record(1), record(2), record(3)];
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    query: "refund workflow",
    purpose: "discovery",
    semanticQueryDigest: digest("semantic-query"),
    evaluatedAt,
    limit: 10,
    policy: {
      decision: "allow",
      policyRef: "policy:memory-v1",
      evidenceDigest: digest("policy-evidence"),
      workspaceId,
      projectId,
      purpose: "discovery",
      maximumClassification: "internal",
      maximumAgeSeconds: 86_400,
      semanticMode: "preferred"
    },
    records,
    lexical: {
      generationId: digest("lexical-generation"),
      candidates: records.map((value, index) => lexicalCandidate(value, index + 1))
    },
    vector: {
      status: "ready",
      generationId: digest("vector-generation"),
      candidates: records.map((value, index) => vectorCandidate(value, records.length - index))
    },
    ...override
  };
}

export function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [value, ...tail])
  );
}
