import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { normalizeDeclaredSet } from "@verchestra/domain";

import {
  DriverProtocolError,
  validateDriverStartRequest,
  type Driver,
  type DriverEvent,
  type DriverSessionRef,
  type DriverStartRequest
} from "./index.ts";

const execFileAsync = promisify(execFile);
const SAFE_ENV_KEYS = ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP"] as const;

interface OpenCodeInstance {
  readonly client: {
    readonly provider: { list(): Promise<{ data?: unknown }> };
    readonly event: { subscribe(): Promise<{ stream: AsyncIterable<unknown> }> };
    readonly session: {
      create(parameters: unknown): Promise<{ data?: { id?: string } }>;
      prompt(parameters: unknown): Promise<{ error?: { message?: string }; data?: unknown }>;
      abort(parameters: { sessionID: string }): Promise<unknown>;
      delete(parameters: { sessionID: string }): Promise<unknown>;
    };
    readonly permission: {
      reply(parameters: { requestID: string; reply: "once" | "reject" }): Promise<unknown>;
    };
  };
  readonly server: { close(): void };
}

type OpenCodeServerFactory = (options: Readonly<Record<string, unknown>>) => Promise<OpenCodeInstance>;

export interface OpenCodeExecution {
  readonly passport: {
    readonly passportId: string;
    readonly revision: number;
    readonly provider: string;
    readonly resolvedModel: string;
  };
  readonly prompt: string;
  readonly model: string;
  readonly tools: readonly { readonly name: string; readonly inputSchemaDigest: string }[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly sensitiveValues?: readonly string[];
  readonly authorizeTool: (request: {
    readonly toolCallId: string;
    readonly name: string;
    readonly input: unknown;
    readonly patterns: readonly string[];
  }) => Promise<boolean>;
}

export interface OpenCodeDriverDependencies {
  readonly resolveExecution: (request: DriverStartRequest) => Promise<OpenCodeExecution>;
  readonly command?: readonly string[];
  readonly minimumVersion?: string;
  readonly probeEnvironment?: Readonly<Record<string, string>>;
  readonly serverFactory?: OpenCodeServerFactory;
}

interface OpenCodeSession {
  readonly sink: (event: DriverEvent) => void;
  sequence: number;
  outcome: "completed" | "failed" | "cancelled";
  closed: boolean;
}

interface CatalogModel {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly connected: boolean;
  readonly isDefault: boolean;
}

function openCodeError(code: string, message: string): DriverProtocolError {
  return new DriverProtocolError(code, message);
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function supported(actual: string, minimum: string): boolean {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (left === undefined || right === undefined || left[0] !== right[0]) return false;
  if (left[1] !== right[1]) return left[1] > right[1];
  return left[2] >= right[2];
}

function redactor(values: readonly string[]): (value: unknown) => string {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length
  );
  return (value) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), String(value));
}

function sanitize(value: unknown, redact: (value: unknown) => string): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(redact(JSON.stringify(value))) as unknown;
}

function flattenCatalog(value: unknown): readonly CatalogModel[] {
  const catalog = value as {
    connected?: unknown;
    all?: unknown;
    default?: unknown;
  };
  const connected = new Set(
    Array.isArray(catalog?.connected)
      ? catalog.connected.filter((entry): entry is string => typeof entry === "string")
      : []
  );
  const defaults =
    catalog?.default !== null && typeof catalog?.default === "object"
      ? (catalog.default as Record<string, unknown>)
      : {};
  if (!Array.isArray(catalog?.all)) return Object.freeze([]);
  const models: CatalogModel[] = [];
  for (const rawProvider of catalog.all) {
    if (rawProvider === null || typeof rawProvider !== "object") continue;
    const provider = rawProvider as Record<string, unknown>;
    if (typeof provider["id"] !== "string" || provider["models"] === null || typeof provider["models"] !== "object")
      continue;
    for (const model of Object.keys(provider["models"] as Record<string, unknown>))
      models.push(
        Object.freeze({
          id: `${provider["id"]}/${model}`,
          provider: provider["id"],
          model,
          connected: connected.has(provider["id"]),
          isDefault: defaults[provider["id"]] === model
        })
      );
  }
  // Declared-set ordering by UTF-16 code unit, not localeCompare (issue #58).
  // This order is the portable one: `discoverModels()` hands the whole array
  // back across the driver boundary, and `start()` resolves a model out of the
  // same flattened catalog, so an ambient locale that collated
  // `provider/model` identifiers differently -- punctuation-heavy strings like
  // `openai/gpt-4` versus `openai/gpt4`, where locale collation may ignore the
  // separator entirely -- would make the same OpenCode installation report a
  // different catalog on a different machine.
  return Object.freeze(normalizeDeclaredSet(models, (entry) => entry.id));
}

