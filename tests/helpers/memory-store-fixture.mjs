import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "../../packages/memory/src/index.ts";

export const roots = [];
export const now = "2026-07-15T12:00:00.000Z";
export const later = "2026-07-15T13:00:00.000Z";
export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab";
export const projectId = "project_orders";

export const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function source(sourceId = "source:orders", overrides = {}) {
  const contents = overrides.contents ?? ["Orders are approved before capture.", "Refunds require an audit reason."];
  const { chunks: overrideChunks, ...sourceOverrides } = overrides;
  delete sourceOverrides.contents;
  const chunks = contents.map((content, ordinal) => ({
    chunkId: `${sourceId}:chunk:${ordinal + 1}`,
    ordinal,
    content,
    contentDigest: digest(content)
  }));
  return {
    sourceId,
    kind: "knowledge",
    revision: "rev-1",
    retrievedAt: now,
    validUntil: "2026-07-16T12:00:00.000Z",
    classification: "internal",
    contentDigest: digest(contents.join("\n")),
    chunks,
    ...sourceOverrides,
    chunks: overrideChunks ?? chunks
  };
}

export function batch(sources = [source()], overrides = {}) {
  return {
    schemaVersion: 1,
    workspaceId,
    projectId,
    manifestRef: "artifact:memory/orders-manifest-v1",
    sources,
    ...overrides
  };
}

export async function opened(options = {}) {
  const root = join(tmpdir(), `verchestra-memory-${process.pid}-${randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  const dbPath = join(root, "memory.sqlite");
  const store = new MemoryStore({ dbPath, timeoutMs: 10, now: () => now, ...options });
  const result = store.open();
  return { root, dbPath, store, result };
}

export async function cleanup() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
