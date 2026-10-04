// DETERMINISTIC FAKES - not a provider, not Strands. In-memory stand-ins for the
// ports the coordinated driver is given: the payload store a node's session
// puts its result in, the Run record's coordination members, scripted node
// sessions, and engines that order nodes faithfully or, on purpose, wrongly.
import { createHash } from "node:crypto";

import { CoordinatedDriver, normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { validTaskRequestV2 } from "./task-request-fixture.mjs";

export const WORKTREE = "worktree:coordinated";
export const DONE = Object.freeze({ outcome: "done", summary: "finished" });

export function coordinatedRequest(mode = "graph", mutate = undefined) {
  const request = validTaskRequestV2(mode);
  mutate?.(request);
  return normalizeTaskRequest(request);
}

// why: a plan normalization would refuse, for the checks that must hold even
// if an engine is handed one (defence in depth).
export function withExecution(request, execution) {
  return { ...request, execution: { ...request.execution, ...execution } };
}

// why: two nodes with no edge between them, readers cloned from the graph's
// planner or writers cloned from its builder, so an engine may start both.
export function twoIndependent(request, writers, concurrency) {
  const [plan, build] = request.execution.nodes;
  const first = writers ? { ...build, nodeId: "left", inputs: [] } : { ...plan, nodeId: "left" };
  const second = writers ? { ...build, nodeId: "right", inputs: [] } : { ...plan, nodeId: "right" };
  return withExecution(request, {
    nodes: [first, second],
    edges: [],
    limits: { ...request.execution.limits, concurrency }
  });
}

export const resultBytes = (value) => new TextEncoder().encode(canonicalizeJsonV2(value));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// why: the composition root hands the driver the canonical digest of a record;
// this is the same function over the domain's canonical JSON.
export const canonicalRecordDigest = (record) => `sha256:${sha256(canonicalizeJsonV2(record))}`;

export class MemoryPayloads {
  #entries = new Map();

  async put(bytes) {
    const reference = `payload:sha256:${sha256(bytes)}`;
    this.#entries.set(reference, Uint8Array.from(bytes));
    return reference;
  }

  async putRaw(bytes) {
    return this.put(bytes);
  }

  async get(reference) {
    const bytes = this.#entries.get(reference);
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }
}

export class MemoryRecords {
  ledger = undefined;
  results = new Map();
  ledgerWrites = 0;

  async loadLedger() {
    return this.ledger === undefined ? undefined : structuredClone(this.ledger);
  }

  async saveLedger(ledger) {
    this.ledgerWrites += 1;
    this.ledger = structuredClone(ledger);
  }

  async saveResult(bytes) {
    const digest = `sha256:${sha256(bytes)}`;
    this.results.set(digest, Uint8Array.from(bytes));
    return digest;
  }

  async loadResult(digest) {
    const bytes = this.results.get(digest);
    if (bytes === undefined) throw new Error("no such result");
    return Uint8Array.from(bytes);
  }
}

export function aborted(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// invariant: every node session the driver starts is recorded with what it
// was given; a script decides, per node, what the session does and answers.
export function scriptedNodes(payloads, script = {}) {
  const state = { sessions: [], cancels: [], active: 0, writersActive: 0, maximumWriters: 0, maximumActive: 0 };
  const run = async (session, request, control) => {
    const writer = session.node.writeScope.length > 0;
    state.active += 1;
    state.maximumActive = Math.max(state.maximumActive, state.active);
    if (writer) {
      state.writersActive += 1;
      state.maximumWriters = Math.max(state.maximumWriters, state.writersActive);
    }
    try {
      const behavior = script[session.node.nodeId] ?? (async () => ({ result: DONE }));
      const answer = await behavior({ session, request, control, state });
      if (answer.status !== undefined) return answer;
      const bytes = answer.bytes ?? resultBytes(answer.result);
      return { status: "completed", outputRefs: [await payloads.put(bytes)] };
    } finally {
      state.active -= 1;
      if (writer) state.writersActive -= 1;
    }
  };
  return {
    state,
    driver(session) {
      state.sessions.push(session);
      return {
        execute: (request, control) => run(session, request, control),
        cancel: async (worktreeRef) => {
          state.cancels.push({ nodeId: session.node.nodeId, worktreeRef });
        }
      };
    }
  };
}

function topological(plan) {
  const order = [];
  const pending = plan.nodes.map((node) => node.nodeId);
  const edges = plan.mode === "graph" ? plan.edges : [];
  while (pending.length > 0) {
    const index = pending.findIndex((nodeId) =>
      edges.filter((edge) => edge.to === nodeId).every((edge) => order.includes(edge.from))
    );
    order.push(...pending.splice(index, 1));
  }
  return order;
}

function settled(signal, error) {
  return signal.aborted ? { status: "cancelled" } : { status: "failed", code: error?.code ?? "VES_TEST_ENGINE" };
}

// A faithful engine: a graph in dependency order, one node at a time; a swarm
// from its start along each declared handoff until a node ends it.
export const sequentialEngine = Object.freeze({
  async run({ plan, runner, signal }) {
    try {
      if (plan.mode === "swarm") {
        let next = plan.start;
        while (next !== "<complete>") next = (await runner.run({ nodeId: next })).handoff.next;
      } else for (const nodeId of topological(plan)) await runner.run({ nodeId });
      return { status: "completed" };
    } catch (error) {
      return settled(signal, error);
    }
  }
});

// A scripted engine: each group of node identifiers is started at once, the
// groups one after another, whatever the plan says; it reports `completed`
// unless a node failed.
export function scriptedEngine(groups, options = {}) {
  return {
    inputs: [],
    async run(input) {
      this.inputs.push(input);
      try {
        for (const group of groups) await Promise.all(group.map((nodeId) => input.runner.run({ nodeId })));
        return options.outcome ?? { status: "completed" };
      } catch (error) {
        return settled(input.signal, error);
      }
    }
  };
}

export function control(overrides = {}) {
  const state = { tools: [], checkpoints: [], usage: [] };
  return {
    state,
    control: {
      signal: overrides.signal,
      invokeTool: async (request) => {
        state.tools.push(request);
        return { receiptRef: `receipt:${state.tools.length}` };
      },
      checkpoint: async (stage, data) => {
        state.checkpoints.push({ stage, data });
        return `checkpoint:${state.checkpoints.length}`;
      },
      reportUsage: (event) => state.usage.push(event),
      ...overrides.control
    }
  };
}

export function driverRequest(request) {
  return {
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
    runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
    task: request.task,
    worktreeRef: WORKTREE,
    contextRef: "context:001",
    checkpoint: undefined,
    capabilityGrantRefs: ["grant:writer:001"]
  };
}

export function coordinatedDriver(request, overrides = {}) {
  const payloads = overrides.payloads ?? new MemoryPayloads();
  const records = overrides.records ?? new MemoryRecords();
  const nodes = overrides.nodes ?? scriptedNodes(payloads, overrides.script);
  const engine = overrides.engine ?? sequentialEngine;
  const driver = new CoordinatedDriver({
    request,
    engine: async () => engine,
    nodes,
    payloads,
    records,
    context: "fixture repository context",
    remainingDurationMs: () => 60_000,
    now: () => new Date("2026-10-03T12:00:00.000Z"),
    ...(overrides.feedback === undefined ? {} : { feedback: overrides.feedback }),
    ...(overrides.changeDigest === undefined ? {} : { changeDigest: overrides.changeDigest }),
    ...(overrides.reconcile === undefined ? {} : { reconcile: overrides.reconcile }),
    ...(overrides.withheld === undefined ? {} : { withheld: overrides.withheld }),
    // why: `digest: null` stands for a composition that gives no digest port.
    ...(overrides.digest === null ? {} : { digest: overrides.digest ?? canonicalRecordDigest })
  });
  return { driver, payloads, records, nodes, engine };
}

export function rejectsWith(code) {
  return (error) => {
    if (error?.code !== code) throw new Error(`expected ${code}, got ${error?.code}: ${error?.message}`);
    return true;
  };
}
