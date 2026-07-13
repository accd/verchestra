import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

export const workspaceId = "workspace_018f0000-0000-7000-8000-000000000001";
export const runId = "run_018f0000-0000-7000-8000-000000000002";
export const digest = new NodeContentDigest();

export const destinations = [
  {
    destinationId: "destination:model-api",
    kind: "external",
    endpoint: "https://models.example.test/v1",
    workspaceId,
    maximumClassification: "confidential",
    allowedPurposes: ["model-inference"],
    allowedRetention: ["none", "transient"]
  },
  {
    destinationId: "destination:local-cache",
    kind: "local",
    endpoint: "local://context-cache",
    workspaceId,
    maximumClassification: "secret",
    allowedPurposes: ["context-cache"],
    allowedRetention: ["workspace"]
  }
];

export function source(overrides = {}) {
  return {
    fragmentId: "fragment_018f0000-0000-7000-8000-000000000003",
    workspaceId,
    source: { kind: "tracker", identity: "JIRA-123", revision: "7" },
    retrievedAt: "2026-07-13T12:00:00.000Z",
    classification: "internal",
    trust: "untrusted-data",
    content: "ordinary source content",
    ...overrides
  };
}

export function firewallFixture(overrides = {}) {
  let captured;
  const policy = {
    async authorize(request) {
      captured = request;
      return { decision: "allow", evidenceDigest: `sha256:${"9".repeat(64)}` };
    }
  };
  const authority = { verify: async () => ({ approvalValid: true, capabilityValid: true }) };
  const declassification = { verify: async (evidence) => evidence.signature === "signed" };
  return {
    digest,
    destinations,
    policy,
    authority,
    declassification,
    now: () => "2026-07-13T12:30:00.000Z",
    captured: () => captured,
    ...overrides
  };
}
