import { isAbsolute } from "node:path";

import type { ExecutionDriverPort, ExecutionPayloadStore } from "@verchestra/application";
import type { DriverEvent, DriverEventOf } from "@verchestra/domain";

import { runDriverSession, type DriverSessionPort, type DriverSessionResult } from "./driver-session-runner.ts";
import { MCP_BRIDGE_QUALIFIED_TOOLS } from "./mcp-bridge-protocol.ts";
import { McpToolBridgeController } from "./mcp-tool-bridge.ts";

type ExecuteRequest = Parameters<ExecutionDriverPort["execute"]>[0];
type ExecuteControl = Parameters<ExecutionDriverPort["execute"]>[1];

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
  violation: string | undefined;
  fatal: unknown;
  usageFailure: unknown;
  toolRequests: number;
  readonly checkpoints: Promise<unknown>[];
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
      violation: undefined,
      fatal: undefined,
      usageFailure: undefined,
      toolRequests: 0,
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
      const { outcome, errorCodes } = await this.#run(session, state, abort, control);
      const statistics = bridge.statistics();
      await control.checkpoint("driver-finished", {
        outcome,
        toolRequests: state.toolRequests,
        writes: statistics.writes,
        deletes: statistics.deletes,
        denied: statistics.denied,
        errorCodes: [...errorCodes]
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

  // invariant: the session runner owns start, cancel on abort, close, and the
  // outcome; this adapter owns what a mediated implementer session may do, so
  // its own refusals are raised before the runner's outcome is read.
  async #run(
    session: DriverExecutionSession<TStartRequest>,
    state: RunState,
    abort: AbortController,
    control: ExecuteControl
  ): Promise<DriverSessionResult> {
    let finished: DriverSessionResult;
    try {
      finished = await runDriverSession({
        driver: session.driver,
        startRequest: session.startRequest,
        signal: abort.signal,
        observe: (event) => this.#observe(event, state, abort, control)
      });
    } finally {
      await Promise.all(state.checkpoints);
    }
    if (state.violation !== undefined)
      throw new DriverExecutionAdapterError(
        "VES_DRIVER_TOOL_OUTSIDE_BRIDGE",
        "Driver requested a tool outside the bridge"
      );
    if (state.fatal !== undefined) throw state.fatal;
    if (state.usageFailure !== undefined) throw state.usageFailure;
    return finished;
  }

  #observe(event: DriverEvent, state: RunState, abort: AbortController, control: ExecuteControl) {
    switch (event.type) {
      case "session.started":
        // invariant: checkpoints carry portable facts only; the provider
        // session identity stays local.
        state.checkpoints.push(control.checkpoint("driver-started", { model: state.model }));
        break;
      case "model.resolved":
        if (typeof event.resolvedModel === "string") state.model = event.resolvedModel;
        break;
      case "usage.updated":
        this.#usage(event, state, abort, control);
        break;
      case "tool.requested":
        this.#toolRequested(event, state, abort);
        break;
      default:
        break;
    }
  }

  // invariant: the bridge is the only tool surface; any other requested tool
  // means the driver escaped mediation, so the session is stopped.
  #toolRequested(event: DriverEventOf<"tool.requested">, state: RunState, abort: AbortController): void {
    if (MCP_BRIDGE_QUALIFIED_TOOLS.includes(event.name)) {
      state.toolRequests += 1;
      return;
    }
    state.violation ??= "VES_DRIVER_TOOL_OUTSIDE_BRIDGE";
    abort.abort("tool requested outside the bridge");
  }

  #usage(
    event: DriverEventOf<"usage.updated">,
    state: RunState,
    abort: AbortController,
    control: ExecuteControl
  ): void {
    try {
      control.reportUsage({ model: state.model, inputTokens: event.inputTokens, outputTokens: event.outputTokens });
    } catch (error) {
      state.usageFailure ??= error;
      abort.abort("usage could not be metered");
    }
  }
}
