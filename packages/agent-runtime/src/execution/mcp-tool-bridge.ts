import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { isAbsolute } from "node:path";
import type { Duplex, Readable, Writable } from "node:stream";

import {
  EXECUTION_PAYLOAD_TOMBSTONE,
  MAXIMUM_EXECUTION_PAYLOAD_BYTES,
  type ExecutionPayloadStore,
  type ExecutionToolRequest
} from "@verchestra/application";

import { UnixSocketBridgeTransport, type BridgeChannel, type BridgeTransport } from "./bridge-transport.ts";
import {
  BRIDGE_TOKEN,
  MCP_BRIDGE_CHANNEL_PROTOCOL,
  MCP_BRIDGE_SERVER_NAME,
  MCP_BRIDGE_SOCKET_ENV,
  MCP_BRIDGE_TOKEN_ENV,
  MCP_BRIDGE_TOOL_DEFINITIONS,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  McpToolBridgeError,
  parseJsonObject,
  readBoundedLines,
  textResult,
  type BridgeToolResult
} from "./mcp-bridge-protocol.ts";
import { BridgeToolError, logicalSegments, WorktreeReadView } from "./mcp-bridge-tools.ts";

const AUTHENTICATION_TIMEOUT_MS = 5_000;
// why: a relay writes each frame whole, so a line that stops arriving part
// way, with no byte for this long, is a channel whose bytes no longer reach
// the controller; it is refused instead of held open.
const FRAME_STALL_TIMEOUT_MS = 10_000;
// why: these executor outcomes end the run; the model is told, and the driver
// adapter is signalled so it stops the session instead of letting it retry.
const FATAL_CODES = new Set([
  "VES_EXECUTOR_APPROVAL_INVALID",
  "VES_EXECUTOR_TASK_MISMATCH",
  "VES_EXECUTOR_CANCELLED",
  "VES_EXECUTOR_BUDGET_EXCEEDED"
]);

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && /^VES_[A-Z0-9_]+$/u.test(code) ? code : undefined;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function send(stream: Writable, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

export interface McpBridgeStatistics {
  readonly calls: number;
  readonly writes: number;
  readonly deletes: number;
  readonly denied: number;
  readonly rejectedConnections: number;
  // invariant: the refused connections whose frame stopped arriving part way.
  readonly stalledFrames: number;
}

export interface McpToolBridgeControllerOptions {
  // The worktree's real path, as resolved by the worktree adapter.
  readonly worktreePath: string;
  readonly readScope: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly taskId: string;
  readonly capabilityGrantRef: string;
  readonly payloads: ExecutionPayloadStore;
  // The executor's mediated tool entry point (ExecutionDriverPort control).
  readonly invokeTool: (request: ExecutionToolRequest) => Promise<{ readonly receiptRef: string }>;
  readonly onFatal?: (error: unknown) => void;
  // Parent for the per-run 0700 socket directory; defaults to the OS temp dir.
  readonly socketRoot?: string;
  // why: the channel is the one part that differs by platform; without one the
  // controller keeps the Unix socket under `socketRoot`, which Windows lacks.
  readonly transport?: BridgeTransport;
  readonly frameStallTimeoutMs?: number;
}

// The trusted half of the bridge. It owns the channel, authenticates the
// relay, confines reads, and turns writes into executor tool requests.
export class McpToolBridgeController {
  readonly #options: McpToolBridgeControllerOptions;
  readonly #view: WorktreeReadView;
  readonly #token: string;
  #channel: BridgeChannel | undefined;
  readonly #sockets = new Set<Duplex>();
  readonly #requestPrefix = `bridge:${randomBytes(8).toString("hex")}`;
  #authenticated = false;
  #sequence = 0;
  #queue: Promise<void> = Promise.resolve();
  #closed = false;
  readonly #statistics = { calls: 0, writes: 0, deletes: 0, denied: 0, rejectedConnections: 0, stalledFrames: 0 };

  private constructor(options: McpToolBridgeControllerOptions, view: WorktreeReadView, token: string) {
    this.#options = options;
    this.#view = view;
    this.#token = token;
  }

  static async open(options: McpToolBridgeControllerOptions): Promise<McpToolBridgeController> {
    // invariant: Windows has no Unix socket, so there a bridge opens only over
    // the channel the composition hands it (the named pipe, AD-074); a caller
    // that brings none is refused before anything is created.
    if (process.platform === "win32" && options.transport === undefined)
      throw new McpToolBridgeError(
        "VES_BRIDGE_TRANSPORT_REQUIRED",
        "The mediated bridge needs the composition's transport on Windows"
      );
    if (!isAbsolute(options.worktreePath))
      throw new McpToolBridgeError("VES_BRIDGE_ROOT_INVALID", "Worktree path must be absolute");
    const view = await WorktreeReadView.open({
      root: options.worktreePath,
      readScope: options.readScope,
      protectedPaths: options.protectedPaths
    });
    const controller = new McpToolBridgeController(options, view, randomBytes(32).toString("hex"));
    const transport = options.transport ?? new UnixSocketBridgeTransport(options.socketRoot);
    controller.#channel = await transport.listen((connection) => controller.#accept(connection));
    return controller;
  }

  // The relay's MCP-config environment: where to connect and how to prove it
  // is the relay launched for this run.
  get environment(): Readonly<Record<string, string>> {
    return Object.freeze({ [MCP_BRIDGE_SOCKET_ENV]: this.socketPath, [MCP_BRIDGE_TOKEN_ENV]: this.#token });
  }

  get socketPath(): string {
    return this.#channel?.endpoint ?? "";
  }

  statistics(): McpBridgeStatistics {
    return Object.freeze({ ...this.#statistics });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const socket of this.#sockets) socket.destroy();
    await this.#channel?.close();
    await this.#queue.catch(() => undefined);
  }

  #accept(socket: Duplex): void {
    if (this.#authenticated || this.#closed) {
      this.#statistics.rejectedConnections += 1;
      socket.destroy();
      return;
    }
    this.#sockets.add(socket);
    socket.on("close", () => this.#sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let authenticated = false;
    const timer = setTimeout(() => {
      if (!authenticated) this.#reject(socket);
    }, AUTHENTICATION_TIMEOUT_MS);
    this.#watchFrames(socket);
    readBoundedLines(
      socket,
      (line) => {
        const frame = parseJsonObject(line);
        if (authenticated) {
          this.#enqueueCall(socket, frame);
          return;
        }
        clearTimeout(timer);
        authenticated = this.#authenticate(socket, frame);
      },
      () => this.#reject(socket)
    );
  }

  #authenticate(socket: Duplex, frame: Record<string, unknown> | undefined): boolean {
    if (frame === undefined || !this.#verifyHello(frame)) {
      this.#reject(socket);
      return false;
    }
    this.#authenticated = true;
    send(socket, { type: "ready", protocol: MCP_BRIDGE_CHANNEL_PROTOCOL });
    return true;
  }

  #enqueueCall(socket: Duplex, frame: Record<string, unknown> | undefined): void {
    if (frame?.["type"] !== "call" || !Number.isSafeInteger(frame["id"])) {
      this.#reject(socket);
      return;
    }
    const id = frame["id"] as number;
    this.#queue = this.#queue.then(async () => {
      const result = await this.#call(frame["name"], frame["arguments"]);
      if (!socket.destroyed) send(socket, { type: "result", id, ...result });
    });
  }

  // invariant: a frame that stops arriving part way through, with no byte for
  // the stall bound, refuses its connection, so a channel whose bytes stop
  // between its client and the controller ends within a bound however they
  // stop. A line's end, or the connection's close, ends the wait.
  #watchFrames(socket: Duplex): void {
    const limit = this.#options.frameStallTimeoutMs ?? FRAME_STALL_TIMEOUT_MS;
    let stall: NodeJS.Timeout | undefined;
    socket.on("data", (chunk: Buffer | string) => {
      clearTimeout(stall);
      const lastByte = typeof chunk === "string" ? chunk.charCodeAt(chunk.length - 1) : chunk[chunk.length - 1];
      stall =
        lastByte === 0x0a
          ? undefined
          : setTimeout(() => {
              if (socket.destroyed) return;
              this.#statistics.stalledFrames += 1;
              this.#reject(socket);
            }, limit);
    });
    socket.on("close", () => clearTimeout(stall));
  }

  #reject(socket: Duplex): void {
    this.#statistics.rejectedConnections += 1;
    socket.destroy();
  }

  // invariant: constant-time comparison over fixed-length digests, so neither
  // the token's value nor its length leaks through timing.
  #verifyHello(frame: Record<string, unknown>): boolean {
    const token = frame["token"];
    if (frame["type"] !== "hello" || frame["protocol"] !== MCP_BRIDGE_CHANNEL_PROTOCOL || typeof token !== "string")
      return false;
    return timingSafeEqual(digest(token), digest(this.#token)) && BRIDGE_TOKEN.test(token);
  }

  async #call(name: unknown, input: unknown): Promise<BridgeToolResult> {
    this.#statistics.calls += 1;
    try {
      return await this.#dispatch(name, input);
    } catch (error) {
      this.#statistics.denied += 1;
      const code = errorCode(error) ?? "VES_BRIDGE_TOOL_FAILED";
      if (FATAL_CODES.has(code)) this.#options.onFatal?.(error);
      return textResult(`denied: ${code}`, true);
    }
  }

  async #dispatch(name: unknown, input: unknown): Promise<BridgeToolResult> {
    const args = argumentsFor(name, input);
    switch (name) {
      case "read_file": {
        const read = await this.#view.readFile(
          args["path"],
          optionalInteger(args["offset"]),
          optionalInteger(args["length"])
        );
        return textResult(
          read.truncated
            ? `${read.text}\n[verchestra: truncated; continue at offset ${read.nextOffset} of ${read.size} bytes]`
            : read.text
        );
      }
      case "list_dir":
        return textResult(JSON.stringify(await this.#view.listDir(args["path"])));
      case "search":
        return textResult(JSON.stringify(await this.#view.search(args["query"], args["path"] ?? ".")));
      case "write_file":
        return await this.#mutate("write", args["path"], args["content"]);
      default:
        return await this.#mutate("delete", args["path"], undefined);
    }
  }

  async #mutate(operation: "write" | "delete", path: unknown, content: unknown): Promise<BridgeToolResult> {
    const segments = logicalSegments(path);
    if (segments.length === 0) throw new BridgeToolError("VES_BRIDGE_PATH_INVALID", "A file path is required");
    let payloadRef: string = EXECUTION_PAYLOAD_TOMBSTONE;
    if (operation === "write") {
      if (typeof content !== "string") throw new BridgeToolError("VES_BRIDGE_ARGUMENTS_INVALID", "Content is invalid");
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > MAXIMUM_EXECUTION_PAYLOAD_BYTES)
        throw new BridgeToolError("VES_BRIDGE_PAYLOAD_TOO_LARGE", "Content exceeds its bound");
      payloadRef = await this.#options.payloads.put(bytes);
    }
    this.#sequence += 1;
    const target = segments.join("/");
    const receipt = await this.#options.invokeTool({
      requestId: `${this.#requestPrefix}:${this.#sequence}`,
      taskId: this.#options.taskId,
      capabilityGrantRef: this.#options.capabilityGrantRef,
      operation,
      targetPaths: [target],
      payloadRef
    });
    if (operation === "write") this.#statistics.writes += 1;
    else this.#statistics.deletes += 1;
    return textResult(`${operation === "write" ? "wrote" : "deleted"} ${target}; receipt ${receipt.receiptRef}`);
  }
}

