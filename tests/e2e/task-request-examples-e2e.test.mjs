// invariant: SSI-36. The repository ships one Task Request v2 per mode under
// docs/examples, and each plans through the real `vestra` binary in a dry run
// against a repository with the files it names: the topology it declares, its
// providers on subscriptions with the owner's extra-usage confirmation, and
// only limits at or below their defaults. Its text form agrees with its JSON
// form. A dry run reads no credential and starts no provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { COORDINATION_LIMIT_DEFAULTS } from "../../packages/application/src/index.ts";
import { assertTextAgrees } from "../helpers/cli-text-fixture.mjs";
import { confirmExtraUsage } from "../helpers/task-billing-fixture.mjs";
import { cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 300_000 };
const PLACEHOLDER_REVISION = "0123456789abcdef0123456789abcdef01234567";
const CLAUDE = "claude-code:claude-sonnet-5";
const CODEX = "codex:gpt-5.2-codex";
const PER_INVOCATION = Object.freeze(["runId", "bindingDigest", "approvalExpiresAt", "review"]);

// invariant: the topology each example declares, node by node in plan order.
const TOPOLOGIES = Object.freeze({
  agent: [["build", CLAUDE, "writer", []]],
  graph: [
    ["plan", CODEX, "reader", ["build"]],
    ["build", CLAUDE, "writer", ["review"]],
    ["review", CODEX, "reader", []]
  ],
  swarm: [
    ["writer", CLAUDE, "writer", ["reviewer"]],
    ["reviewer", CODEX, "reader", ["writer"]]
  ]
});

function example(mode) {
  return JSON.parse(readFileSync(new URL(`../../docs/examples/task-request-${mode}.json`, import.meta.url), "utf8"));
}

// why: the examples change `parseDuration` in a small Node project; the
// fixture repository gains those files so the plan compiles their context.
async function projectRevision(fixture) {
  await mkdir(join(fixture.repository, "test"), { recursive: true });
  await writeFile(
    join(fixture.repository, "src", "duration.js"),
    "export function parseDuration(text) {\n  return Number.parseInt(text, 10);\n}\n"
  );
  await writeFile(
    join(fixture.repository, "test", "duration.test.js"),
    'import { test } from "node:test";\n\ntest("parses minutes", () => {});\n'
  );
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "--quiet", "-m", "duration"]);
  return fixture.git(["rev-parse", "HEAD"]);
}

for (const mode of Object.keys(TOPOLOGIES))
  test(`the ${mode} example plans in a dry run on subscriptions within its default limits`, TIMEOUT, async () => {
    const request = example(mode);
    assert.equal(request.schemaVersion, 2);
    assert.equal(request.sourceRevision, PLACEHOLDER_REVISION, "the example names the documented placeholder");
    const fixture = await taskFixture();
    const revision = await projectRevision(fixture);
    await writeFile(fixture.requestPath, JSON.stringify({ ...request, sourceRevision: revision }));
    await confirmExtraUsage(fixture.stateRoot);
    const argv = ["task", "plan", "--request", fixture.requestPath, "--dry-run"];
    const json = fixture.launch([...argv, "--output", "json"]);
    assert.equal(json.status, 0, `${json.stderr}\n${json.stdout}`);
    const plan = json.json.data;
    assert.equal(plan.state, "NOT_PERSISTED");
    assert.equal(plan.coordination.mode, mode);
    assert.deepEqual(
      plan.coordination.nodes.map((node) => [node.nodeId, node.passport, node.role, node.to]),
      TOPOLOGIES[mode]
    );
    assert.deepEqual(plan.providerAuth, { "claude-code": "subscription", codex: "subscription" });
    assert.equal(plan.subscription.preflight, "ready");
    for (const [name, value] of Object.entries(request.execution.limits))
      assert.equal(plan.execution.limits[name], value, `the declared ${name} is not the one planned`);
    for (const [name, value] of Object.entries(plan.execution.limits))
      assert.ok(value <= COORDINATION_LIMIT_DEFAULTS[name], `${name} ${value} raises its default`);
    const text = fixture.launch(argv);
    assert.equal(text.status, 0, text.stderr);
    assertTextAgrees(text.stdout, plan, PER_INVOCATION);
  });
