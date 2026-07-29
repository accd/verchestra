import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  compileAgentContext,
  parseRoadmapChain,
  validateRoadmapChain,
  qualificationStatusLine,
  resolveQualification,
  validateQualificationReport,
  normalizeRepositoryPath,
  parseHandoff,
  validateHandoffTransition
} from "../../scripts/agent-readiness.mjs";

const GATES = new Set(["gate:quick", "gate:security"]);
const SHA = "a".repeat(40);

const report = (overrides = {}) => {
  const fields = {
    schema: "verchestra-qualification-report/v1",
    task: "T68a",
    revision: SHA,
    gates: "pnpm gate:quick, pnpm gate:security",
    gateResults: "pass, pass",
    gateRevision: SHA,
    criteriaEvidence: "7 of 7",
    skipped: "0",
    todo: "0",
    discriminationSensor: "5 killed, 0 survived",
    verifier: "independent-verifier",
    verifierRole: "independent",
    humanReview: "approved",
    ...overrides
  };
  const body = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${body}\n---\n\n# T68a Validation\n`;
};

test("JSON context exposes the exact safe clean-clone contract", () => {
  const output = execFileSync(process.execPath, ["scripts/agent-context.mjs", "--json"], { encoding: "utf8" });
  const snapshot = JSON.parse(output);
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.repository, "accd/verchestra");
  assert.equal(snapshot.version, "0.0.0-qualification");
  assert.deepEqual(snapshot.qualification, { highestVerifiedTask: "T68", nextTask: "T68a" });
  assert.equal(snapshot.requiredReads[0], "AGENTS.md");
  assert.equal(snapshot.activeFeatures[0].handoffPath, ".specs/features/agent-ready-repository/handoff.md");
  assert.doesNotMatch(output, /[A-Za-z]:\\|\/(?:Users|home)\//u);
});

test("context degrades deterministically when Git is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-context-"));
  await mkdir(join(root, "docs", "qualification"), { recursive: true });
  await mkdir(join(root, ".specs", "features"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"version":"0.0.0-qualification"}\n');
  await writeFile(join(root, "docs", "qualification", "t68-validation.md"), "# T68\n");
  const snapshot = await compileAgentContext(root);
  assert.equal(snapshot.revision, "unknown");
  assert.equal(snapshot.branch, null);
  assert.equal(snapshot.dirty, false);
  assert.deepEqual(snapshot.qualification, { highestVerifiedTask: "T68", nextTask: "T69" });
});

const CHAIN = [
  "flowchart LR",
  '  T68["T68 Activation and rollback"] --> T68a["T68a Key lifecycle"]',
  '  T68a --> T68b["T68b Budget enforcement"]',
  '  T68b --> T68c["T68c Declarative gate repair"]',
  '  T68c --> T69["T69 Self-Test trust domain"]'
].join("\n");

const verified = (...tasks) => new Set(tasks);

const graph = (...edges) => edges.map((line) => `  ${line}`).join("\n");

test("roadmap edges parse with or without a labelled source", () => {
  assert.deepEqual(parseRoadmapChain(CHAIN), [
    ["T68", "T68a"],
    ["T68a", "T68b"],
    ["T68b", "T68c"],
    ["T68c", "T69"]
  ]);
  assert.deepEqual(parseRoadmapChain(""), []);
});

test("a valid chain yields its declared order", () => {
  assert.deepEqual(validateRoadmapChain(CHAIN), {
    chain: ["T68", "T68a", "T68b", "T68c", "T69"],
    errors: []
  });
});

for (const [label, roadmap, expected] of [
  ["a branch", graph('T1 --> T2["b"]', 'T1 --> T3["c"]', 'T2 --> T3["c"]'), "T1 declares more than one successor"],
  ["a merge", graph('T1 --> T3["c"]', 'T2 --> T3["c"]'), "T3 has 2 predecessors"],
  ["a self cycle", graph('T1 --> T1["a"]', 'T1 --> T2["b"]'), "T1 declares an edge to itself"],
  [
    "a disconnected cycle",
    graph('T1 --> T2["b"]', 'T3 --> T4["d"]', 'T4 --> T3["c"]'),
    "unreachable from the start: T3, T4"
  ],
  ["a disconnected chain", graph('T1 --> T2["b"]', 'T3 --> T4["d"]'), "the chain needs exactly one start, found 2"],
  ["a missing root", graph('T1 --> T2["b"]', 'T2 --> T1["a"]'), "the chain needs exactly one start, found none"],
  ["multiple terminals", graph('T1 --> T2["b"]', 'T3 --> T4["d"]'), "the chain needs exactly one end, found 2"],
  ["no chain at all", "", "no roadmap chain is declared"]
]) {
  test(`the chain fails closed on ${label}`, () => {
    const result = validateRoadmapChain(roadmap);
    assert.deepEqual(result.chain, []);
    assert.ok(
      result.errors.some((problem) => problem.includes(expected)),
      `expected an error naming "${expected}", got ${JSON.stringify(result.errors)}`
    );
  });
}

test("a validation report with no roadmap node fails closed", () => {
  const result = resolveQualification(CHAIN, verified("T68", "T68z"));
  assert.deepEqual(result, {
    highestVerifiedTask: null,
    nextTask: null,
    errors: ["T68z has a validation report but no roadmap node"]
  });
  // Numeric reports predate the declared chain, so they are historical evidence
  // rather than strays.
  assert.deepEqual(resolveQualification(CHAIN, verified("T01", "T68")).errors, []);
});