async function productionServerFactory(options: Readonly<Record<string, unknown>>): Promise<OpenCodeInstance> {
  const command = options["command"];
  const environment = options["environment"];
  const hostname = options["hostname"];
  const port = options["port"];
  const config = options["config"];
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((entry) => typeof entry !== "string") ||
    environment === null ||
    typeof environment !== "object" ||
    typeof hostname !== "string" ||
    typeof port !== "number"
  )
    throw openCodeError("VES_OPENCODE_SERVER_INVALID", "OpenCode isolated server configuration is invalid");
  const child = spawn(
    command[0] as string,
    [...command.slice(1), "serve", `--hostname=${hostname}`, `--port=${port}`],
    {
      env: { ...(environment as NodeJS.ProcessEnv), OPENCODE_CONFIG_CONTENT: JSON.stringify(config ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(openCodeError("VES_OPENCODE_SERVER_TIMEOUT", "OpenCode server timed out")),
      5_000
    );
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 65_536) {
        clearTimeout(timeout);
        reject(openCodeError("VES_OPENCODE_SERVER_OUTPUT_LIMIT", "OpenCode server output exceeded its limit"));
        return;
      }
      for (const line of output.split(/\r?\n/u)) {
        const match = /^opencode server listening.*on\s+(https?:\/\/[^\s]+)$/u.exec(line.trim());
        if (match?.[1] !== undefined) {
          clearTimeout(timeout);
          resolve(match[1]);
          return;
        }
      }
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(openCodeError("VES_OPENCODE_SERVER_FAILED", "OpenCode server failed"));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(openCodeError("VES_OPENCODE_SERVER_FAILED", "OpenCode server failed"));
    });
  }).catch((error: unknown) => {
    child.kill();
    throw error;
  });
  const moduleName: string = "@opencode-ai/sdk/v2";
  try {
    const loaded = (await import(moduleName)) as {
      createOpencodeClient?: (options: { baseUrl: string }) => OpenCodeInstance["client"];
    };
    if (typeof loaded.createOpencodeClient === "function")
      return { client: loaded.createOpencodeClient({ baseUrl: url }), server: { close: () => child.kill() } };
  } catch {
    // Stable public error below intentionally hides loader and local-path details.
  }
  child.kill();
  throw openCodeError("VES_OPENCODE_SDK_UNAVAILABLE", "OpenCode SDK is unavailable");
}

export class OpenCodeDriver implements Driver {
  readonly #dependencies: OpenCodeDriverDependencies;
  readonly #command: readonly string[];
  readonly #minimumVersion: string;
  readonly #factory: OpenCodeServerFactory;
  readonly #sessions = new Map<string, OpenCodeSession>();
  readonly #closedSessions = new Set<string>();

  constructor(dependencies: OpenCodeDriverDependencies) {
    this.#dependencies = dependencies;
    this.#command = dependencies.command ?? ["opencode"];
    this.#minimumVersion = dependencies.minimumVersion ?? "1.17.18";
    this.#factory = dependencies.serverFactory ?? productionServerFactory;
  }

