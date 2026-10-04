import { isTaskPath, isWithinTaskScope } from "@verchestra/domain";

import {
  coordinationErrorCode,
  stableErrorCode,
  type CoordinationEngine,
  type CoordinationNodeAnswer,
  type CoordinationNodeCall,
  type CoordinationNodeRunner
} from "./coordination-engine.ts";
import {
  uncertaintyRecord,
  unsettledVisits,
  type CoordinationLedger,
  type CoordinationRecordPort,
  type NodeVisit
} from "./coordination-ledger.ts";
import type { CoordinationMode, CoordinationNode, CoordinationPlan } from "./coordination-plan.ts";
import { executionPayloadDigest, type ExecutionPayloadPort } from "./execution-payload.ts";
import { coordinationNodePrompt } from "./node-prompt.ts";
import {
  assertResultBounds,
  COORDINATION_COMPLETE,
  CoordinationRunError,
  handoffTargets,
  nodeResultSchema,
  readNodeResult,
  type CoordinationErrorCode,
  type NodeResult
} from "./node-result.ts";
import {
  TaskExecutorError,
  type ExecutionDriverPort,
  type ExecutionDriverResult,
  type ExecutionSuspension,
  type ExecutionToolRequest
} from "./task-executor.ts";
import type { NormalizedTaskRequestV2 } from "./task-request.ts";

type Digest = `sha256:${string}`;
type ExecuteRequest = Parameters<ExecutionDriverPort["execute"]>[0];
type ExecuteControl = Parameters<ExecutionDriverPort["execute"]>[1];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Visit = Mutable<NodeVisit>;

// invariant: what the coordinated driver asks of one node's session: the
// prompt it built, and the closed schema and byte bound of the node's result.
export interface CoordinationNodeSession {
  readonly node: CoordinationNode;
  readonly visit: number;
  readonly prompt: string;
  readonly structuredOutput: { readonly schema: Readonly<Record<string, unknown>>; readonly maxBytes: number };
}

// invariant: the per-node driver factory the composition root builds from the
// existing Claude Code and Codex drivers. Each session gets a port of its own.
export interface CoordinationNodeDrivers {
  driver(session: CoordinationNodeSession): ExecutionDriverPort;
}

// invariant: SSI-49. What no persisted node result may name: the run's
// sensitive values (the credentials its sessions are given to redact), and its
// machine-local roots (absolute paths, each the root of a tree, never a
// filesystem root).
export interface WithheldText {
  readonly values: readonly string[];
  readonly roots: readonly string[];
}

export interface CoordinatedDriverOptions {
  readonly request: NormalizedTaskRequestV2;
  readonly engine: (mode: CoordinationMode) => Promise<CoordinationEngine>;
  readonly nodes: CoordinationNodeDrivers;
  readonly payloads: ExecutionPayloadPort;
  readonly records: CoordinationRecordPort;
  // invariant: the rendered repository context, presented to every node as
  // untrusted data.
  readonly context: string;
  readonly feedback?: string;
  readonly remainingDurationMs: () => number;
  readonly changeDigest?: (worktreeRef: string) => Promise<Digest>;
  // invariant: D4. The canonical digest of a record, which names a visit's
  // uncertainty record, and the one digest the owner typed back to reconcile
  // the visit it names. Without the digest no unsettled visit is run again.
  readonly digest?: (record: Readonly<Record<string, unknown>>) => Digest;
  readonly reconcile?: Digest;
  // invariant: SSI-49. Resolved once a round opens, for the worktree it runs in.
  readonly withheld?: (worktreeRef: string) => Promise<WithheldText>;
  readonly now?: () => Date;
}

const RESULT_TOKEN = "verchestra-result:";
// invariant: SSI-10. The only codes an engine's own failure is reported with;
// anything else it reports, an SDK status included, is an engine failure.
const ENGINE_CODES: readonly CoordinationErrorCode[] = [
  "VES_COORDINATION_HANDOFF_LIMIT",
  "VES_COORDINATION_LIMIT",
  "VES_COORDINATION_INTERRUPTED"
];

