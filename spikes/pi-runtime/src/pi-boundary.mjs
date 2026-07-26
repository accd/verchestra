import { Agent } from "@earendil-works/pi-agent-core";

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
});

function estimatedTokens(systemPrompt, prompt) {
  return Math.ceil((systemPrompt.length + prompt.length) / 4);
}

function baseResult(model) {
  return {
    runtime: { id: "pi", package: "@earendil-works/pi-agent-core", version: "0.82.1" },
    resolvedModel: { api: model.api, provider: model.provider, model: model.id },
    events: [],
    usage: EMPTY_USAGE,
    stopReason: "error",
    outputText: ""
  };
}

function normalizeEvent(event) {
  if (event.type === "agent_start") return { type: "session.started" };
  if (event.type === "agent_end") return { type: "session.closed" };
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    return { type: "content.delta", text: event.assistantMessageEvent.delta };
  }
  if (event.type === "tool_execution_start") {
    return { type: "tool.requested", id: event.toolCallId, name: event.toolName };
  }
  if (event.type === "tool_execution_end") {
    return { type: "tool.completed", id: event.toolCallId, name: event.toolName, isError: event.isError };
  }
  return undefined;
}

function failure(model, code, message, stopReason = "error") {
  return { ...baseResult(model), stopReason, error: { code, message } };
}

export class PiRuntimeBoundary {
  async run({
    prompt,
    model,
    streamFn,
    systemPrompt = "",
    tools = [],
    authorizeTool = async () => ({ allowed: false, reason: "controller authorization required" }),
    signal
  }) {
    if (estimatedTokens(systemPrompt, prompt) + model.maxTokens > model.contextWindow) {
      return failure(model, "VES_PI_CONTEXT_CAPACITY_EXCEEDED", "mandatory context does not fit the resolved model");
    }

    const result = baseResult(model);
    let streamFailure;
    const agent = new Agent({
      initialState: { model, thinkingLevel: "off", systemPrompt, tools, messages: [] },
      streamFn: async (...args) => {
        try {
          return await streamFn(...args);
        } catch (error) {
          streamFailure = error;
          throw error;
        }
      },
      convertToLlm: (messages) => messages,
      beforeToolCall: async ({ toolCall, args }) => {
        const verdict = await authorizeTool({ id: toolCall.id, name: toolCall.name, args });
        return verdict.allowed ? undefined : { block: true, reason: verdict.reason ?? "controller denied" };
      }
    });

    agent.subscribe((event) => {
      const normalized = normalizeEvent(event);
      if (normalized) result.events.push(normalized);
    });

    const abort = () => agent.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    try {
      await agent.prompt(prompt);
      const finalMessage = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
      if (!finalMessage) return failure(model, "VES_PI_RUNTIME_FAILED", "Pi returned no assistant message");

      result.usage = finalMessage.usage;
      result.stopReason = finalMessage.stopReason;
      result.outputText = finalMessage.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("");

      if (finalMessage.stopReason === "aborted") {
        result.error = { code: "VES_PI_ABORTED", message: finalMessage.errorMessage ?? "aborted by controller" };
      } else if (finalMessage.stopReason === "error") {
        result.error = streamFailure
          ? { code: "VES_PI_RUNTIME_FAILED", message: streamFailure instanceof Error ? streamFailure.message : "Pi stream rejected" }
          : { code: "VES_PI_PROVIDER_ERROR", message: finalMessage.errorMessage ?? "provider failed" };
      }
      return result;
    } catch (error) {
      return failure(model, "VES_PI_RUNTIME_FAILED", error instanceof Error ? error.message : "unknown Pi runtime failure");
    } finally {
      signal?.removeEventListener("abort", abort);
      agent.reset();
    }
  }
}