const TOOL_ARGUMENTS: Readonly<
  Record<string, { readonly required: readonly string[]; readonly optional: readonly string[] }>
> = Object.freeze({
  read_file: { required: ["path"], optional: ["offset", "length"] },
  list_dir: { required: ["path"], optional: [] },
  search: { required: ["query"], optional: ["path"] },
  write_file: { required: ["path", "content"], optional: [] },
  delete_file: { required: ["path"], optional: [] }
});

function argumentsFor(name: unknown, input: unknown): Record<string, unknown> {
  const shape = typeof name === "string" && Object.hasOwn(TOOL_ARGUMENTS, name) ? TOOL_ARGUMENTS[name] : undefined;
  if (shape === undefined) throw new BridgeToolError("VES_BRIDGE_TOOL_UNKNOWN", "Tool is not a bridge tool");
  const args = input ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args))
    throw new BridgeToolError("VES_BRIDGE_ARGUMENTS_INVALID", "Tool arguments must be an object");
  const row = args as Record<string, unknown>;
  const allowed = new Set([...shape.required, ...shape.optional]);
  if (Object.keys(row).some((key) => !allowed.has(key)) || shape.required.some((key) => !Object.hasOwn(row, key)))
    throw new BridgeToolError("VES_BRIDGE_ARGUMENTS_INVALID", "Tool arguments do not match the tool");
  return row;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new BridgeToolError("VES_BRIDGE_ARGUMENTS_INVALID", "Numeric argument is invalid");
  return value as number;
}