  buildEnvironment(explicit: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key] !== undefined) environment[key] = process.env[key];
    const merged = { ...environment, ...explicit };
    delete merged["OPENCODE_SESSION_ID"];
    return merged;
  }

  serverOptions(environment: Readonly<Record<string, string>> = {}) {
    return Object.freeze({
      hostname: "127.0.0.1",
      port: 0,
      command: this.#command,
      environment: this.buildEnvironment(environment),
      config: Object.freeze({ share: "disabled", permission: Object.freeze({ "*": "ask" }) })
    });
  }

  async probe() {
    try {
      const { stdout } = await execFileAsync(this.#command[0] as string, [...this.#command.slice(1), "--version"], {
        encoding: "utf8",
        env: this.buildEnvironment(this.#dependencies.probeEnvironment),
        windowsHide: true
      });
      const version = parseVersion(stdout)?.join(".");
      if (version === undefined || !supported(version, this.#minimumVersion))
        return Object.freeze({
          driverId: "opencode",
          available: false,
          version,
          error: Object.freeze({ code: "VES_OPENCODE_VERSION_UNSUPPORTED", message: "OpenCode version is unsupported" })
        });
      return Object.freeze({
        driverId: "opencode",
        available: true,
        version,
        capabilities: Object.freeze(["sdk-events", "model-discovery", "permission-mediation", "loopback-only"])
      });
    } catch {
      return Object.freeze({
        driverId: "opencode",
        available: false,
        error: Object.freeze({ code: "VES_OPENCODE_NOT_AVAILABLE", message: "OpenCode is unavailable" })
      });
    }
  }

  async discoverModels(): Promise<Readonly<Record<string, unknown>>> {
    const instance = await this.#factory(this.serverOptions(this.#dependencies.probeEnvironment));
    try {
      const response = await instance.client.provider.list();
      const models = flattenCatalog(response.data);
      if (models.length === 0)
        return Object.freeze({
          models,
          error: Object.freeze({ code: "VES_OPENCODE_CATALOG_FAILED", message: "OpenCode catalog is unavailable" })
        });
      return Object.freeze({ models });
    } finally {
      instance.server.close();
    }
  }

  async start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef> {
    if (signal.aborted) throw openCodeError("VES_DRIVER_CANCELLED", "OpenCode start was cancelled");
    validateDriverStartRequest(request);
    const probe = await this.probe();
    if (!probe.available) throw openCodeError(probe.error.code, probe.error.message);
    if (signal.aborted) throw openCodeError("VES_DRIVER_CANCELLED", "OpenCode start was cancelled during probe");
    let execution: OpenCodeExecution;
    try {
      execution = await this.#dependencies.resolveExecution(request);
    } catch {
      throw openCodeError("VES_OPENCODE_RESOLUTION_FAILED", "OpenCode execution resolution failed");
    }
    if (signal.aborted) throw openCodeError("VES_DRIVER_CANCELLED", "OpenCode start was cancelled during resolution");
    this.#validateExecution(request, execution);
    const instance = await this.#factory(this.serverOptions(execution.environment));
    const { client, server } = instance;
    const sessionRef = `opencode-session:${randomUUID()}`;
    const state: OpenCodeSession = { sink, sequence: 0, outcome: "completed", closed: false };
    this.#sessions.set(sessionRef, state);
    const redact = redactor(execution.sensitiveValues ?? []);
    let providerSessionId: string | undefined;
    let aborted = false;
    let finishAbort!: () => void;
    const abortedPromise = new Promise<void>((resolve) => (finishAbort = resolve));
    const abort = () => {
      if (aborted) return;
      aborted = true;
      if (providerSessionId !== undefined)
        void client.session.abort({ sessionID: providerSessionId }).catch(() => undefined);
      finishAbort();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      const catalog = flattenCatalog((await client.provider.list()).data);
      const candidate = catalog.find((entry) => entry.id === execution.model && entry.connected);
      if (
        candidate === undefined ||
        candidate.provider !== execution.passport.provider ||
        candidate.model !== execution.passport.resolvedModel
      )
        throw openCodeError("VES_OPENCODE_MODEL_UNAVAILABLE", "OpenCode model is unavailable");
      this.#emit(state, { type: "session.started", sessionId: sessionRef });
      this.#emit(state, {
        type: "model.resolved",
        passportRef: request.passportRef,
        provider: candidate.provider,
        resolvedModel: candidate.model
      });
      const created = await client.session.create({
        model: { providerID: candidate.provider, id: candidate.model },
        permission: [{ permission: "*", pattern: "*", action: "ask" }]
      });
      providerSessionId = created.data?.id;
      if (typeof providerSessionId !== "string")
        throw openCodeError("VES_OPENCODE_PROTOCOL_FAILED", "OpenCode session identity is invalid");
      if (aborted) throw openCodeError("VES_OPENCODE_ABORTED", "OpenCode was aborted");
      const subscribed = await client.event.subscribe();
      const consume = (async () => {
        for await (const raw of subscribed.stream) {
          if (raw === null || typeof raw !== "object")
            throw openCodeError("VES_OPENCODE_STREAM_INVALID", "OpenCode event is invalid");
          const event = raw as Record<string, unknown>;
          if (typeof event["type"] !== "string")
            throw openCodeError("VES_OPENCODE_STREAM_INVALID", "OpenCode event is invalid");
          const properties = (event["properties"] ?? {}) as Record<string, unknown>;
          if (properties["sessionID"] !== undefined && properties["sessionID"] !== providerSessionId) continue;
          if (event["type"] === "permission.asked") {
            if (typeof properties["id"] !== "string" || typeof properties["permission"] !== "string")
              throw openCodeError("VES_OPENCODE_STREAM_INVALID", "OpenCode permission event is invalid");
            if (!execution.tools.some((tool) => tool.name === properties["permission"]))
              throw openCodeError("VES_OPENCODE_TOOL_UNMEDIATED", "OpenCode requested an undeclared tool");
            const metadata = properties["metadata"] as Record<string, unknown> | undefined;
            const toolRequest = {
              toolCallId: properties["id"],
              name: properties["permission"],
              input: sanitize(metadata?.["input"] ?? metadata, redact),
              patterns: Array.isArray(properties["patterns"])
                ? properties["patterns"].filter((entry): entry is string => typeof entry === "string")
                : []
            };
            this.#emit(state, { type: "tool.requested", ...toolRequest });
            const allowed = await execution.authorizeTool(toolRequest);
            await client.permission.reply({ requestID: toolRequest.toolCallId, reply: allowed ? "once" : "reject" });
          } else if (event["type"] === "message.part.updated") {
            const part = (properties["part"] ?? {}) as Record<string, unknown>;
            if (part["type"] === "text" && part["time"] !== undefined) {
              this.#emit(state, { type: "content.delta", text: redact(part["text"] ?? "") });
            } else if (part["type"] === "step-finish") {
              const tokens = (part["tokens"] ?? {}) as Record<string, unknown>;
              const cache = (tokens["cache"] ?? {}) as Record<string, unknown>;
              const values = [
                tokens["input"] ?? 0,
                tokens["output"] ?? 0,
                tokens["reasoning"] ?? 0,
                cache["read"] ?? 0,
                cache["write"] ?? 0
              ].map(Number);
              if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
                throw openCodeError("VES_OPENCODE_STREAM_INVALID", "OpenCode usage is invalid");
              this.#emit(state, {
                type: "usage.updated",
                inputTokens: values[0],
                outputTokens: values[1],
                reasoningTokens: values[2],
                cacheReadTokens: values[3],
                cacheWriteTokens: values[4]
              });
            }
          } else if (event["type"] === "session.error") {
            state.outcome = "failed";
            this.#emit(state, {
              type: "error",
              code: "VES_OPENCODE_EXECUTION_FAILED",
              message: "OpenCode failed",
              retryable: true
            });
          } else if (event["type"] === "session.status") {
            const status = properties["status"] as Record<string, unknown> | undefined;
            if (status?.["type"] === "idle") return;
          }
        }
        throw openCodeError("VES_OPENCODE_STREAM_INCOMPLETE", "OpenCode stream ended before idle");
      })();
      const prompt = await client.session.prompt({
        sessionID: providerSessionId,
        model: { providerID: candidate.provider, modelID: candidate.model },
        tools: Object.fromEntries(execution.tools.map((tool) => [tool.name, true])),
        parts: [{ type: "text", text: execution.prompt }]
      });
      if (prompt.error !== undefined) throw openCodeError("VES_OPENCODE_PROTOCOL_FAILED", "OpenCode prompt failed");
      await Promise.race([consume, abortedPromise]);
      if (!aborted) await consume;
    } catch (error) {
      if (!aborted) {
        state.outcome = "failed";
        const code = error instanceof DriverProtocolError ? error.code : "VES_OPENCODE_PROTOCOL_FAILED";
        this.#emit(state, { type: "error", code, message: "OpenCode protocol failed", retryable: false });
      }
    } finally {
      if (providerSessionId !== undefined && !aborted)
        await client.session.delete({ sessionID: providerSessionId }).catch(() => undefined);
      server.close();
      signal.removeEventListener("abort", abort);
    }
    if (aborted) {
      state.outcome = "cancelled";
      this.#emit(state, {
        type: "error",
        code: "VES_OPENCODE_ABORTED",
        message: "OpenCode was aborted",
        retryable: true
      });
    }
    return Object.freeze({ sessionId: sessionRef });
  }

  async send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void> {
    void session;
    void input;
    throw openCodeError("VES_OPENCODE_SEND_UNSUPPORTED", "OpenCode isolated sessions do not accept follow-up input");
  }

  async cancel(session: DriverSessionRef, reason: string): Promise<void> {
    if (this.#closedSessions.has(session.sessionId)) return;
    const state = this.#known(session);
    if (state.closed) return;
    state.outcome = "cancelled";
    this.#terminal(state, reason);
  }

  async close(session: DriverSessionRef) {
    if (this.#closedSessions.has(session.sessionId))
      return Object.freeze({ sessionId: session.sessionId, closed: true, alreadyClosed: true });
    const state = this.#known(session);
    this.#terminal(state);
    this.#sessions.delete(session.sessionId);
    this.#closedSessions.add(session.sessionId);
    return Object.freeze({
      sessionId: session.sessionId,
      closed: true,
      outcome: state.outcome,
      finalSequence: state.sequence
    });
  }

  #validateExecution(request: DriverStartRequest, execution: OpenCodeExecution): void {
    if (
      execution.passport.passportId !== request.passportRef.passportId ||
      execution.passport.revision !== request.passportRef.revision ||
      execution.model !== `${execution.passport.provider}/${execution.passport.resolvedModel}`
    )
      throw openCodeError("VES_OPENCODE_IDENTITY_MISMATCH", "OpenCode identity does not match the selected Passport");
    if (typeof execution.prompt !== "string" || execution.prompt.length === 0)
      throw openCodeError("VES_OPENCODE_CONTEXT_INVALID", "OpenCode serialized context is invalid");
    const declared = request.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    const concrete = execution.tools.map((tool) => `${tool.name}:${tool.inputSchemaDigest}`).sort();
    if (
      declared.length !== concrete.length ||
      declared.some((entry, index) => entry !== concrete[index]) ||
      execution.tools.some((tool) => !/^vestra_[a-z0-9_]+$/iu.test(tool.name))
    )
      throw openCodeError("VES_OPENCODE_TOOL_UNMEDIATED", "OpenCode tools must use the Verchestra effect bridge");
  }

  #emit(state: OpenCodeSession, event: Readonly<Record<string, unknown>>): void {
    state.sink(Object.freeze({ ...event, sequence: state.sequence }) as DriverEvent);
    state.sequence += 1;
  }

  #terminal(state: OpenCodeSession, reason?: string): void {
    if (state.closed) return;
    this.#emit(state, { type: "session.closed", outcome: state.outcome, ...(reason === undefined ? {} : { reason }) });
    state.closed = true;
  }

  #known(session: DriverSessionRef): OpenCodeSession {
    const state = this.#sessions.get(session.sessionId);
    if (state === undefined) throw openCodeError("VES_DRIVER_SESSION_UNKNOWN", "OpenCode session is unknown");
    return state;
  }
}
