import { createHash } from "node:crypto";

export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";
export const machineId = "machine_018f0b6d-7b1a-7abc-8def-1123456789ab";

export function passport(driverId, providerId, modelId, capabilities, overrides = {}) {
  const suffix = driverId === "claude-code" ? "2123456789ab" : driverId === "codex" ? "3123456789ab" : "4123456789ab";
  return {
    driverId,
    driverVersion: "1.0.0",
    command: driverId,
    passport: {
      passportId: `passport_018f0b6d-7b1a-7abc-8def-${suffix}`,
      revision: "1",
      providerId,
      modelId,
      capabilities,
      qualificationStatus: "qualified",
      validUntil: "2027-01-01T00:00:00.000Z",
      ...overrides
    }
  };
}

export const claude = () => passport("claude-code", "anthropic", "claude-opus", ["plan", "review"]);
export const codex = () => passport("codex", "openai", "gpt-5", ["review"]);
export const qwen = () => passport("opencode", "qwen", "qwen3-coder", ["plan", "review"]);

export function canonicalConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    configVersion: 1,
    minimumCliVersion: "1.0.0",
    workspaceId,
    roles: [
      { roleId: "orchestrator", requiredCapabilities: ["plan"], independence: "none" },
      {
        roleId: "validator",
        requiredCapabilities: ["review"],
        independence: "preferred",
        independentFromRole: "orchestrator"
      }
    ],
    requiredSecrets: [],
    databases: [],
    ...overrides
  };
}

export class MemoryProfileStore {
  profile;
  writes = 0;

  async save(profile) {
    const content = JSON.stringify(profile);
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const changed = this.profile === undefined || JSON.stringify(this.profile) !== content;
    if (changed) {
      this.profile = profile;
      this.writes += 1;
    }
    return { changed, profileDigest: digest };
  }
}

export function serviceOptions(MachineBootstrapService, candidates, options = {}) {
  const store = options.store ?? new MemoryProfileStore();
  const discovery = options.discovery ?? { discover: async () => candidates };
  const bound = new Set(options.boundSecrets ?? []);
  const secrets = options.secrets ?? {
    expectedStore: "OS secret store: verchestra/<workspace>/<logical-name>",
    isBound: async (binding) => bound.has(binding.logicalName)
  };
  return {
    store,
    service: new MachineBootstrapService({
      discovery,
      secrets,
      profiles: store,
      now: () => "2026-07-13T00:00:00.000Z"
    })
  };
}

export const executeInput = (config = canonicalConfig()) => ({
  config,
  installedCliVersion: "1.0.0",
  machineId
});