// invariant: SSI-58, SSI-59, and D3b. The provider signals that suspend a run
// instead of failing it: a usage allowance reported exhausted, and a Codex
// account that reports credits, which would be spent after the allowance.
const SUSPENDING_CODES: ReadonlySet<string> = new Set(["VES_DRIVER_QUOTA_EXHAUSTED", "VES_CODEX_CREDITS_PRESENT"]);
const QUOTA_SCOPE = /^[a-z][a-z0-9_]{0,63}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function reported(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

// invariant: SSI-61. The suspension a node's signal stands for: its code, the
// node's provider, when the run stopped, and only the limit window and reset
// the provider reported, each kept only in its grammar.
function suspensionOf(error: unknown, node: CoordinationNode, at: string): ExecutionSuspension | undefined {
  const reason = stableErrorCode(error);
  if (reason === undefined || !SUSPENDING_CODES.has(reason)) return undefined;
  const quota = (error as { readonly quota?: { readonly scope?: unknown; readonly resetsAt?: unknown } }).quota;
  const scope = reported(quota?.scope, QUOTA_SCOPE);
  const resetsAt = reported(quota?.resetsAt, INSTANT);
  return Object.freeze({
    reason,
    provider: node.driver.driverId,
    at,
    ...(scope === undefined ? {} : { scope }),
    ...(resetsAt === undefined ? {} : { resetsAt })
  });
}

// invariant: SSI-46 and SSI-47. A driver asked for a structured result names
// why it has none it may hand on: `<prefix>_STRUCTURED_OUTPUT_MISSING` or
// `_INVALID` for no answer or one that is not JSON, `_LIMIT` for one over the
// node's bound (driver-structured-output.ts).
const STRUCTURED_REFUSALS: readonly (readonly [suffix: string, code: CoordinationErrorCode, message: string])[] = [
  ["_STRUCTURED_OUTPUT_MISSING", "VES_COORDINATION_RESULT_INVALID", "The node gave no structured result"],
  ["_STRUCTURED_OUTPUT_INVALID", "VES_COORDINATION_RESULT_INVALID", "The node's structured result is unreadable"],
  ["_STRUCTURED_OUTPUT_LIMIT", "VES_COORDINATION_RESULT_TOO_LARGE", "The node's structured result exceeds its bound"]
];

// invariant: what both node adapters apply once a node's session has ended
// and its end is recorded: a session that failed for its structured answer
// fails the node with the coordination code for that refusal, never as a node
// that merely failed. Any other ending is the adapter's to report.
export function assertStructuredAnswer(outcome: string, errorCodes: readonly string[]): void {
  if (outcome !== "failed") return;
  for (const code of errorCodes) {
    const refusal = STRUCTURED_REFUSALS.find(([suffix]) => code.endsWith(suffix));
    if (refusal !== undefined) throw new CoordinationRunError(refusal[1], refusal[2]);
  }
}

// why: a path is compared without regard to letter case or separator, and a
// root is named only where the text does not go on with a name character, so
// `/home/al` is not read in `/home/alice`.
const NAME_CHARACTER = /^[\p{L}\p{N}_-]$/u;

function foldedPath(text: string): string {
  return text.replaceAll("\\", "/").toLowerCase();
}

function namesRoot(text: string, root: string): boolean {
  for (let at = text.indexOf(root); at >= 0; at = text.indexOf(root, at + 1))
    if (!NAME_CHARACTER.test(text.charAt(at + root.length))) return true;
  return false;
}

// invariant: SSI-49 and SSI-81. A node result is the model's own text, and it
// is persisted and handed to later nodes, so one that names a sensitive value
// or a machine-local root of the run is refused before it is persisted.
function assertWithheld(result: NodeResult, withheld: WithheldText | undefined): void {
  if (withheld === undefined) return;
  const roots = withheld.roots.map(foldedPath);
  for (const text of [result.summary, result.message ?? ""]) {
    const folded = foldedPath(text);
    if (
      withheld.values.some((value) => value.length > 0 && text.includes(value)) ||
      roots.some((root) => namesRoot(folded, root))
    )
      failure("VES_COORDINATION_RESULT_INVALID", "The node result names a sensitive value or a machine-local path");
  }
}

function visitKey(entry: { readonly nodeId: string; readonly visit: number }): string {
  return `${entry.nodeId}#${entry.visit}`;
}

function isWriter(node: CoordinationNode): boolean {
  return node.driver.driverId === "claude-code" && node.writeScope.length > 0;
}

function logicalPath(path: string): string {
  return path.replaceAll(/\/{2,}/gu, "/").replace(/\/$/u, "");
}

// invariant: SSI-41. A node writes or deletes only inside its own write scope,
// refused here before the request reaches the executor, which then applies
// the task scope, protected paths, the grant, and tool-effect authority again.
// A reader node has no write scope, so every effect it asks for is refused.
export function assertNodeWriteScope(node: CoordinationNode, request: ExecutionToolRequest): void {
  const targets: unknown = (request as { readonly targetPaths?: unknown } | undefined)?.targetPaths;
  const inside = (path: unknown) =>
    typeof path === "string" && isTaskPath(path) && isWithinTaskScope(logicalPath(path), node.writeScope);
  if (!Array.isArray(targets) || targets.length === 0 || !targets.every(inside))
    throw new CoordinationRunError(
      "VES_COORDINATION_SCOPE_DENIED",
      "The tool target is outside the node's write scope"
    );
}

// invariant: SSI-40. Writer nodes of a run hold this in turn; normalization
// already orders writers, so it is defence in depth against an engine that
// makes two writers ready at once.
class WriterMutex {
  #tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = this.#tail.then(() => release);
    this.#tail = this.#tail.then(() => held);
    return ready;
  }
}