// ---------------------------------------------------------------------------
// Relay: the child Claude Code launches from --mcp-config. It speaks MCP
// (JSON-RPC 2.0 over newline-delimited stdio), answers the handshake locally,
// and forwards tools/call to the controller. It never touches the filesystem.
// ---------------------------------------------------------------------------

interface RelayOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

async function connectController(environment: RelayOptions["environment"]): Promise<Socket> {
  const socketPath = environment[MCP_BRIDGE_SOCKET_ENV];
  const token = environment[MCP_BRIDGE_TOKEN_ENV];
  if (socketPath === undefined || !isAbsolute(socketPath) || token === undefined || !BRIDGE_TOKEN.test(token))
    throw new McpToolBridgeError("VES_BRIDGE_NOT_CONFIGURED", "Bridge relay has no controller channel");
  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new McpToolBridgeError("VES_BRIDGE_AUTH_TIMEOUT", "Controller did not answer")),
      AUTHENTICATION_TIMEOUT_MS
    );
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(new McpToolBridgeError("VES_BRIDGE_CHANNEL_FAILED", "Controller channel failed", { cause: error }));
    });
    socket.once("close", () => {
      clearTimeout(timer);
      reject(new McpToolBridgeError("VES_BRIDGE_AUTH_REJECTED", "Controller refused the relay"));
    });
    readBoundedLines(
      socket,
      (line) => {
        if (parseJsonObject(line)?.["type"] === "ready") {
          clearTimeout(timer);
          resolve();
        }
      },
      () => socket.destroy()
    );
    send(socket, { type: "hello", protocol: MCP_BRIDGE_CHANNEL_PROTOCOL, token });
  });
  return socket;
}

