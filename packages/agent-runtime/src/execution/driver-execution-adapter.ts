import { isAbsolute } from "node:path";

import type { ExecutionDriverPort, ExecutionPayloadStore } from "@verchestra/application";

import { MCP_BRIDGE_QUALIFIED_TOOLS } from "./mcp-bridge-protocol.ts";
import { McpToolBridgeController } from "./mcp-tool-bridge.ts";

type ExecuteRequest = Parameters<ExecutionDriverPort["execute"]>[0];
type ExecuteControl = Parameters<ExecutionDriverPort["execute"]>[1];
type DriverOutcome = "completed" | "failed" | "cancelled";
type Row = Readonly<Record<string, unknown>>;

// The Driver protocol (packages/drivers) as seen from here. agent-runtime may
// not import a sibling adapter, so the shape is declared structurally and the
// composition root passes the concrete driver.
export interface DriverSessionPort<TStartRequest> {
  start(
    request: TStartRequest,
    sink: (event: Row & { readonly type: string }) => void,
    signal: AbortSignal
  ): Promise<{ readonly sessionId: string }>;
  cancel(session: { readonly sessionId: string }, reason: string): Promise<void>;
  close(session: { readonly sessionId: string }): Promise<Row>;
}

export interface DriverExecutionSession<TStartRequest> {
  readonly driver: DriverSessionPort<TStartRequest>;
  readonly startRequest: TStartRequest;
  // The priced model the session runs; usage is metered against it until the
  // driver reports the model it actually resolved.
  readonly model: string;
}

export interface DriverExecutionAdapterOptions<TStartRequest> {
  readonly resolveWorktree: (worktreeRef: string) => Promise<string>;
  readonly payloads: ExecutionPayloadStore;
  // Absolute command that starts the bridge relay for Claude Code.
  readonly bridgeCommand: readonly string[];
  readonly createSession: (input: {
    readonly request: ExecuteRequest;
    readonly worktreePath: string;
    readonly bridge: { readonly command: readonly string[]; readonly environment: Readonly<Record<string, string>> };
  }) => Promise<DriverExecutionSession<TStartRequest>>;
  // Approved read scope for the bridge's read tools; defaults to the task's
  // change scope.
  readonly readScope?: (request: ExecuteRequest) => readonly string[];
  readonly socketRoot?: string;
}

export class DriverExecutionAdapterError extends Error {
  readonly code: "VES_DRIVER_TOOL_OUTSIDE_BRIDGE" | "VES_DRIVER_ADAPTER_INPUT_INVALID";

  constructor(code: DriverExecutionAdapterError["code"], message: string) {
    super(message);
    this.name = "DriverExecutionAdapterError";
    this.code = code;
  }
}

interface RunState {
  model: string;
  sessionId: string | undefined;
  violation: string | undefined;
  fatal: unknown;
  usageFailure: unknown;
  toolRequests: number;
  readonly errorCodes: string[];
  readonly checkpoints: Promise<unknown>[];
}

function safeCode(value: unknown): string {
  return typeof value === "string" && /^VES_[A-Z0-9_]{1,96}$/u.test(value) ? value : "VES_DRIVER_ERROR";
}

// ExecutionDriverPort over a Driver session whose only tools are the mediated
// bridge. Every write the model makes reaches the executor through
// control.invokeTool; any other tool request is a violation that ends the run.
export class DriverExecutionAdapter<TStartRequest> implements ExecutionDriverPort {
  readonly #options: DriverExecutionAdapterOptions<TStartRequest>;
  readonly #active = new Map<string, AbortController>();

  constructor(options: DriverExecutionAdapterOptions<TStartRequest>) {
    if (!isAbsolute(options.bridgeCommand[0] ?? ""))
      throw new DriverExecutionAdapterError("VES_DRIVER_ADAPTER_INPUT_INVALID", "Bridge command must be absolute");
    this.#options = options;
  }

  async cancel(worktreeRef: string): Promise<void> {
    this.#active.get(worktreeRef)?.abort("cancelled by the executor");
  }