function failure(code: CoordinationErrorCode, message: string): never {
  throw new CoordinationRunError(code, message);
}

// invariant: one execution of a coordination plan inside the task's single
// executor run. It is the only runner an engine is given: it owns the node
// ledger, the order and destination rules, the writer rule, the scopes, and
// every limit, so an engine that misroutes or races fails the run instead of
// steering it.
class CoordinationRound implements CoordinationNodeRunner {
  readonly #options: CoordinatedDriverOptions;
  readonly #request: ExecuteRequest;
  readonly #control: ExecuteControl;
  readonly #abort: AbortController;
  readonly #plan: CoordinationPlan;
  readonly #writer = new WriterMutex();
  readonly #running = new Set<ExecutionDriverPort>();
  readonly #results = new Map<Visit, NodeResult>();
  readonly #calls = new Set<Promise<unknown>>();
  readonly #reruns = new Map<string, Digest>();
  readonly #walk: Visit[] = [];
  #earlier: readonly NodeVisit[] = [];
  #entries: Visit[] = [];
  #round = 1;
  #live = 0;
  #saving: Promise<void> = Promise.resolve();
  #failure: Error | undefined;
  #suspension: ExecutionSuspension | undefined;
  #withheld: WithheldText | undefined;

  constructor(
    options: CoordinatedDriverOptions,
    request: ExecuteRequest,
    control: ExecuteControl,
    abort: AbortController
  ) {
    this.#options = options;
    this.#request = request;
    this.#control = control;
    this.#abort = abort;
    this.#plan = options.request.execution;
  }

  get failed(): Error | undefined {
    return this.#failure;
  }

  get suspension(): ExecutionSuspension | undefined {
    return this.#suspension;
  }

