import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseHandoff, validateHandoffTransition } from "../../scripts/agent-readiness.mjs";

test("portable handoff template is parser-valid and contains resume sections", async () => {
  const source = await readFile(new URL("../../.specs/templates/feature/handoff.md", import.meta.url), "utf8");
  const handoff = parseHandoff(source, ".specs/templates/feature/handoff.md");
  assert.equal(handoff.schema, "verchestra-feature-handoff/v1");
  assert.equal(handoff.status, "planned");
  for (const heading of [
    "# Scope",
    "# Completed Evidence",
    "# Next Exact Action",
    "# Blockers",
    "# Decisions",
    "# Files Intentionally Left Unchanged"
  ])
    assert.match(handoff.body, new RegExp(`^${heading}`, "mu"));
});

test("portable state machine supports block/resume and rejects replay", () => {
  for (const [from, to] of [
    ["planned", "in_progress"],
    ["in_progress", "blocked"],
    ["blocked", "in_progress"],
    ["in_progress", "verification"],
    ["verification", "complete"]
  ])
    assert.equal(validateHandoffTransition(from, to), true, `${from} -> ${to}`);
  for (const [from, to] of [
    ["planned", "verification"],
    ["verification", "in_progress"],
    ["complete", "verification"],
    ["complete", "blocked"]
  ])
    assert.equal(validateHandoffTransition(from, to), false, `${from} -> ${to}`);
});

test("neutral feature templates expose required planning and evidence surfaces", async () => {
  for (const [file, required] of [
    ["context.md", ["Canonical references", "Constraints and exclusions"]],
    ["spec.md", ["Requirements", "Acceptance criteria", "Safety and authority"]],
    ["design.md", ["Canonical sources and generated projections", "Security and trust boundaries"]],
    ["tasks.md", ["Test coverage matrix", "Requirement traceability", "Execution evidence"]],
    ["validation.md", ["Requirement evidence", "Discrimination sensor", "Human review"]]
  ]) {
    const source = await readFile(new URL(`../../.specs/templates/feature/${file}`, import.meta.url), "utf8");
    for (const heading of required) assert.match(source, new RegExp(`^## ${heading}`, "mu"), `${file}: ${heading}`);
  }
});

test("issue and pull request templates require portable review evidence", async () => {
  const sources = await Promise.all(
    [
      ".github/ISSUE_TEMPLATE/feature_request.yml",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/PULL_REQUEST_TEMPLATE.md"
    ].map((path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8"))
  );
  for (const [index, source] of sources.entries()) {
    for (const required of ["acceptance", "canonical", "verification", "safety", "handoff", "human review"])
      assert.match(source, new RegExp(required, "iu"), `${index}: ${required}`);
  }
});
