import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  DriverExecutionAdapterError,
  removeMaterializedView,
  runDriverSession,
  WorktreeReadView,
  type ContextManifest,
  type DriverQuotaSignal,
  type InMemoryExecutionPayloadStore
} from "@verchestra/agent-runtime";
import {
  assertStructuredAnswer,
  CoordinatedDriver,
  NativeAgentEngine,
  type CoordinationEngine,
  type CoordinationMode,
  type CoordinationNode,
  type CoordinationNodeSession,
  type CoordinationRecordPort,
  type ExecutionDriverPort,
  type NormalizedTaskRequestV2
} from "@verchestra/application";
import { canonicalizeJsonV2, type DriverEvent, type DriverEventOf } from "@verchestra/domain";
import { CodexDriver, type DriverStartRequest } from "@verchestra/drivers";
import type { NodeGitWorktreeAdapter } from "@verchestra/platform-node";

import type { ProviderAuthMode } from "../task-provider-auth.ts";
import { isolatedIdentity, sessionCredential } from "./task-codex.ts";
import { stableUuid } from "./task-context.ts";
import { canonicalDigest } from "./task-files.ts";
import { claudeSessionAdapter, contextText, passThroughEnvironment } from "./task-implementer.ts";
import type { ProviderProcesses, ProviderSession } from "./task-process-tree.ts";

type ExecuteRequest = Parameters<ExecutionDriverPort["execute"]>[0];
type ExecuteControl = Parameters<ExecutionDriverPort["execute"]>[1];

export interface CoordinatedRunOptions {
  readonly workspaceId: string;
  readonly runId: string;
  readonly request: NormalizedTaskRequestV2;
  readonly manifest: ContextManifest;
  readonly claude: { readonly executable: string; readonly auth: ProviderAuthMode; readonly credential: string };
  readonly codex: { readonly executable: string; readonly credential?: string; readonly identityDirectory?: string };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly sessionsRoot: string;
  readonly providers: ProviderProcesses;
  readonly worktrees: NodeGitWorktreeAdapter;
  readonly payloads: InMemoryExecutionPayloadStore;
  readonly records: CoordinationRecordPort;
  readonly feedback: string | undefined;
  readonly remainingDurationMs: () => number;
  readonly onWorktree: (worktreeRef: string) => Promise<void>;
  // invariant: D4. The uncertainty digest the owner typed back at `resume`.
  readonly reconcile: `sha256:${string}` | undefined;
}

// why: decision D5 and SSI-14. Mode `agent` runs on the native engine; the
// Strands SDK is loaded only for a graph or swarm run, through this one
// literal dynamic import, so no other command and no agent run loads it.
export async function coordinationEngine(mode: CoordinationMode): Promise<CoordinationEngine> {
  if (mode === "agent") return new NativeAgentEngine();
  const { StrandsCoordinationEngine } = await import("@verchestra/agent-runtime/strands-coordination");
  return new StrandsCoordinationEngine();
}

// invariant: AD-068. The executor's driver port for a coordinated run: the
// coordinated driver over the per-node driver factory built here from the
// existing Claude Code and Codex drivers.
export function coordinatedDriver(options: CoordinatedRunOptions): ExecutionDriverPort {
  return new CoordinatedDriver({
    request: options.request,
    engine: coordinationEngine,
    nodes: { driver: (session) => nodeDriver(options, session) },
    payloads: options.payloads,
    records: options.records,
    context: contextText(options.manifest),
    ...(options.feedback === undefined ? {} : { feedback: options.feedback }),
    remainingDurationMs: options.remainingDurationMs,
    digest: canonicalDigest,
    ...(options.reconcile === undefined ? {} : { reconcile: options.reconcile }),
    changeDigest: async (worktreeRef) => {
      const handle = { worktreeRef, baseCommit: options.request.sourceRevision };
      return (await options.worktrees.inspect(handle)).changeDigest as `sha256:${string}`;
    }
  });
}