  cancelRunning(worktreeRef: string): Promise<unknown> {
    return Promise.allSettled([...this.#running].map((driver) => driver.cancel(worktreeRef)));
  }

  // invariant: a running round is resumed and its completed visits are
  // replayed; a visit that never completed runs again only when it left no
  // effect or the owner reconciled it, and otherwise nothing runs (SSI-65..67).
  // A finished round is followed by the next, which is a gate repair attempt.
  async open(): Promise<void> {
    this.#withheld = await this.#options.withheld?.(this.#request.worktreeRef);
    const stored = await this.#options.records.loadLedger();
    if (stored !== undefined && stored.mode !== this.#plan.mode)
      failure("VES_COORDINATION_LEDGER_INVALID", "The node ledger belongs to another plan");
    if (stored?.roundState === "running") {
      this.#round = stored.round;
      this.#earlier = stored.visits.filter((entry) => entry.round !== stored.round);
      this.#entries = stored.visits.filter((entry) => entry.round === stored.round).map((entry) => ({ ...entry }));
      await this.#admitReruns();
      return;
    }
    this.#round = stored === undefined ? 1 : stored.round + 1;
    this.#earlier = stored?.visits ?? [];
    await this.#save("running");
  }

  // invariant: SSI-66 and D4. Each unsettled visit is named by the digest of
  // its uncertainty record. One that left no effect runs again on its own
  // (SSI-67); one that may have is run again only when the owner typed back
  // that digest. Any other refuses the resume: a visit with no recorded end is
  // marked uncertain, the round stays open, and nothing runs.
  async #admitReruns(): Promise<void> {
    const ledger = { schemaVersion: 1, mode: this.#plan.mode, round: this.#round, roundState: "running" } as const;
    const current = await this.#changeDigest();
    const unsettled = unsettledVisits({ ...ledger, visits: this.#entries }, current.changeDigestBefore);
    const refused: Visit[] = [];
    for (const { visit, effect } of unsettled) {
      const digest = this.#options.digest?.(uncertaintyRecord(this.#request.runId, visit));
      if (digest !== undefined && (effect === "none" || digest === this.#options.reconcile))
        this.#reruns.set(visitKey(visit), digest);
      else refused.push(visit as Visit);
    }
    if (refused.length === 0) return;
    for (const entry of refused) if (entry.state === "started") entry.state = "uncertain";
    await this.#save("running");
    failure("VES_TASK_NODE_UNCERTAIN", "A node of the interrupted run may have landed effects and is not reconciled");
  }

  async run(call: CoordinationNodeCall): Promise<CoordinationNodeAnswer> {
    const pending = this.#call(call);
    this.#calls.add(pending);
    try {
      return await pending;
    } finally {
      this.#calls.delete(pending);
    }
  }

  async #call(call: CoordinationNodeCall): Promise<CoordinationNodeAnswer> {
    let node: CoordinationNode | undefined;
    try {
      this.#assertOpen();
      const named = this.#node(call.nodeId);
      node = named;
      const visit = this.#walk.filter((entry) => entry.nodeId === named.nodeId).length + 1;
      this.#assertOrder(named, visit);
      return (await this.#replay(named, visit)) ?? (await this.#runLive(named, visit));
    } catch (error) {
      this.#fail(error, node);
      throw error;
    }
  }

  // invariant: SSI-59 seam. The first failure stops scheduling and cancels
  // every running node; it stays the run's reason whatever follows it. When
  // it is a provider's usage signal, the run suspends instead of failing, and
  // the first signal is the one recorded.
  #fail(error: unknown, node: CoordinationNode | undefined): void {
    if (this.#abort.signal.aborted) return;
    this.#failure =
      error instanceof Error && stableErrorCode(error) !== undefined
        ? error
        : new CoordinationRunError("VES_COORDINATION_NODE_FAILED", "A node failed", { cause: error });
    this.#suspension = node === undefined ? undefined : suspensionOf(error, node, this.#now());
    this.#abort.abort("coordination failed");
  }

  // invariant: SSI-60. A suspended round ends only once every node it started
  // has ended and been recorded failed or partial, so no session runs on and
  // the ledger is durable; the round stays `running`, so a resume continues it.
  async drain(): Promise<void> {
    await Promise.allSettled([...this.#calls]);
    await this.#saving;
  }

  #assertOpen(): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#abort.signal.aborted) throw new TaskExecutorError("VES_EXECUTOR_CANCELLED", "The run was cancelled");
  }

  #node(nodeId: string): CoordinationNode {
    return (
      this.#plan.nodes.find((node) => node.nodeId === nodeId) ??
      failure("VES_COORDINATION_ORDER_INVALID", "The engine named a node outside the plan")
    );
  }

  #completed(nodeId: string): Visit | undefined {
    return this.#walk.findLast((entry) => entry.nodeId === nodeId && entry.state === "completed");
  }

  #assertOrder(node: CoordinationNode, visit: number): void {
    if (this.#plan.mode === "swarm") return this.#assertHandoff(node, this.#plan.start);
    if (visit > 1) failure("VES_COORDINATION_LIMIT", "A graph node runs once per round");
    const parents = this.#plan.mode === "graph" ? this.#plan.edges.filter((edge) => edge.to === node.nodeId) : [];
    if (parents.some((edge) => this.#completed(edge.from) === undefined))
      failure("VES_COORDINATION_ORDER_INVALID", "A node started before every node it depends on completed");
  }

  // invariant: SSI-43. A swarm starts at its declared start, and every later
  // visit is the destination the previous node declared.
  #assertHandoff(node: CoordinationNode, start: string): void {
    const previous = this.#walk.at(-1);
    const expected = previous === undefined ? start : this.#pendingHandoff(previous);
    if (expected === undefined)
      failure("VES_COORDINATION_ORDER_INVALID", "The swarm ran a node with no handoff pending");
    if (expected !== node.nodeId)
      failure("VES_COORDINATION_HANDOFF_UNDECLARED", "The swarm handed off to an undeclared destination");
  }

  #pendingHandoff(previous: Visit): string | undefined {
    const next = previous.state === "completed" ? this.#results.get(previous)?.next : undefined;
    return next === COORDINATION_COMPLETE ? undefined : next;
  }

  // invariant: SSI-65. A visit is replayed from its persisted result when its
  // latest entry completed; an entry a re-run replaced is never replayed.
  async #replay(node: CoordinationNode, visit: number): Promise<CoordinationNodeAnswer | undefined> {
    const entry = this.#entries.findLast((stored) => visitKey(stored) === visitKey({ nodeId: node.nodeId, visit }));
    if (entry?.state !== "completed" || entry.resultDigest === undefined || this.#walk.includes(entry))
      return undefined;
    const bytes = await this.#options.records.loadResult(entry.resultDigest);
    if (bytes.byteLength !== entry.resultBytes)
      failure("VES_COORDINATION_LEDGER_INVALID", "A persisted node result does not match its ledger entry");
    const result = readNodeResult(bytes, this.#plan, node.nodeId);
    this.#walk.push(entry);
    this.#results.set(entry, result);
    return this.#answer(node, entry.resultDigest, result);
  }

  #answer(node: CoordinationNode, digest: Digest, result: NodeResult): CoordinationNodeAnswer {
    const resultToken = `${RESULT_TOKEN}payload:${digest}`;
    if (this.#plan.mode !== "swarm") return Object.freeze({ nodeId: node.nodeId, resultToken });
    return Object.freeze({
      nodeId: node.nodeId,
      resultToken,
      handoff: Object.freeze({ next: result.next as string, message: result.message as string })
    });
  }

  async #runLive(node: CoordinationNode, visit: number): Promise<CoordinationNodeAnswer> {
    this.#live += 1;
    try {
      if (this.#live > this.#plan.limits.concurrency)
        failure("VES_COORDINATION_LIMIT", "More nodes ran at once than the concurrency limit");
      const release = isWriter(node) ? await this.#writer.acquire() : () => undefined;
      try {
        this.#assertOpen();
        return await this.#visit(node, visit);
      } finally {
        release();
      }
    } finally {
      this.#live -= 1;
    }
  }

  async #visit(node: CoordinationNode, visit: number): Promise<CoordinationNodeAnswer> {
    const rerunOf = this.#reruns.get(visitKey({ nodeId: node.nodeId, visit }));
    const entry: Visit = {
      round: this.#round,
      nodeId: node.nodeId,
      visit,
      state: "started",
      startedAt: this.#now(),
      receiptCount: 0,
      ...(await this.#changeDigest()),
      ...(rerunOf === undefined ? {} : { rerunOf })
    };
    const prompt = this.#prompt(node);
    this.#walk.push(entry);
    this.#entries.push(entry);
    // invariant: the visit is durable as started before its session exists.
    await this.#save("running");
    let bytes: Uint8Array;
    try {
      bytes = await this.#session(node, entry, prompt);
    } catch (error) {
      await this.#end(entry, coordinationErrorCode(error));
      throw error;
    }
    return this.#settle(node, entry, bytes);
  }

  async #changeDigest(): Promise<{ readonly changeDigestBefore?: Digest }> {
    const inspect = this.#options.changeDigest;
    return inspect === undefined ? {} : { changeDigestBefore: await inspect(this.#request.worktreeRef) };
  }

  #prompt(node: CoordinationNode): string {
    const previous = this.#walk.at(-1);
    const decision = previous === undefined ? undefined : this.#results.get(previous);
    const inputs = node.inputs.map((nodeId) => {
      const entry = this.#completed(nodeId);
      const result = entry === undefined ? undefined : this.#results.get(entry);
      return result === undefined
        ? failure("VES_COORDINATION_ORDER_INVALID", "A declared input has no result")
        : { nodeId, result };
    });
    return coordinationNodePrompt({
      request: this.#options.request,
      node,
      targets: handoffTargets(this.#plan, node.nodeId),
      inputs,
      ...(this.#plan.mode === "swarm" && previous !== undefined && decision?.message !== undefined
        ? { handoff: { from: previous.nodeId, message: decision.message } }
        : {}),
      ...(this.#options.feedback === undefined ? {} : { feedback: this.#options.feedback }),
      context: this.#options.context
    });
  }

  async #session(node: CoordinationNode, entry: Visit, prompt: string): Promise<Uint8Array> {
    const driver = this.#options.nodes.driver({
      node,
      visit: entry.visit,
      prompt,
      structuredOutput: {
        schema: nodeResultSchema(this.#plan, node.nodeId),
        maxBytes: this.#plan.limits.nodeResultBytes
      }
    });
    this.#running.add(driver);
    try {
      const result = await driver.execute(this.#request, this.#narrowed(node, entry));
      if (result.status === "cancelled" || this.#abort.signal.aborted)
        throw new TaskExecutorError("VES_EXECUTOR_CANCELLED", "The node was cancelled");
      if (result.status !== "completed") failure("VES_COORDINATION_NODE_FAILED", "The node's session failed");
      return await this.#resultBytes(result.outputRefs);
    } finally {
      this.#running.delete(driver);
    }
  }

  // invariant: SSI-15. A node acts only through the executor's own control:
  // its writes are narrowed to the node first, its usage reaches the run's
  // meter, its checkpoints are filed under the node, and its signal is the
  // run's, so a cancel or a failure elsewhere stops it.
  #narrowed(node: CoordinationNode, entry: Visit): ExecuteControl {
    const control = this.#control;
    return {
      signal: this.#abort.signal,
      reportUsage: (event) => control.reportUsage(event),
      checkpoint: (stage, data) => control.checkpoint(`node:${node.nodeId}:${entry.visit}:${stage}`, data),
      invokeTool: async (request) => {
        assertNodeWriteScope(node, request);
        const receipt = await control.invokeTool(request);
        entry.receiptCount += 1;
        return receipt;
      }
    };
  }

  async #resultBytes(outputRefs: readonly string[]): Promise<Uint8Array> {
    const [reference] = outputRefs;
    if (outputRefs.length !== 1 || reference === undefined || executionPayloadDigest(reference) === undefined)
      failure("VES_COORDINATION_RESULT_INVALID", "The node returned no single result reference");
    const bytes = await this.#options.payloads.get(reference);
    if (bytes === undefined)
      failure("VES_COORDINATION_RESULT_INVALID", "The node's result is not in the payload store");
    return bytes;
  }

  #persistedBytes(): number {
    return [...this.#earlier, ...this.#entries].reduce((total, entry) => total + (entry.resultBytes ?? 0), 0);
  }

  // invariant: SSI-46, SSI-47, and SSI-49. A result is bounded, then
  // validated, then screened, then persisted by digest, and only then is the
  // visit completed; a refused result leaves nothing persisted.
  async #settle(node: CoordinationNode, entry: Visit, bytes: Uint8Array): Promise<CoordinationNodeAnswer> {
    let result: NodeResult;
    let digest: Digest;
    try {
      assertResultBounds(bytes.byteLength, this.#persistedBytes(), this.#plan.limits);
      result = readNodeResult(bytes, this.#plan, node.nodeId);
      assertWithheld(result, this.#withheld);
      digest = await this.#options.records.saveResult(bytes);
    } catch (error) {
      await this.#end(entry, coordinationErrorCode(error));
      throw error;
    }
    entry.resultDigest = digest;
    entry.resultBytes = bytes.byteLength;
    this.#results.set(entry, result);
    const refused = this.#refusal(result);
    await this.#end(entry, refused);
    if (refused !== undefined) failure(refused, "The node's result ends the run");
    return this.#answer(node, digest, result);
  }

  // invariant: SSI-45. A decision that would take a handoff beyond the limit
  // ends the run, so no visit past the limit ever starts.
  #refusal(result: NodeResult): CoordinationErrorCode | undefined {
    if (result.outcome === "blocked") return "VES_COORDINATION_NODE_BLOCKED";
    const pending = this.#plan.mode === "swarm" && result.next !== COORDINATION_COMPLETE;
    return pending && this.#walk.length > this.#plan.limits.maxHandoffs ? "VES_COORDINATION_HANDOFF_LIMIT" : undefined;
  }

  async #end(entry: Visit, failureCode: string | undefined): Promise<void> {
    entry.endedAt = this.#now();
    if (failureCode === undefined) entry.state = "completed";
    else {
      entry.state = entry.receiptCount > 0 ? "partial" : "failed";
      entry.failureCode = failureCode;
    }
    await this.#save("running");
  }

  // invariant: ledger writes are serialized and each writes the whole
  // ledger, so concurrent reader nodes can never interleave a stale one.
  #save(roundState: CoordinationLedger["roundState"]): Promise<void> {
    const ledger: CoordinationLedger = {
      schemaVersion: 1,
      mode: this.#plan.mode,
      round: this.#round,
      roundState,
      visits: [...this.#earlier, ...this.#entries].map((entry) => Object.freeze({ ...entry }))
    };
    this.#saving = this.#saving.then(() => this.#options.records.saveLedger(ledger));
    return this.#saving;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  // invariant: an engine that says it completed is believed only when the
  // plan was walked to its end: every graph node completed, or the swarm's
  // last node chose to end it.
  assertEnded(): void {
    if (this.#plan.mode === "swarm") {
      const last = this.#walk.at(-1);
      if (last?.state !== "completed" || this.#results.get(last)?.next !== COORDINATION_COMPLETE)
        failure("VES_COORDINATION_INCOMPLETE", "The swarm ended without a node choosing to end it");
      return;
    }
    if (this.#plan.nodes.some((node) => this.#completed(node.nodeId) === undefined))
      failure("VES_COORDINATION_INCOMPLETE", "The engine ended before every node completed");
  }

  async close(roundState: "completed" | "failed"): Promise<void> {
    await this.#save(roundState);
  }
}

function engineCode(code: string): CoordinationErrorCode {
  return ENGINE_CODES.find((known) => known === code) ?? "VES_COORDINATION_ENGINE_FAILED";
}

// invariant: AD-068. The executor's driver port over a coordination plan: one
// worktree, one writer lease, one capability grant, one budget meter, and one
// cancellation signal cover every node, and the gates, repair, verification,
// and review that follow the executor are unchanged.
export class CoordinatedDriver implements ExecutionDriverPort {
  readonly #options: CoordinatedDriverOptions;
  readonly #rounds = new Map<string, { readonly round: CoordinationRound; readonly abort: AbortController }>();

  constructor(options: CoordinatedDriverOptions) {
    this.#options = options;
  }

  async cancel(worktreeRef: string): Promise<void> {
    const active = this.#rounds.get(worktreeRef);
    if (active === undefined) return;
    active.abort.abort("cancelled by the executor");
    await active.round.cancelRunning(worktreeRef);
  }

  async execute(request: ExecuteRequest, control: ExecuteControl) {
    const abort = new AbortController();
    const forward = () => abort.abort("cancelled by the caller");
    if (control.signal?.aborted === true) abort.abort("cancelled before start");
    control.signal?.addEventListener("abort", forward, { once: true });
    const round = new CoordinationRound(this.#options, request, control, abort);
    this.#rounds.set(request.worktreeRef, { round, abort });
    try {
      await round.open();
      const engine = await this.#options.engine(this.#options.request.execution.mode);
      const outcome = await engine.run({
        plan: this.#options.request.execution,
        runner: round,
        signal: abort.signal,
        timeoutMs: Math.max(1, Math.floor(this.#options.remainingDurationMs()))
      });
      return await this.#conclude(round, outcome, abort.signal);
    } finally {
      control.signal?.removeEventListener("abort", forward);
      this.#rounds.delete(request.worktreeRef);
    }
  }

  async #conclude(
    round: CoordinationRound,
    outcome: Awaited<ReturnType<CoordinationEngine["run"]>>,
    signal: AbortSignal
  ): Promise<ExecutionDriverResult> {
    const suspension = round.suspension;
    if (suspension !== undefined) {
      await round.drain();
      return Object.freeze({ status: "suspended", outputRefs: Object.freeze([]), suspension });
    }
    const failed = round.failed;
    if (failed !== undefined) {
      await round.close("failed");
      throw failed;
    }
    if (signal.aborted || outcome.status === "cancelled") return Object.freeze({ status: "cancelled", outputRefs: [] });
    try {
      if (outcome.status === "failed") failure(engineCode(outcome.code), "The coordination engine failed");
      round.assertEnded();
    } catch (error) {
      await round.close("failed");
      throw error;
    }
    await round.close("completed");
    return Object.freeze({ status: "completed", outputRefs: Object.freeze([]) });
  }
}
