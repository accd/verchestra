import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ARCHITECTURE_VIEWBOX,
  architectureEdgePath,
  architectureEdges,
  architectureNode,
  architectureNodes
} from "../../src/lib/architecture-diagram.ts";

// The landing page draws the architecture by hand as inline SVG. These tests
// pin that drawing to the Mermaid block at the top of docs/architecture.md:
// every node label and every edge in the drawing is read from the Mermaid
// source here, so the drawing cannot say something the document does not.
const repositoryRoot = new URL("../../../../", import.meta.url);

async function mermaidSource() {
  const architecture = await readFile(new URL("docs/architecture.md", repositoryRoot), "utf8");
  const block = /```mermaid\r?\n([\s\S]*?)```/u.exec(architecture)?.[1];
  assert.ok(block, "docs/architecture.md must open with a Mermaid block");
  const labels = new Map();
  for (const match of block.matchAll(/(\w+)\["([^"]+)"\]/gu)) labels.set(match[1], match[2]);
  const edges = [];
  for (const line of block.split("\n")) {
    const edge = /^\s*(\w+)(?:\[[^\]]*\])?\s*-->\s*(\w+)(?:\[[^\]]*\])?\s*$/u.exec(line);
    if (edge) edges.push([edge[1], edge[2]]);
  }
  return { labels, edges };
}

test("every drawn node carries a Mermaid label verbatim, and every Mermaid node is drawn", async () => {
  const { labels } = await mermaidSource();
  const drawn = new Map(architectureNodes.map((node) => [node.id, node.label]));
  assert.deepEqual([...drawn].sort(), [...labels].sort());
  for (const node of architectureNodes) {
    assert.equal(node.lines.join(" "), node.label, `${node.id} line split must join back into its label`);
    assert.ok(
      node.lines.every((line) => line.trim() === line && line.length > 0),
      `${node.id} has a blank line`
    );
  }
});

test("the drawn edges are the Mermaid edges, in the Mermaid order", async () => {
  const { edges } = await mermaidSource();
  assert.ok(edges.length >= 10, "the Mermaid block declares the full edge list");
  assert.deepEqual(
    architectureEdges.map(([from, to]) => `${from}-->${to}`),
    edges.map(([from, to]) => `${from}-->${to}`)
  );
});

test("the drawing stays inside its viewBox with no overlapping nodes", () => {
  for (const node of architectureNodes) {
    assert.ok(node.x >= 0 && node.y >= 0, `${node.id} starts inside the viewBox`);
    assert.ok(node.x + node.width <= ARCHITECTURE_VIEWBOX.width, `${node.id} overflows the viewBox width`);
    assert.ok(node.y + node.height <= ARCHITECTURE_VIEWBOX.height, `${node.id} overflows the viewBox height`);
  }
  for (const [index, left] of architectureNodes.entries()) {
    for (const right of architectureNodes.slice(index + 1)) {
      const apart =
        left.x + left.width <= right.x ||
        right.x + right.width <= left.x ||
        left.y + left.height <= right.y ||
        right.y + right.height <= left.y;
      assert.ok(apart, `${left.id} overlaps ${right.id}`);
    }
  }
});

test("edges are routed orthogonally between the nodes they join", () => {
  const app = architectureNode("APP");
  assert.equal(architectureEdgePath(architectureNode("CLI"), app), "M600,76 V130");
  assert.equal(architectureEdgePath(architectureNode("POLICY"), app), "M860,165 H800");
  const toDomain = architectureEdgePath(app, architectureNode("DOMAIN"));
  assert.match(toDomain, /^M600,200 V250 H90 V300$/u);
  assert.throws(() => architectureNode("NOPE"), /no node NOPE/u);
});

test("the component renders the module's nodes rather than its own copy of the labels", async () => {
  const { labels } = await mermaidSource();
  const component = await readFile(new URL("../../src/components/ArchitectureDiagram.astro", import.meta.url), "utf8");
  assert.match(component, /from "\.\.\/lib\/architecture-diagram\.ts"/u);
  assert.match(component, /architectureNodes\.map\(/u);
  assert.match(component, /architectureEdges/u);
  for (const label of labels.values()) {
    assert.ok(!component.includes(`"${label}"`), `the component hand-copies the label "${label}"`);
  }
  assert.match(component, /role="img"/u);
  assert.match(component, /<title id="architecture-diagram-title">/u);
  assert.match(component, /<desc id="architecture-diagram-desc">/u);
});
