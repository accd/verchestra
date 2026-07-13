import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

export const digest = new NodeContentDigest();
export const workspaceId = "workspace_018f0000-0000-7000-8000-000000001501";
export const runId = "run_018f0000-0000-7000-8000-000000001502";

export function envelope(sequence = 0, overrides = {}) {
  return {
    protocol: "verchestra/1",
    messageId: `message_018f0000-0000-7000-8000-${String(1510 + sequence).padStart(12, "0")}`,
    correlationId: "correlation_018f0000-0000-7000-8000-000000001503",
    workspaceId,
    runId,
    sequence,
    sentAt: "2026-07-13T16:00:00.000Z",
    payloadSchema: { name: "driver-event", version: 1 },
    payload: { type: "content.delta", text: `part-${sequence}` },
    ...overrides
  };
}

export function handshake(overrides = {}) {
  return {
    controller: {
      protocol: "verchestra/1",
      requiredSchemas: ["driver-event@1"],
      supportedSchemas: ["driver-event@1", "driver-request@1"],
      expectedComponent: { id: "driver:mock", digest: digest.sha256("mock-driver") },
      allowedCapabilities: ["stream", "tools"],
      maxMessageBytes: 65536
    },
    worker: {
      protocol: "verchestra/1",
      supportedSchemas: ["driver-event@1", "driver-request@1"],
      component: { id: "driver:mock", digest: digest.sha256("mock-driver") },
      capabilities: ["stream", "tools"],
      maxMessageBytes: 32768
    },
    ...overrides
  };
}

export function mockRequest(overrides = {}) {
  return {
    workspaceId,
    runId,
    passportRef: { passportId: "passport_018f0000-0000-7000-8000-000000001504", revision: 1 },
    serializedContextRef: { manifestId: "sha256:" + "a".repeat(64), target: "mock" },
    tools: [{ name: "vestra_read", inputSchemaDigest: "sha256:" + "b".repeat(64) }],
    ...overrides
  };
}
