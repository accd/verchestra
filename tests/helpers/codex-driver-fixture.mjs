import { fileURLToPath } from "node:url";
import { mockRequest } from "./driver-protocol-fixture.mjs";

export const fakeCodexPath = fileURLToPath(
  new URL("../../spikes/codex-driver/test/fake-codex-app-server.mjs", import.meta.url)
);

export function codexFixture(overrides = {}) {
  const calls = { resolve: 0, spawn: 0, terminate: 0 };
  const execution = {
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "openai",
      resolvedModel: "gpt-5.5-codex"
    },
    prompt: "private prompt",
    model: "gpt-5.5-codex",
    tools: [
      {
        name: "vestra_read",
        description: "Read approved input",
        inputSchema: { type: "object" },
        inputSchemaDigest: "sha256:" + "b".repeat(64)
      }
    ],
    environment: { FAKE_CODEX_MODE: "success" },
    sensitiveValues: [],
    cancelGraceMs: 50,
    ...overrides
  };
  return {
    calls,
    execution,
    request: (requestOverrides = {}) => mockRequest(requestOverrides),
    dependencies: (dependencyOverrides = {}) => ({
      command: [process.execPath, fakeCodexPath],
      minimumVersion: "0.115.0",
      resolveExecution: async () => {
        calls.resolve += 1;
        return execution;
      },
      onSpawn: () => {
        calls.spawn += 1;
      },
      terminateTree: async (pid) => {
        calls.terminate += 1;
        process.kill(pid);
      },
      ...dependencyOverrides
    })
  };
}
