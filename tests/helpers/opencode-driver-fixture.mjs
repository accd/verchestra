import { fileURLToPath } from "node:url";
import { mockRequest } from "./driver-protocol-fixture.mjs";

export const fakeOpenCodePath = fileURLToPath(
  new URL("../../spikes/opencode-driver/test/fake-opencode.mjs", import.meta.url)
);

export function modelCatalog() {
  return {
    all: [
      {
        id: "company",
        name: "Company AI",
        models: { "qwen3-coder-480b": { id: "qwen3-coder-480b" }, "other-coder": { id: "other-coder" } }
      }
    ],
    connected: ["company"],
    default: { company: "qwen3-coder-480b" }
  };
}

export function fakeOpenCodeFactory(mode = "success", calls = []) {
  return async (options) => {
    calls.push(["server", options]);
    const events = async function* () {
      if (mode === "hang") {
        await new Promise(() => {});
        return;
      }
      if (mode === "malformed") {
        yield { nope: true };
        return;
      }
      if (mode === "foreign") {
        yield {
          type: "message.part.updated",
          properties: {
            sessionID: "foreign-session",
            part: { type: "text", text: "foreign-secret", time: { end: 1 } }
          }
        };
      }
      if (mode === "permission" || mode === "permission-secret")
        yield {
          type: "permission.asked",
          properties: {
            id: "permission-1",
            sessionID: "private-session",
            permission: "vestra_write",
            patterns: ["src/a.ts"],
            metadata: { input: { path: mode === "permission-secret" ? "qualification-secret-value" : "src/a.ts" } }
          }
        };
      if (mode === "secret")
        yield {
          type: "message.part.updated",
          properties: {
            sessionID: "private-session",
            part: { type: "text", text: "value:qualification-secret-value", time: { end: 1 } }
          }
        };
      else if (mode !== "error")
        yield {
          type: "message.part.updated",
          properties: { sessionID: "private-session", part: { type: "text", text: "done", time: { end: 1 } } }
        };
      if (mode === "error")
        yield {
          type: "session.error",
          properties: {
            sessionID: "private-session",
            error: { name: "ProviderError", data: { message: "provider secret failure" } }
          }
        };
      yield {
        type: "message.part.updated",
        properties: {
          sessionID: "private-session",
          part: {
            type: "step-finish",
            tokens: { input: 9, output: 5, reasoning: 2, cache: { read: 4, write: 0 } }
          }
        }
      };
      yield { type: "session.status", properties: { sessionID: "private-session", status: { type: "idle" } } };
    };
    return {
      client: {
        provider: { list: async () => ({ data: modelCatalog() }) },
        event: { subscribe: async () => ({ stream: events() }) },
        session: {
          create: async (parameters) => {
            calls.push(["create", parameters]);
            return { data: { id: "private-session" } };
          },
          prompt: async (parameters) => {
            calls.push(["prompt", parameters]);
            return mode === "prompt-error" ? { error: { message: "prompt rejected" } } : { data: {} };
          },
          abort: async (parameters) => {
            calls.push(["abort", parameters]);
            return { data: true };
          },
          delete: async (parameters) => {
            calls.push(["delete", parameters]);
            return { data: true };
          }
        },
        permission: {
          reply: async (parameters) => {
            calls.push(["permission", parameters]);
            return { data: true };
          }
        }
      },
      server: { close: () => calls.push(["close"]) }
    };
  };
}

export function openCodeFixture(overrides = {}, mode = "success") {
  const calls = [];
  const counters = { resolve: 0 };
  const execution = {
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "company",
      resolvedModel: "qwen3-coder-480b"
    },
    prompt: "private prompt",
    model: "company/qwen3-coder-480b",
    tools: [{ name: "vestra_read", inputSchemaDigest: "sha256:" + "b".repeat(64) }],
    environment: {},
    sensitiveValues: [],
    authorizeTool: async () => false,
    ...overrides
  };
  return {
    calls,
    counters,
    execution,
    request: (requestOverrides = {}) => mockRequest(requestOverrides),
    dependencies: (dependencyOverrides = {}) => ({
      command: [process.execPath, fakeOpenCodePath],
      minimumVersion: "1.17.18",
      serverFactory: fakeOpenCodeFactory(mode, calls),
      resolveExecution: async () => {
        counters.resolve += 1;
        return execution;
      },
      ...dependencyOverrides
    })
  };
}
