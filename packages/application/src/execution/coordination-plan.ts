import { isWithinTaskScope, namesGitMetadata, taskPathsOverlap } from "@verchestra/domain";

import type { AtomicExecutionTask } from "./task-executor.ts";

// invariant: a coordination plan is the normalized execution descriptor of a
// Task Request v2 (AD-069). It names no SDK, schema library, or provider SDK
// (SSI-11), and it carries every limit at its effective value (SSI-23), so a
// change of a default can never alter what an approval already bound.

export type CoordinationMode = "agent" | "graph" | "swarm";
export type CoordinationDriverId = "claude-code" | "codex";

export interface CoordinationNode {
  readonly nodeId: string;
  readonly driver: { readonly driverId: CoordinationDriverId; readonly model: string };
  readonly description: string;
  readonly instructions: string;
  readonly readScope: readonly string[];
  readonly writeScope: readonly string[];
  readonly inputs: readonly string[];
}

export interface CoordinationEdge {
  readonly from: string;
  readonly to: string;
}

export interface CoordinationHandoff {
  readonly from: string;
  readonly to: readonly string[];
}

export interface CoordinationLimits {
  readonly concurrency: number;
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxSwarmAgents: number;
  readonly maxHandoffs: number;
  readonly nodeResultBytes: number;
  readonly runResultBytes: number;
}

interface CoordinationMembers {
  readonly nodes: readonly CoordinationNode[];
  readonly limits: CoordinationLimits;
}

export type CoordinationPlan =
  | (CoordinationMembers & { readonly mode: "agent" })
  | (CoordinationMembers & { readonly mode: "graph"; readonly edges: readonly CoordinationEdge[] })
  | (CoordinationMembers & {
      readonly mode: "swarm";
      readonly start: string;
      readonly handoffs: readonly CoordinationHandoff[];
    });

// invariant: SSI-37. A limit a descriptor does not declare takes this value.
export const COORDINATION_LIMIT_DEFAULTS: CoordinationLimits = Object.freeze({
  concurrency: 1,
  maxNodes: 64,
  maxEdges: 128,
  maxSwarmAgents: 8,
  maxHandoffs: 32,
  nodeResultBytes: 64 * 1024,
  runResultBytes: 256 * 1024
});

// invariant: SSI-38. A declared limit may raise its default up to this value
// and no further; the raise is bound by the approval with the rest of the plan.
export const COORDINATION_LIMIT_CEILINGS: CoordinationLimits = Object.freeze({
  concurrency: 4,
  maxNodes: 256,
  maxEdges: 512,
  maxSwarmAgents: 16,
  maxHandoffs: 128,
  nodeResultBytes: 256 * 1024,
  runResultBytes: 1024 * 1024
});

// invariant: a writer node is a Claude Code node with a non-empty write
// scope; every other node only reads.
export function isWriterNode(node: CoordinationNode): boolean {
  return node.driver.driverId === "claude-code" && node.writeScope.length > 0;
}

function sizeFault(plan: CoordinationPlan): string | undefined {
  const { nodes, limits } = plan;
  switch (plan.mode) {
    case "agent":
      return nodes.length === 1 ? undefined : "an agent runs exactly one node";
    case "graph":
      if (nodes.length > limits.maxNodes) return "the graph has more nodes than its node limit";
      return plan.edges.length > limits.maxEdges ? "the graph has more edges than its edge limit" : undefined;
    case "swarm":
      return nodes.length >= 2 && nodes.length <= limits.maxSwarmAgents
        ? undefined
        : "a swarm runs at least two nodes and no more than its agent limit";
  }
}

// invariant: SSI-26 and SSI-18. Every scope stays inside the task's change
// scope in the letter case it is written there; a write scope is clear of
// every protected path, in any letter case and in either direction, and of
// Git metadata; a Codex node never writes.
function scopeFault(nodes: readonly CoordinationNode[], task: AtomicExecutionTask): string | undefined {
  for (const node of nodes) {
    if (![...node.readScope, ...node.writeScope].every((path) => isWithinTaskScope(path, task.changeScope)))
      return "a node scope leaves the task change scope";
    if (node.driver.driverId === "codex" && node.writeScope.length > 0) return "a Codex node declares a write scope";
    const covers = (path: string) => task.protectedPaths.some((entry) => taskPathsOverlap(path, entry));
    if (node.writeScope.some((path) => namesGitMetadata(path) || covers(path)))
      return "a write scope covers a protected path";
  }
  return undefined;
}

