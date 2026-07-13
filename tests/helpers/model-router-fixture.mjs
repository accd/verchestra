import { candidate, machineId, passportId } from "./passport-fixture.mjs";

const IDS = {
  claude: passportId,
  codex: "passport_018f0000-0000-7000-8000-000000001311",
  qwen: "passport_018f0000-0000-7000-8000-000000001312",
  api: "passport_018f0000-0000-7000-8000-000000001313"
};

export { IDS, machineId };

function record(name, overrides = {}) {
  const definitions = {
    claude: {
      passportId: IDS.claude,
      endpointIdentity: { ...candidate().endpointIdentity },
      resolvedModelId: "claude-opus-4-8",
      independenceClass: "anthropic",
      confidence: 0.98,
      capabilities: ["planning", "implementation", "tool-use"]
    },
    codex: {
      passportId: IDS.codex,
      endpointIdentity: {
        ...candidate().endpointIdentity,
        endpointId: "endpoint_018f0000-0000-7000-8000-000000001321",
        providerId: "openai",
        driverId: "codex"
      },
      resolvedModelId: "gpt-5.5-codex",
      independenceClass: "openai",
      confidence: 0.97,
      capabilities: ["planning", "implementation", "validation", "tool-use"]
    },
    qwen: {
      passportId: IDS.qwen,
      endpointIdentity: {
        ...candidate().endpointIdentity,
        endpointId: "endpoint_018f0000-0000-7000-8000-000000001322",
        providerId: "company-qwen",
        driverId: "opencode"
      },
      resolvedModelId: "qwen3-coder-480b",
      independenceClass: "company-qwen",
      confidence: 0.91,
      capabilities: ["implementation", "tool-use"]
    },
    api: {
      passportId: IDS.api,
      endpointIdentity: {
        ...candidate().endpointIdentity,
        endpointId: "endpoint_018f0000-0000-7000-8000-000000001323",
        providerId: "openai-api",
        driverId: "openai-api",
        transport: "remote-api"
      },
      resolvedModelId: "gpt-5.5",
      independenceClass: "openai",
      confidence: 0.96,
      capabilities: ["planning", "implementation", "validation"]
    }
  };
  const selected = definitions[name];
  return {
    ...candidate(),
    ...selected,
    endpointIdentity: selected.endpointIdentity,
    revision: 1,
    schemaVersion: 1,
    requestedModelId: selected.resolvedModelId,
    observedCapabilities: selected.capabilities.map((capability) => ({
      capability,
      supported: true,
      evidenceRef: candidate().evaluationCampaignRef
    })),
    status: "qualified",
    endpointModelIdentityDigest: candidate().evaluationCampaignRef,
    candidateDigest: candidate().evaluationCampaignRef,
    keyId: "passport-key:1",
    signature: "signed",
    ...overrides
  };
}

export const passports = {
  claude: () => record("claude"),
  codex: () => record("codex"),
  qwen: () => record("qwen"),
  api: () => record("api")
};

export function resolver(records) {
  const byId = new Map(records.map((entry) => [entry.passportId, entry]));
  return {
    async machineIndex(id) {
      if (id !== machineId) return undefined;
      return {
        schemaVersion: 1,
        machineId,
        passports: records.map((entry) => ({ passportId: entry.passportId, revision: entry.revision }))
      };
    },
    async current(id) {
      return byId.get(id);
    }
  };
}

export function role(roleId, overrides = {}) {
  return {
    roleId,
    requiredCapabilities: [roleId],
    riskTier: "medium",
    minimumInputTokens: 32000,
    minimumOutputTokens: 4000,
    allowedTransports: ["local-cli", "remote-api"],
    dataHandling: {
      requireTrainingDisabled: true,
      allowedRetention: ["none"],
      allowedRegions: ["local"]
    },
    independence: { mode: "none" },
    preferredProviders: [],
    preferredModels: [],
    ...overrides
  };
}

export function routeInput(roles, overrides = {}) {
  return { machineId, roles, ...overrides };
}