// invariant: SSI-17. A node keeps its concrete provider: a Claude Code node is
// a mediated Claude Code session narrowed to the node's read scope; a Codex
// node is a read-only Codex session. Both answer the node's closed schema.
function nodeDriver(options: CoordinatedRunOptions, session: CoordinationNodeSession): ExecutionDriverPort {
  if (session.node.driver.driverId === "codex") return codexNodeAdapter(options, session);
  return claudeSessionAdapter({
    workspaceId: options.workspaceId,
    runId: options.runId,
    manifestId: options.manifest.manifestId,
    model: session.node.driver.model,
    executable: options.claude.executable,
    auth: options.claude.auth,
    credential: options.claude.credential,
    env: options.env,
    isolationRoot: options.sessionsRoot,
    providers: options.providers,
    worktrees: options.worktrees,
    payloads: options.payloads,
    onWorktree: options.onWorktree,
    prompt: () => session.prompt,
    readScope: session.node.readScope,
    structuredOutput: session.structuredOutput
  });
}

interface CodexNodeState {
  structured: DriverEventOf<"result.structured"> | undefined;
  quota: DriverQuotaSignal | undefined;
  failure: unknown;
  toolRequests: number;
}

function invalidResult(message: string): DriverExecutionAdapterError {
  return new DriverExecutionAdapterError("VES_DRIVER_ADAPTER_INPUT_INVALID", message);
}

// why: a payload is the canonical text of the result, so its size is the size
// the driver bounded.
function resultBytes(event: DriverEventOf<"result.structured">): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalizeJsonV2(event.value));
  if (bytes.byteLength !== event.bytes) throw invalidResult("Codex structured result size does not match its content");
  return bytes;
}

// invariant: the same rules the Claude Code adapter applies: usage reaches
// the run's meter, one structured result at most, the first quota signal stops
// the session, and a requested tool is a violation, because a Codex node is
// granted none.
function observeCodex(
  event: DriverEvent,
  state: CodexNodeState,
  control: ExecuteControl,
  model: string,
  stop: AbortController
) {
  const halt = (failure: unknown, reason: string) => {
    state.failure ??= failure;
    stop.abort(reason);
  };
  if (event.type === "usage.updated") {
    try {
      control.reportUsage({ model, inputTokens: event.inputTokens, outputTokens: event.outputTokens });
    } catch (error) {
      halt(error, "usage could not be metered");
    }
  } else if (event.type === "result.structured") {
    if (state.structured === undefined) state.structured = event;
    else halt(invalidResult("Codex reported more than one structured result"), "driver result is invalid");
  } else if (event.type === "quota.exhausted") {
    state.quota ??=
      event.resetsAt === undefined ? { scope: event.scope } : { scope: event.scope, resetsAt: event.resetsAt };
    stop.abort("provider usage allowance exhausted");
  } else if (event.type === "tool.requested") {
    state.toolRequests += 1;
    halt(new DriverExecutionAdapterError("VES_DRIVER_TOOL_OUTSIDE_BRIDGE", "A Codex node requested a tool"), "tool");
  }
}

// invariant: D3b and SSI-56. A Codex account that reports credits is refused
// by the driver before its turn; the node raises that code, so the run stops
// as for a usage signal instead of failing as a node that answered nothing.
export const CODEX_CREDITS_PRESENT = "VES_CODEX_CREDITS_PRESENT";

function settled(state: CodexNodeState, errorCodes: readonly string[]): void {
  if (state.failure !== undefined) throw state.failure;
  if (state.quota !== undefined)
    throw new DriverExecutionAdapterError(
      "VES_DRIVER_QUOTA_EXHAUSTED",
      "The provider reported that its usage allowance is exhausted",
      state.quota
    );
  if (errorCodes.includes(CODEX_CREDITS_PRESENT))
    throw Object.assign(new Error("Codex reports credits on this account"), { code: CODEX_CREDITS_PRESENT });
}