  async execute(request: ExecuteRequest, control: ExecuteControl) {
    const abort = new AbortController();
    const forward = () => abort.abort("cancelled by the caller");
    if (control.signal?.aborted === true) abort.abort("cancelled before start");
    control.signal?.addEventListener("abort", forward, { once: true });
    this.#active.set(request.worktreeRef, abort);
    const state: RunState = {
      model: "",
      sessionId: undefined,
      violation: undefined,
      fatal: undefined,
      usageFailure: undefined,
      toolRequests: 0,
      errorCodes: [],
      checkpoints: []
    };
    let bridge: McpToolBridgeController | undefined;
    try {
      const worktreePath = await this.#options.resolveWorktree(request.worktreeRef);
      bridge = await this.#openBridge(request, worktreePath, control, state, abort);
      const session = await this.#options.createSession({
        request,
        worktreePath,
        bridge: { command: this.#options.bridgeCommand, environment: bridge.environment }
      });
      if (typeof session.model !== "string" || session.model.length === 0)
        throw new DriverExecutionAdapterError("VES_DRIVER_ADAPTER_INPUT_INVALID", "Driver session has no model");
      state.model = session.model;
      const outcome = await this.#run(session, state, abort, control);
      const statistics = bridge.statistics();
      await control.checkpoint("driver-finished", {
        outcome,
        toolRequests: state.toolRequests,
        writes: statistics.writes,
        deletes: statistics.deletes,
        denied: statistics.denied,
        errorCodes: [...state.errorCodes]
      });
      return Object.freeze({ status: outcome, outputRefs: Object.freeze([]) });
    } finally {
      control.signal?.removeEventListener("abort", forward);
      this.#active.delete(request.worktreeRef);
      await bridge?.close();
    }
  }

  async #openBridge(
    request: ExecuteRequest,
    worktreePath: string,
    control: ExecuteControl,
    state: RunState,
    abort: AbortController
  ): Promise<McpToolBridgeController> {
    return await McpToolBridgeController.open({
      worktreePath,
      readScope: this.#options.readScope?.(request) ?? request.task.changeScope,
      protectedPaths: request.task.protectedPaths,
      taskId: request.task.taskId,
      capabilityGrantRef: request.capabilityGrantRefs[0] as string,
      payloads: this.#options.payloads,
      invokeTool: (toolRequest) => control.invokeTool(toolRequest),
      onFatal: (error) => {
        state.fatal ??= error;
        abort.abort("fatal tool denial");
      },
      ...(this.#options.socketRoot === undefined ? {} : { socketRoot: this.#options.socketRoot })
    });
  }

  async #run(
    session: DriverExecutionSession<TStartRequest>,
    state: RunState,
    abort: AbortController,
    control: ExecuteControl
  ): Promise<DriverOutcome> {
    const stop = () => {
      if (state.sessionId !== undefined)
        void session.driver.cancel({ sessionId: state.sessionId }, "stopped by Verchestra").catch(() => undefined);
    };
    abort.signal.addEventListener("abort", stop, { once: true });
    let closed: Row = {};
    try {
      const reference = await session.driver.start(
        session.startRequest,
        (event) => this.#observe(event, state, abort, control),
        abort.signal
      );
      closed = await session.driver.close(reference);
    } finally {
      abort.signal.removeEventListener("abort", stop);
      await Promise.all(state.checkpoints);
    }
    if (state.violation !== undefined)
      throw new DriverExecutionAdapterError(
        "VES_DRIVER_TOOL_OUTSIDE_BRIDGE",
        "Driver requested a tool outside the bridge"
      );
    if (state.fatal !== undefined) throw state.fatal;
    if (state.usageFailure !== undefined) throw state.usageFailure;
    if (abort.signal.aborted || closed["outcome"] === "cancelled") return "cancelled";
    return state.errorCodes.length > 0 || closed["outcome"] === "failed" ? "failed" : "completed";
  }

  #observe(event: Row & { readonly type: string }, state: RunState, abort: AbortController, control: ExecuteControl) {
    switch (event.type) {
      case "session.started":
        state.sessionId = typeof event["sessionId"] === "string" ? event["sessionId"] : undefined;
        // invariant: checkpoints carry portable facts only; the provider
        // session identity stays local.
        state.checkpoints.push(control.checkpoint("driver-started", { model: state.model }));
        break;
      case "model.resolved":
        if (typeof event["resolvedModel"] === "string") state.model = event["resolvedModel"];
        break;
      case "usage.updated":
        this.#usage(event, state, abort, control);
        break;
      case "tool.requested":
        this.#toolRequested(event, state, abort);
        break;
      case "error":
        state.errorCodes.push(safeCode(event["code"]));
        break;
      default:
        break;
    }
  }

  // invariant: the bridge is the only tool surface; any other requested tool
  // means the driver escaped mediation, so the session is stopped.
  #toolRequested(event: Row, state: RunState, abort: AbortController): void {
    const name = event["name"];
    if (typeof name === "string" && MCP_BRIDGE_QUALIFIED_TOOLS.includes(name)) {
      state.toolRequests += 1;
      return;
    }
    state.violation ??= "VES_DRIVER_TOOL_OUTSIDE_BRIDGE";
    abort.abort("tool requested outside the bridge");
  }

  #usage(event: Row, state: RunState, abort: AbortController, control: ExecuteControl): void {
    try {
      control.reportUsage({
        model: state.model,
        inputTokens: event["inputTokens"] as number,
        outputTokens: event["outputTokens"] as number
      });
    } catch (error) {
      state.usageFailure ??= error;
      abort.abort("usage could not be metered");
    }
  }
}
