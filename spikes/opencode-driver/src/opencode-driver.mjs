import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP"];

function defaultCommand() {
  const executable = path.resolve("node_modules", "opencode-ai", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
  return existsSync(executable) ? [executable] : ["opencode"];
}

function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

function supported(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right || left[0] !== right[0]) return false;
  for (let index = 1; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function redactor(values) {
  const secrets = [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort((a, b) => b.length - a.length);
  return (value) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), String(value));
}

function sanitizeObject(value, redact) {
  if (value === undefined) return undefined;
  return JSON.parse(redact(JSON.stringify(value)));
}

function flattenCatalog(catalog) {
  const connected = new Set(catalog?.connected ?? []);
  return (catalog?.all ?? []).flatMap((provider) => Object.keys(provider.models ?? {}).map((model) => ({
    id: `${provider.id}/${model}`,
    provider: provider.id,
    model,
    connected: connected.has(provider.id),
    isDefault: catalog.default?.[provider.id] === model
  })));
}

async function productionServerFactory(options) {
  const { createOpencode } = await import("@opencode-ai/sdk/v2");
  return createOpencode(options);
}

export class OpenCodeDriver {
  constructor({ command, minimumVersion = "1.17.18", serverFactory = productionServerFactory } = {}) {
    this.command = command ?? defaultCommand();
    this.minimumVersion = minimumVersion;
    this.serverFactory = serverFactory;
  }

  buildEnvironment(explicit = {}) {
    const environment = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    return { ...environment, ...explicit };
  }

  buildFallbackArguments({ model } = {}) {
    const args = [...this.command.slice(1), "run", "--format", "json", "--pure"];
    if (model) args.push("--model", model);
    return args;
  }

  async probe({ environment = {} } = {}) {
    try {
      const { stdout } = await execFileAsync(this.command[0], [...this.command.slice(1), "--version"], { encoding: "utf8", env: this.buildEnvironment(environment), windowsHide: true });
      const version = parseVersion(stdout)?.join(".");
      if (!version || !supported(version, this.minimumVersion)) return { available: false, version, error: { code: "VES_OPENCODE_VERSION_UNSUPPORTED", message: `requires ${this.minimumVersion} within the same major` } };
      return { available: true, version, capabilities: { sdkEvents: true, providerModelDiscovery: true, permissionMediation: true, stdinRunFallback: true } };
    } catch (error) {
      return { available: false, error: { code: "VES_OPENCODE_NOT_AVAILABLE", message: error instanceof Error ? error.message : "OpenCode unavailable" } };
    }
  }

  serverOptions() {
    return { hostname: "127.0.0.1", port: 0, config: { share: "disabled", permission: { "*": "ask" } } };
  }

  async discoverModels() {
    const instance = await this.serverFactory(this.serverOptions());
    try {
      const response = await instance.client.provider.list();
      if (!response.data) return { models: [], error: { code: "VES_OPENCODE_CATALOG_FAILED", message: "OpenCode returned no provider catalog" } };
      return { models: flattenCatalog(response.data) };
    } finally {
      instance.server.close();
    }
  }

  async run({ prompt, model, tools = [], environment = {}, sensitiveValues = [], signal, authorizeTool = async () => false } = {}) {
    const probe = await this.probe({ environment });
    if (!probe.available) return { stopReason: "error", events: [], outputText: "", error: probe.error };
    const redact = redactor(sensitiveValues);
    const instance = await this.serverFactory(this.serverOptions());
    const { client, server } = instance;
    const result = {
      runtime: { id: "opencode-sdk", version: probe.version },
      invocation: { transport: "sdk-loopback", endpoint: "loopback-ephemeral" },
      events: [],
      resolvedModel: undefined,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      outputText: "",
      stopReason: "error"
    };
    let sessionID;
    let aborted = false;
    let finishAbort;
    const abortedPromise = new Promise((resolve) => { finishAbort = resolve; });
    const abort = async () => {
      if (aborted) return;
      aborted = true;
      if (sessionID) await client.session.abort({ sessionID }).catch(() => {});
      finishAbort();
    };
    if (signal?.aborted) await abort(); else signal?.addEventListener("abort", abort, { once: true });

    try {
      const catalogResponse = await client.provider.list();
      const candidate = flattenCatalog(catalogResponse.data).find((entry) => entry.id === model && entry.connected);
      if (!candidate) return { ...result, error: { code: "VES_OPENCODE_MODEL_UNAVAILABLE", message: `no connected Passport candidate for ${model}` } };
      const unmediatedTool = tools.find((name) => !/^vestra_[a-z0-9_]+$/i.test(name));
      if (unmediatedTool) return { ...result, error: { code: "VES_OPENCODE_TOOL_UNMEDIATED", message: `tool must be exposed through the Verchestra effect bridge: ${unmediatedTool}` } };
      result.resolvedModel = { provider: candidate.provider, model: candidate.model };
      result.events.push({ type: "session.started" }, { type: "model.resolved", ...result.resolvedModel });

      const created = await client.session.create({
        model: { providerID: candidate.provider, id: candidate.model },
        permission: [{ permission: "*", pattern: "*", action: "ask" }]
      });
      sessionID = created.data?.id;
      if (!sessionID) throw new Error("OpenCode did not return a session id");
      if (aborted) {
        await client.session.abort({ sessionID }).catch(() => {});
        throw new Error("aborted before prompt");
      }

      const subscribed = await client.event.subscribe();
      const consume = (async () => {
        for await (const event of subscribed.stream) {
          if (!event || typeof event.type !== "string") throw Object.assign(new Error("OpenCode emitted an invalid event envelope"), { code: "VES_OPENCODE_STREAM_INVALID" });
          const properties = event.properties ?? {};
          if (properties.sessionID && properties.sessionID !== sessionID) continue;
          if (event.type === "permission.asked") {
            const request = { type: "tool.requested", id: properties.id, name: properties.permission, patterns: properties.patterns ?? [], input: sanitizeObject(properties.metadata?.input ?? properties.metadata, redact) };
            result.events.push(request);
            const allowed = await authorizeTool(request);
            await client.permission.reply({ requestID: properties.id, reply: allowed ? "once" : "reject" });
          } else if (event.type === "message.part.updated") {
            const part = properties.part ?? {};
            if (part.type === "text" && part.time?.end) {
              const text = redact(part.text ?? "");
              result.outputText += text;
              result.events.push({ type: "content.delta", text });
            } else if (part.type === "step-finish") {
              result.usage = {
                inputTokens: Number(part.tokens?.input ?? 0),
                outputTokens: Number(part.tokens?.output ?? 0),
                reasoningTokens: Number(part.tokens?.reasoning ?? 0),
                cacheReadTokens: Number(part.tokens?.cache?.read ?? 0),
                cacheWriteTokens: Number(part.tokens?.cache?.write ?? 0),
                costUsd: Number(part.cost ?? 0)
              };
            }
          } else if (event.type === "session.error") {
            result.stopReason = "error";
            result.error = { code: "VES_OPENCODE_EXECUTION_FAILED", message: redact(properties.error?.data?.message ?? properties.error?.message ?? properties.error?.name ?? "OpenCode failed") };
          } else if (event.type === "session.status" && properties.status?.type === "idle") {
            result.stopReason = result.error ? "error" : "stop";
            result.events.push({ type: "session.closed" });
            return;
          }
        }
      })();

      const promptResponse = await client.session.prompt({
        sessionID,
        model: { providerID: candidate.provider, modelID: candidate.model },
        tools: Object.fromEntries(tools.map((name) => [name, true])),
        parts: [{ type: "text", text: prompt }]
      });
      if (promptResponse.error) throw new Error(redact(promptResponse.error.message ?? "OpenCode prompt failed"));
      await Promise.race([consume, abortedPromise]);
      if (!aborted) await consume;
    } catch (error) {
      if (!aborted) result.error = { code: error?.code ?? "VES_OPENCODE_PROTOCOL_FAILED", message: redact(error instanceof Error ? error.message : "OpenCode protocol failed") };
    } finally {
      if (sessionID && !aborted) await client.session.delete({ sessionID }).catch(() => {});
      server.close();
      signal?.removeEventListener("abort", abort);
    }
    if (aborted) return { ...result, stopReason: "aborted", error: { code: "VES_OPENCODE_ABORTED", message: "aborted by controller" } };
    if (!result.events.some((event) => event.type === "session.closed") && !result.error) return { ...result, stopReason: "error", error: { code: "VES_OPENCODE_STREAM_INCOMPLETE", message: "OpenCode stream ended without idle status" } };
    return result;
  }
}