function codexDriver(
  options: CoordinatedRunOptions,
  session: CoordinationNodeSession,
  provider: ProviderSession,
  context: { readonly cwd: string; readonly home: string; readonly codexHome: string }
): CodexDriver {
  const model = session.node.driver.model;
  const passportId = codexPassportId(model);
  const credential = sessionCredential(options.codex);
  return new CodexDriver({
    command: [options.codex.executable],
    processContext: {
      cwd: context.cwd,
      environment: {
        ...passThroughEnvironment(options.env),
        HOME: context.home,
        USERPROFILE: context.home,
        CODEX_HOME: context.codexHome
      }
    },
    terminateTree: provider.terminateTree,
    onSpawn: provider.onSpawn,
    resolveExecution: () =>
      Promise.resolve({
        passport: { passportId, revision: 1, provider: "openai", resolvedModel: model },
        prompt: session.prompt,
        model,
        tools: [],
        environment: credential.environment,
        sensitiveValues: credential.sensitiveValues,
        cancelGraceMs: 250,
        structuredOutput: session.structuredOutput,
        ...(options.codex.identityDirectory === undefined ? {} : { subscriptionOnly: true as const })
      })
  });
}

function codexPassportId(model: string): string {
  return `passport_${stableUuid("codex:" + model)}`;
}

function startRequest(options: CoordinatedRunOptions, model: string): DriverStartRequest {
  return {
    workspaceId: options.workspaceId,
    runId: options.runId,
    passportRef: { passportId: codexPassportId(model), revision: 1 },
    serializedContextRef: { manifestId: options.manifest.manifestId, target: "codex" },
    tools: []
  };
}

// invariant: SSI-42 and TM-004. A Codex node reads through Codex's own
// sandbox, which the bridge cannot hold, so its working directory is its read
// scope written out read-only by the bridge's own read view, never the
// worktree: no file outside that scope, no protected path, no Git metadata,
// and no link is in it.
async function readScopeView(
  root: string,
  worktree: string,
  node: CoordinationNode,
  request: ExecuteRequest
): Promise<string> {
  const view = join(root, "scope");
  await mkdir(view, { mode: 0o700 });
  const scope = await WorktreeReadView.open({
    root: worktree,
    readScope: node.readScope,
    protectedPaths: request.task.protectedPaths
  });
  await scope.materialize(view);
  return view;
}

// invariant: a Codex node reads its read scope's view through Codex's
// read-only sandbox with no tool granted, from its own HOME and the
// Workspace's Codex identity, and hands on only its structured result, as a
// payload reference. Its view and HOME are removed when it ends.
function codexNodeAdapter(options: CoordinatedRunOptions, session: CoordinationNodeSession): ExecutionDriverPort {
  const stop = new AbortController();
  const execute = async (request: ExecuteRequest, control: ExecuteControl) => {
    const provider = options.providers.session("Codex");
    const root = join(options.sessionsRoot, `codex-node-${options.runId}-${session.node.nodeId}-${session.visit}`);
    try {
      // invariant: the worktree marker is written before any node uses the
      // worktree, as the Claude Code node does, so a run suspended or
      // cancelled at its first Codex node still names the worktree it keeps.
      await options.onWorktree(request.worktreeRef);
      const worktree = await options.worktrees.resolvePath(request.worktreeRef);
      const identity = await isolatedIdentity(root, options.codex.identityDirectory);
      const cwd = await readScopeView(root, worktree, session.node, request);
      const state: CodexNodeState = { structured: undefined, quota: undefined, failure: undefined, toolRequests: 0 };
      const model = session.node.driver.model;
      const finished = await runDriverSession({
        driver: codexDriver(options, session, provider, { cwd, ...identity }),
        startRequest: startRequest(options, model),
        signal: control.signal === undefined ? stop.signal : AbortSignal.any([stop.signal, control.signal]),
        observe: (event) => observeCodex(event, state, control, model, stop)
      });
      settled(state, finished.errorCodes);
      const completed = finished.outcome === "completed" && state.structured !== undefined;
      const outputRefs = completed ? [await options.payloads.put(resultBytes(state.structured!))] : [];
      await provider.unlessInterrupted(() =>
        control.checkpoint("driver-finished", {
          outcome: finished.outcome,
          toolRequests: state.toolRequests,
          errorCodes: [...finished.errorCodes]
        })
      );
      assertStructuredAnswer(finished.outcome, finished.errorCodes);
      return Object.freeze({ status: finished.outcome, outputRefs: Object.freeze(outputRefs) });
    } finally {
      await provider.end();
      await removeMaterializedView(join(root, "scope"));
      await rm(root, { recursive: true, force: true });
    }
  };
  return {
    execute,
    cancel: () => {
      stop.abort("cancelled by the executor");
      return Promise.resolve();
    }
  };
}
