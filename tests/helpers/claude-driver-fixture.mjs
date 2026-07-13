import { fileURLToPath } from "node:url";
import { mockRequest } from "./driver-protocol-fixture.mjs";

export const fakeClaudePath = fileURLToPath(
  new URL("../../spikes/claude-code-driver/test/fake-claude.mjs", import.meta.url)
);

export function claudeFixture(overrides = {}) {
  const calls = { resolve: 0, spawn: 0, terminate: 0 };
  const execution = {
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "anthropic",
      resolvedModel: "claude-opus-4-8"
    },
    prompt: "private prompt",
    model: "claude-opus-4-8",
    environment: { FAKE_CLAUDE_MODE: "success" },
    sensitiveValues: [],
    ...overrides
  };
  return {
    calls,
    execution,
    request: (requestOverrides = {}) => mockRequest(requestOverrides),
    dependencies: (dependencyOverrides = {}) => ({
      command: [process.execPath, fakeClaudePath],
      minimumVersion: "2.1.168",
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