// invariant: called only once every edge names a known node, so each lookup
// below finds the list it asks for.
function adjacency(nodes: readonly CoordinationNode[]): Map<string, string[]> {
  return new Map(nodes.map((node) => [node.nodeId, []]));
}

// why: Kahn's order. A node enters only after all of its parents, so a node
// on a cycle, or behind one, never enters and no source reaches it.
function ancestry(
  nodes: readonly CoordinationNode[],
  edges: readonly CoordinationEdge[]
): ReadonlyMap<string, ReadonlySet<string>> | undefined {
  const parents = adjacency(nodes);
  const children = adjacency(nodes);
  for (const edge of edges) {
    parents.get(edge.to)!.push(edge.from);
    children.get(edge.from)!.push(edge.to);
  }
  const waiting = new Map([...parents].map(([nodeId, list]) => [nodeId, list.length]));
  const ready = [...waiting].filter(([, count]) => count === 0).map(([nodeId]) => nodeId);
  const ancestors = new Map<string, ReadonlySet<string>>();
  for (let next = ready.shift(); next !== undefined; next = ready.shift()) {
    ancestors.set(next, new Set(parents.get(next)!.flatMap((parent) => [parent, ...ancestors.get(parent)!])));
    for (const child of children.get(next)!) {
      waiting.set(child, waiting.get(child)! - 1);
      if (waiting.get(child) === 0) ready.push(child);
    }
  }
  return ancestors.size === nodes.length ? ancestors : undefined;
}

function ordered(ancestors: ReadonlyMap<string, ReadonlySet<string>>, left: string, right: string): boolean {
  return ancestors.get(left)?.has(right) === true || ancestors.get(right)?.has(left) === true;
}

// invariant: SSI-25 and SSI-26. A graph (an agent is a graph of one node and
// no edge) is acyclic, every node is reached from a source, every input is an
// ancestor of its node, and any two writers are ordered by a path, so no two
// writers can ever be ready at once.
function graphFault(nodes: readonly CoordinationNode[], edges: readonly CoordinationEdge[]): string | undefined {
  const known = new Set(nodes.map((node) => node.nodeId));
  if (edges.some((edge) => !known.has(edge.from) || !known.has(edge.to))) return "an edge names an unknown node";
  const ancestors = ancestry(nodes, edges);
  if (ancestors === undefined) return "the graph has a cycle or a node no source reaches";
  if (nodes.some((node) => node.inputs.some((input) => ancestors.get(node.nodeId)?.has(input) !== true)))
    return "an input is not an ancestor of its node";
  const writers = nodes.filter(isWriterNode).map((node) => node.nodeId);
  if (writers.some((writer, index) => writers.slice(index + 1).some((other) => !ordered(ancestors, writer, other))))
    return "two writer nodes are not ordered by a path";
  return undefined;
}

// invariant: SSI-27. A swarm starts at one of its nodes, each node hands off
// only to other declared nodes from at most one handoff entry, and no swarm
// node takes inputs: what reaches a node is its handoff message.
function swarmFault(
  nodes: readonly CoordinationNode[],
  start: string,
  handoffs: readonly CoordinationHandoff[]
): string | undefined {
  const known = new Set(nodes.map((node) => node.nodeId));
  if (!known.has(start)) return "the swarm start names an unknown node";
  if (nodes.some((node) => node.inputs.length > 0)) return "a swarm node declares inputs";
  if (new Set(handoffs.map((handoff) => handoff.from)).size !== handoffs.length)
    return "a node is listed twice as a handoff source";
  for (const handoff of handoffs)
    if (!known.has(handoff.from) || handoff.to.some((target) => target === handoff.from || !known.has(target)))
      return "a handoff names an unknown node or the node itself";
  return undefined;
}

function topologyFault(plan: CoordinationPlan): string | undefined {
  if (plan.mode === "swarm") return swarmFault(plan.nodes, plan.start, plan.handoffs);
  return graphFault(plan.nodes, plan.mode === "graph" ? plan.edges : []);
}

// invariant: the rules no JSON Schema can state. Each returns the first rule
// the plan breaks; the caller refuses the request before any process starts.
export function coordinationPlanFault(plan: CoordinationPlan, task: AtomicExecutionTask): string | undefined {
  if (new Set(plan.nodes.map((node) => node.nodeId)).size !== plan.nodes.length)
    return "node identifiers are not unique";
  return (
    sizeFault(plan) ??
    scopeFault(plan.nodes, task) ??
    (plan.nodes.some(isWriterNode) ? undefined : "no node writes") ??
    topologyFault(plan)
  );
}
