import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

export const digest = new NodeContentDigest();
export const passportId = "passport_018f0000-0000-7000-8000-000000001301";
export const endpointId = "endpoint_018f0000-0000-7000-8000-000000001302";
export const machineId = "machine_018f0000-0000-7000-8000-000000001303";

export function candidate(overrides = {}) {
  return {
    passportId,
    endpointIdentity: {
      endpointId,
      providerId: "anthropic",
      driverId: "claude-code",
      transport: "local-cli",
      locationDigest: digest.sha256("local-claude")
    },
    requestedModelId: "opus",
    resolvedModelId: "claude-opus-4-8",
    providerRevision: "2026-07-01",
    dataHandling: { training: "disabled", retention: "none", region: "local" },
    observedCapabilities: [
      { capability: "planning", supported: true, evidenceRef: digest.sha256("planning") },
      { capability: "tool-use", supported: true, evidenceRef: digest.sha256("tools") }
    ],
    contextCapacity: { maximumInputTokens: 180000, maximumOutputTokens: 32000, evidenceRef: digest.sha256("capacity") },
    driverContractEvidence: [digest.sha256("driver-contract")],
    evaluationCampaignRef: digest.sha256("campaign"),
    eligibleRiskTiers: ["low", "medium", "high"],
    independenceClass: "anthropic",
    confidence: 0.98,
    status: "qualified",
    issuedAt: "2026-07-13T12:00:00.000Z",
    expiresAt: "2026-08-13T12:00:00.000Z",
    ...overrides
  };
}

export function registryFixture(overrides = {}) {
  const signatures = new Map();
  const signer = {
    async sign(payload) {
      const signature = digest.sha256(JSON.stringify(payload));
      signatures.set(signature, JSON.stringify(payload));
      return { keyId: "passport-key:1", signature };
    },
    async verify(record) {
      const { signature, keyId: _keyId, ...payload } = record;
      void _keyId;
      return signatures.get(signature) === JSON.stringify(payload);
    }
  };
  return {
    digest,
    signer,
    now: () => "2026-07-13T13:00:00.000Z",
    ...overrides
  };
}
