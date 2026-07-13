import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../../packages/platform-node/src/index.ts";

export const roots = [];
export const runId = "run_018f0b6d-7b1a-7abc-8def-0123456789ab";
export const bindingDigest = `sha256:${"a".repeat(64)}`;
export const rawDigest = "a".repeat(64);
export const now = "2026-07-13T12:00:00.000Z";

export async function opened(options = {}) {
  const root = join(tmpdir(), `verchestra-runtime-${process.pid}-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  const dbPath = join(root, "runtime.sqlite");
  const store = new RuntimeStore({ dbPath, timeoutMs: 10, now: () => now, ...options });
  const result = store.open();
  return { root, dbPath, store, result };
}

export async function cleanup() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export function run(state = "CREATED", version = 0) {
  return {
    runId,
    runKind: "feature",
    state,
    version,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false
  };
}

export function transition(previous = "CREATED", next = "READY", version = 1) {
  const snapshot = run(next, version);
  return {
    accepted: true,
    previousState: previous,
    nextState: next,
    version,
    events: [
      { type: "READY_WITHOUT_INTAKE_ACCEPTED", previousState: previous, nextState: next, expectedVersion: version - 1 }
    ],
    snapshot
  };
}

export function event(eventId = "event_018f0b6d-7b1a-7abc-8def-2123456789ab") {
  return {
    eventId,
    payloadDigest: rawDigest,
    actor: { kind: "system", id: "controller:local" },
    occurredAt: now
  };
}
