// The landing-page architecture drawing mirrors the Mermaid block at the top of
// docs/architecture.md node for node and edge for edge. It is drawn by hand as
// inline SVG because rendering Mermaid in the browser costs about 600 KB
// against the 75 KB homepage script budget, and rendering it at build time
// needs a headless browser the site may not add. The labels and the edges
// below are the drawing's only source of truth, and
// tests/unit/architecture-diagram-labels.test.mjs pins both to the Mermaid
// source so the drawing cannot drift from the document it mirrors.

export type ArchitectureTone = "violet" | "cyan" | "amber" | "plain";

export interface ArchitectureNode {
  readonly id: string;
  // The Mermaid label, verbatim.
  readonly label: string;
  // The same label split into the lines the drawing shows; a test asserts they
  // join back into `label`.
  readonly lines: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tone: ArchitectureTone;
}

export const ARCHITECTURE_VIEWBOX = { width: 1200, height: 640 } as const;

const SUBSYSTEM_WIDTH = 154;
const SUBSYSTEM_HEIGHT = 90;
const SUBSYSTEM_GAP = 16;
const SUBSYSTEM_Y = 300;
const SUBSYSTEM_X0 = 13;

const subsystemX = (index: number) => SUBSYSTEM_X0 + index * (SUBSYSTEM_WIDTH + SUBSYSTEM_GAP);

function subsystem(
  index: number,
  id: string,
  label: string,
  lines: readonly string[],
  tone: ArchitectureTone = "plain"
): ArchitectureNode {
  return {
    id,
    label,
    lines,
    x: subsystemX(index),
    y: SUBSYSTEM_Y,
    width: SUBSYSTEM_WIDTH,
    height: SUBSYSTEM_HEIGHT,
    tone
  };
}

// The evidence chain (EVIDENCE, VERIFY, HUMAN) stacks in one column.
const EVIDENCE_COLUMN_X = subsystemX(5);

export const architectureNodes: readonly ArchitectureNode[] = [
  { id: "CLI", label: "vestra CLI", lines: ["vestra CLI"], x: 500, y: 20, width: 200, height: 56, tone: "plain" },
  {
    id: "APP",
    label: "Application workflows",
    lines: ["Application workflows"],
    x: 400,
    y: 130,
    width: 400,
    height: 70,
    tone: "violet"
  },
  subsystem(0, "DOMAIN", "Domain state and policy contracts", ["Domain state and", "policy contracts"]),
  subsystem(1, "WORKSPACE", "Workspace and Git adapters", ["Workspace and", "Git adapters"]),
  subsystem(2, "DRIVERS", "Claude · Codex · OpenCode drivers", ["Claude · Codex ·", "OpenCode drivers"]),
  subsystem(3, "PROBES", "Read-only database Probes", ["Read-only", "database Probes"]),
  subsystem(4, "MEMORY", "Hybrid memory and retrieval", ["Hybrid memory", "and retrieval"]),
  subsystem(5, "EVIDENCE", "Signed evidence and handoff", ["Signed evidence", "and handoff"], "cyan"),
  subsystem(6, "DIST", "Hermetic distribution and activation", ["Hermetic", "distribution and", "activation"]),
  {
    id: "POLICY",
    label: "Cedar policies · approvals · egress",
    lines: ["Cedar policies ·", "approvals · egress"],
    x: 860,
    y: 130,
    width: 320,
    height: 70,
    tone: "amber"
  },
  {
    id: "VERIFY",
    label: "Independent verification",
    lines: ["Independent", "verification"],
    x: EVIDENCE_COLUMN_X,
    y: 450,
    width: SUBSYSTEM_WIDTH,
    height: 60,
    tone: "cyan"
  },
  {
    id: "HUMAN",
    label: "Human review",
    lines: ["Human review"],
    x: EVIDENCE_COLUMN_X,
    y: 560,
    width: SUBSYSTEM_WIDTH,
    height: 60,
    tone: "amber"
  }
];

// In the order the Mermaid source declares them.
export const architectureEdges: readonly (readonly [string, string])[] = [
  ["CLI", "APP"],
  ["APP", "DOMAIN"],
  ["APP", "WORKSPACE"],
  ["APP", "DRIVERS"],
  ["APP", "PROBES"],
  ["APP", "MEMORY"],
  ["APP", "EVIDENCE"],
  ["APP", "DIST"],
  ["POLICY", "APP"],
  ["EVIDENCE", "VERIFY"],
  ["VERIFY", "HUMAN"]
];

export function architectureNode(id: string): ArchitectureNode {
  const node = architectureNodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`architecture diagram has no node ${id}`);
  return node;
}

// Orthogonal routing: a target below its source leaves the source's bottom
// centre and enters the target's top centre, with one elbow halfway when the
// two centres differ; a target beside its source joins the two facing edges.
export function architectureEdgePath(from: ArchitectureNode, to: ArchitectureNode): string {
  const fromCentreX = from.x + from.width / 2;
  const toCentreX = to.x + to.width / 2;
  if (to.y >= from.y + from.height) {
    const start = `M${fromCentreX},${from.y + from.height}`;
    if (fromCentreX === toCentreX) return `${start} V${to.y}`;
    const elbowY = (from.y + from.height + to.y) / 2;
    return `${start} V${elbowY} H${toCentreX} V${to.y}`;
  }
  const centreY = from.y + from.height / 2;
  return to.x > from.x ? `M${from.x + from.width},${centreY} H${to.x}` : `M${from.x},${centreY} H${to.x + to.width}`;
}
