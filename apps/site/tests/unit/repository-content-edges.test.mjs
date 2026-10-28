import assert from "node:assert/strict";
import test from "node:test";

import { extractDescription, validateRoadmapChain } from "../../src/lib/repository-content.ts";

test("the description is the first prose paragraph after the H1, skipping preamble and non-prose lines", () => {
  const markdown = [
    "Preamble before the title is ignored.",
    "  # Title",
    "",
    "## A heading",
    "```",
    "| a | table |",
    "<aside>",
    "> Quoted *first* line",
    "with a [linked](https://example.com) `word`.",
    "",
    "Second paragraph."
  ].join("\n");
  assert.equal(extractDescription(markdown), "Quoted first line with a linked word.");
});

test("a document without an H1, or with nothing but non-prose after it, has no description", () => {
  assert.throws(() => extractDescription("Just prose.\n\nMore prose.\n"), /missing a description paragraph/u);
  assert.throws(() => extractDescription("# Title\n\n## Only headings\n| x |\n"), /missing a description paragraph/u);
});

const chain = (...edges) => edges.map((edge) => `  ${edge}`).join("\n");

test("a well-formed roadmap chain is returned in order", () => {
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T2", "T2 --> T2a[inserted]", "T2a --> T3")), {
    chain: ["T1", "T2", "T2a", "T3"],
    errors: []
  });
});

test("every structural defect of the roadmap chain is named and the chain is withheld", () => {
  assert.deepEqual(validateRoadmapChain(""), { chain: [], errors: ["no roadmap chain is declared"] });
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T1")), {
    chain: [],
    errors: [
      "T1 declares an edge to itself",
      "the chain needs exactly one start, found none",
      "the chain needs exactly one end, found none"
    ]
  });
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T3", "T2 --> T3")), {
    chain: [],
    errors: ["T3 has 2 predecessors", "the chain needs exactly one start, found 2"]
  });
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T2", "T3 --> T4", "T4 --> T3")), {
    chain: [],
    errors: ["unreachable from the start: T3, T4"]
  });
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T2", "T2 --> T3", "T3 --> T2")), {
    chain: [],
    errors: ["T2 has 2 predecessors", "the chain needs exactly one end, found none", "the chain revisits T2"]
  });
  assert.deepEqual(validateRoadmapChain(chain("T1 --> T2", "T1 --> T3")), {
    chain: [],
    errors: [
      "T1 declares more than one successor: T2 and T3",
      "the chain needs exactly one end, found 2",
      "unreachable from the start: T3"
    ]
  });
});