test("reports after the first gap are reported as out-of-order evidence", () => {
  const result = resolveQualification(CHAIN, verified("T68", "T68b", "T68c"));
  assert.equal(result.highestVerifiedTask, "T68");
  assert.equal(result.nextTask, "T68a");
  assert.deepEqual(result.errors, ["validation reports exist after the first gap: T68b, T68c"]);
});

test("the chain walk advances past letter-suffixed tasks", () => {
  assert.deepEqual(resolveQualification(CHAIN, verified("T68")), {
    highestVerifiedTask: "T68",
    nextTask: "T68a",
    errors: []
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a")), {
    highestVerifiedTask: "T68a",
    nextTask: "T68b",
    errors: []
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68b", "T68c")), {
    highestVerifiedTask: "T68c",
    nextTask: "T69",
    errors: []
  });
});

test("the chain walk stops at the first gap and reports a fully verified chain", () => {
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68c")), {
    highestVerifiedTask: "T68a",
    nextTask: "T68b",
    errors: ["validation reports exist after the first gap: T68c"]
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68b", "T68c", "T69")), {
    highestVerifiedTask: "T69",
    nextTask: null,
    errors: []
  });
  assert.deepEqual(resolveQualification(CHAIN, verified()), {
    highestVerifiedTask: null,
    nextTask: "T68",
    errors: []
  });
  assert.deepEqual(resolveQualification("", verified("T68")), {
    highestVerifiedTask: null,
    nextTask: null,
    errors: ["no roadmap chain is declared"]
  });
});

test("a complete report is accepted and historical reports need no frontmatter", () => {
  assert.deepEqual(validateQualificationReport(report(), "T68a", GATES), []);
  assert.deepEqual(validateQualificationReport("# T68 Validation\n", "T68", GATES), []);
  assert.deepEqual(validateQualificationReport("# T01 Validation\n", "T01", GATES), []);
});

for (const [label, source, expected] of [
  ["an empty file", "", "missing the qualification frontmatter"],
  ["a heading-only placeholder", "# T68a Validation\n", "missing the qualification frontmatter"],
  ["a malformed frontmatter line", "---\nnot a field\n---\n", "malformed frontmatter line"],
  ["a wrong schema", report({ schema: "something/v9" }), "unsupported report schema"],
  ["a mismatched task id", report({ task: "T69" }), "report claims task T69"],
  ["a short revision", report({ revision: "abc", gateRevision: "abc" }), "revision is not a full commit id"],
  ["gate evidence from another revision", report({ gateRevision: "b".repeat(40) }), "not bound to the report revision"],
  [
    "an unknown gate name",
    report({ gates: "pnpm gate:imaginary", gateResults: "pass" }),
    "unknown gate gate:imaginary"
  ],
  ["a failing gate", report({ gateResults: "pass, fail" }), "gate gate:security did not pass"],
  ["a gate with no result", report({ gateResults: "pass" }), "every gate needs a recorded result"],
  ["unproven acceptance criteria", report({ criteriaEvidence: "5 of 7" }), "criteriaEvidence is incomplete: 5 of 7"],
  ["a surviving mutant", report({ discriminationSensor: "4 killed, 1 survived" }), "1 that did not fail closed"],
  ["no mutation at all", report({ discriminationSensor: "0 killed, 0 survived" }), "at least one case"],
  ["a skipped case", report({ skipped: "2" }), "skipped must be 0, found 2"],
  ["a todo case", report({ todo: "1" }), "todo must be 0, found 1"],
  ["an author verifying their own work", report({ verifierRole: "author" }), "not recorded as independent"],
  ["absent human review", report({ humanReview: "pending" }), "human review is not recorded as approved"],
  ["a missing verifier", report({ verifier: "" }), "missing verifier"]
]) {
  test(`a report is refused for ${label}`, () => {
    const errors = validateQualificationReport(source, "T68a", GATES);
    assert.ok(
      errors.some((problem) => problem.includes(expected)),
      `expected an error naming "${expected}", got ${JSON.stringify(errors)}`
    );
  });
}

test("the status line names the next task or declares the chain fully verified", () => {
  assert.equal(qualificationStatusLine({ highestVerifiedTask: "T68", nextTask: "T68a" }), "T68 complete; T68a next");
  assert.equal(
    qualificationStatusLine({ highestVerifiedTask: "T77", nextTask: null }),
    "T77 complete; the declared chain is fully verified"
  );
});

test("handoff parser validates the portable contract and blocked requirements", () => {
  const source = `---
schema: verchestra-feature-handoff/v1
feature: example-feature
issue: 123
status: blocked
branch: feature/example
baseRevision: 0123456789012345678901234567890123456789
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm gate:quick
updatedAt: 2026-07-25T00:00:00Z
---

# Blockers

Unblock by restoring the fixture.
`;
  const handoff = parseHandoff(source);
  assert.equal(handoff.issue, 123);
  assert.equal(handoff.nextTask, "T3");
  assert.throws(() => parseHandoff(source.replace("# Blockers", "# Notes")), /needs a Blockers section/u);
});

test("handoff transitions reject regressions and duplicate completion replay", () => {
  assert.equal(validateHandoffTransition("planned", "in_progress"), true);
  assert.equal(validateHandoffTransition("in_progress", "verification"), true);
  assert.equal(validateHandoffTransition("verification", "complete"), true);
  assert.equal(validateHandoffTransition("complete", "in_progress"), false);
  assert.equal(validateHandoffTransition("in_progress", "planned"), false);
});

test("repository paths normalize Windows and POSIX separators", () => {
  assert.equal(
    normalizeRepositoryPath(String.raw`.specs\features\example\handoff.md`),
    ".specs/features/example/handoff.md"
  );
  assert.equal(normalizeRepositoryPath("./docs/architecture.md"), "docs/architecture.md");
});