// The handshake and listing are answered by the relay itself: they carry no
// authority, and answering locally keeps the controller channel for tool calls.
function localResult(method: string, params: Record<string, unknown>): unknown {
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: MCP_BRIDGE_TOOL_DEFINITIONS };
  if (method !== "initialize") return undefined;
  const requested = params["protocolVersion"];
  return {
    protocolVersion: MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested as string)
      ? requested
      : MCP_SUPPORTED_PROTOCOL_VERSIONS.at(-1),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: MCP_BRIDGE_SERVER_NAME, version: "1.0.0" }
  };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function relayControllerResult(line: string, pending: Map<number, unknown>, output: Writable): void {
  const frame = parseJsonObject(line);
  const id = frame?.["id"];
  if (frame?.["type"] !== "result" || typeof id !== "number" || !pending.has(id)) return;
  const rpcId = pending.get(id);
  pending.delete(id);
  send(output, {
    jsonrpc: "2.0",
    id: rpcId,
    result: { content: frame["content"], isError: frame["isError"] === true }
  });
}

function handleRelayMessage(
  message: Record<string, unknown>,
  output: Writable,
  forward: (id: unknown, params: Record<string, unknown>) => void
): void {
  const id = message["id"];
  const method = message["method"];
  const params = (message["params"] ?? {}) as Record<string, unknown>;
  if (message["jsonrpc"] !== "2.0" || typeof method !== "string") {
    if (id !== undefined) send(output, jsonRpcError(id, -32600, "Invalid request"));
    return;
  }
  // why: notifications (no id) such as notifications/initialized need no answer.
  if (id === undefined) return;
  if (method === "tools/call") {
    forward(id, params);
    return;
  }
  const result = localResult(method, params);
  send(output, result === undefined ? jsonRpcError(id, -32601, "Method not found") : { jsonrpc: "2.0", id, result });
}

export async function runMcpToolBridgeRelay(options: RelayOptions): Promise<void> {
  const socket = await connectController(options.environment);
  const pending = new Map<number, unknown>();
  let nextCall = 0;
  socket.removeAllListeners("close");
  socket.removeAllListeners("data");
  socket.removeAllListeners("error");
  socket.on("error", () => socket.destroy());
  readBoundedLines(
    socket,
    (line) => relayControllerResult(line, pending, options.output),
    () => socket.destroy()
  );
  const forward = (id: unknown, params: Record<string, unknown>) => {
    nextCall += 1;
    pending.set(nextCall, id);
    send(socket, { type: "call", id: nextCall, name: params["name"], arguments: params["arguments"] ?? {} });
  };
  const handle = (message: Record<string, unknown>) => handleRelayMessage(message, options.output, forward);
  await new Promise<void>((resolve) => {
    readBoundedLines(
      options.input,
      (line) => {
        const message = parseJsonObject(line);
        if (message === undefined) send(options.output, jsonRpcError(null, -32700, "Parse error"));
        else handle(message);
      },
      () => {
        send(options.output, jsonRpcError(null, -32600, "Message exceeds its bound"));
        resolve();
      }
    );
    options.input.once("end", () => resolve());
    options.input.once("close", () => resolve());
    socket.once("close", () => resolve());
  });
  for (const id of pending.values()) send(options.output, jsonRpcError(id, -32000, "Controller channel closed"));
  socket.destroy();
}
