import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { canonicalTaskRequest, normalizeTaskRequest, TaskRequestError } from "../../packages/application/src/index.ts";
import { validTaskRequest } from "../helpers/task-request-fixture.mjs";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

function mutated(mutate) {
  const request = structuredClone(validTaskRequest());
  mutate(request);
  return request;
}

function schemaAccepts(request) {
  try {
    registry.validate("task-request", "1", request);
    return true;
  } catch (error) {
    assert.equal(error.code, "VES_SCHEMA_VALIDATION_FAILED");
    return false;
  }
}

test("task-request@1 is registered and accepts the canonical example", () => {
  assert.ok(registry.list().includes("task-request@1"));
  assert.equal(schemaAccepts(validTaskRequest()), true);
});

test("the normalizer accepts the canonical example and returns a deep-frozen copy", () => {
  const input = validTaskRequest();
  const normalized = normalizeTaskRequest(input);
  assert.equal(normalized.task.taskId, "T405.1");
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.gates[0].args), true);
  assert.equal(Object.isFrozen(normalized.budgets), true);
  input.gates[0].args.push("mutated-after-normalize");
  assert.deepEqual(normalized.gates[0].args, ["packages/app/test"]);
});

test("the repair policy is optional and absent when not declared", () => {
  const request = mutated((value) => delete value.onGateFailure);
  assert.equal(schemaAccepts(request), true);
  assert.equal(Object.hasOwn(normalizeTaskRequest(request), "onGateFailure"), false);
});

test("the canonical encoding is independent of key order and gate requirement order", () => {
  const reordered = mutated((value) => {
    value.gates[0].requirementIds = ["VES-EXE-001"];
    value.task = Object.fromEntries(Object.entries(value.task).reverse());
  });
  assert.equal(canonicalTaskRequest(reordered), canonicalTaskRequest(validTaskRequest()));
});

// Every rejection here is a shape rule: the schema and the normalizer must both
// refuse it, and the normalizer must report the stable code.
const shapeRejections = [
  ["an unknown top-level field", (r) => (r.executable = "/usr/bin/node"), "VES_TASK_REQUEST_INVALID"],
  ["another schema version", (r) => (r.schemaVersion = 2), "VES_TASK_REQUEST_INVALID"],
  ["an abbreviated source revision", (r) => (r.sourceRevision = "abc1234"), "VES_TASK_REQUEST_INVALID"],
  ["missing instructions", (r) => delete r.instructions, "VES_TASK_REQUEST_INVALID"],
  ["an invalid requirement ID", (r) => (r.task.requirementIds = ["REQ-1"]), "VES_TASK_REQUEST_TASK_INVALID"],
  ["a parent-traversing change scope", (r) => (r.task.changeScope = ["../outside"]), "VES_TASK_REQUEST_TASK_INVALID"],
  ["an absolute change scope", (r) => (r.task.changeScope = ["/etc"]), "VES_TASK_REQUEST_TASK_INVALID"],
  ["an unknown task field", (r) => (r.task.shell = "bash"), "VES_TASK_REQUEST_TASK_INVALID"],
  ["an executable path on a gate", (r) => (r.gates[0].executable = "/bin/sh"), "VES_TASK_REQUEST_GATES_INVALID"],
  ["an absolute gate argument", (r) => (r.gates[0].args = ["/usr/bin/env"]), "VES_TASK_REQUEST_GATES_INVALID"],
  ["a parent-traversing gate argument", (r) => (r.gates[0].args = ["../escape"]), "VES_TASK_REQUEST_GATES_INVALID"],
  [
    "an embedded absolute gate argument",
    (r) => (r.gates[0].args = ["--config=/etc/passwd"]),
    "VES_TASK_REQUEST_GATES_INVALID"
  ],
  ["a drive-letter gate argument", (r) => (r.gates[0].args = ["C:\\tools"]), "VES_TASK_REQUEST_GATES_INVALID"],
  ["a zero gate timeout", (r) => (r.gates[0].timeoutMs = 0), "VES_TASK_REQUEST_GATES_INVALID"],
  ["an unknown gate protocol", (r) => (r.gates[0].resultProtocol = "shell"), "VES_TASK_REQUEST_GATES_INVALID"],
  ["an empty gate list", (r) => (r.gates = []), "VES_TASK_REQUEST_GATES_INVALID"],
  ["a zero cost ceiling", (r) => (r.budgets.maximumCostUsd = 0), "VES_TASK_REQUEST_BUDGET_INVALID"],
  ["a cost ceiling above the bound", (r) => (r.budgets.maximumCostUsd = 1001), "VES_TASK_REQUEST_BUDGET_INVALID"],
  ["a fractional token ceiling", (r) => (r.budgets.maximumTokens = 1.5), "VES_TASK_REQUEST_BUDGET_INVALID"],
  ["a duration above one day", (r) => (r.budgets.maximumDurationMs = 86_400_001), "VES_TASK_REQUEST_BUDGET_INVALID"],
  ["a Codex implementer", (r) => (r.driver.driverId = "codex"), "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"],
  ["a Claude verifier", (r) => (r.verifier.driverId = "claude-code"), "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"],
  [
    "a verifier model on the implementer",
    (r) => (r.driver.model = "gpt-5.2-codex"),
    "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  ],
  ["empty instructions", (r) => (r.instructions = ""), "VES_TASK_REQUEST_INVALID"],
  ["a NUL in instructions", (r) => (r.instructions = "fix\u0000it"), "VES_TASK_REQUEST_INVALID"],
  ["a bidirectional override in instructions", (r) => (r.instructions = "fix \u202Eti"), "VES_TASK_REQUEST_INVALID"],
  ["instructions above 8192 characters", (r) => (r.instructions = "x".repeat(8193)), "VES_TASK_REQUEST_INVALID"],
  ["too many repair attempts", (r) => (r.onGateFailure.maxAttempts = 6), "VES_TASK_REQUEST_REPAIR_POLICY_INVALID"],
  ["an unknown repair field", (r) => (r.onGateFailure.retryForever = true), "VES_TASK_REQUEST_REPAIR_POLICY_INVALID"]
];

for (const [name, mutate, code] of shapeRejections) {
  test(`schema and normalizer both reject ${name}`, () => {
    const request = mutated(mutate);
    assert.equal(schemaAccepts(request), false);
    assert.throws(
      () => normalizeTaskRequest(request),
      (error) => {
        assert.ok(error instanceof TaskRequestError);
        assert.equal(error.code, code);
        return true;
      }
    );
  });
}

const schemaGateArgument = new RegExp(
  JSON.parse(await readFile(new URL("../../schemas/task-request/1.schema.json", import.meta.url), "utf8")).properties
    .gates.items.properties.args.items.pattern,
  "u"
);

function normalizerRefusesArgument(argument) {
  try {
    normalizeTaskRequest(mutated((r) => (r.gates[0].args = [argument])));
    return false;
  } catch (error) {
    return error.message === "gate arguments must be bounded, relative, and inside the worktree";
  }
}

// The normalizer checks gate arguments without the schema's lookahead pattern
// (SonarCloud S5843); both must accept exactly the same strings.
test("the normalizer and the schema accept exactly the same gate arguments", () => {
  let level = [""];
  const candidates = ["", "x".repeat(512), "x".repeat(513), "tab\there", "caf\u00e9"];
  for (let length = 1; length <= 5; length += 1) {
    level = level.flatMap((prefix) => ["a", "C", ":", "/", "\\", "=", ".", " ", "-"].map((next) => prefix + next));
    candidates.push(...level);
  }
  for (const argument of candidates)
    assert.equal(normalizerRefusesArgument(argument), !schemaGateArgument.test(argument), JSON.stringify(argument));
  assert.equal(candidates.length, 66_434);
});

// Cross-field rules a JSON Schema cannot express. The schema admits the shape;
// only the normalizer, which the CLI always runs, refuses it.
const crossFieldRejections = [
  [
    "gates that miss a verification command",
    (r) => (r.task.verificationCommands = [...r.task.verificationCommands, "node scripts/extra.mjs"]),
    "VES_TASK_REQUEST_GATES_INVALID"
  ],
  [
    "a gate citing a requirement outside the task",
    (r) => (r.gates[1].requirementIds = ["VES-SPC-003"]),
    "VES_TASK_REQUEST_GATES_INVALID"
  ],
  [
    "a task requirement no gate covers",
    (r) => (r.task.requirementIds = [...r.task.requirementIds, "VES-EXE-006"]),
    "VES_TASK_REQUEST_GATES_INVALID"
  ],
  ["duplicate gate IDs", (r) => (r.gates[1].gateId = r.gates[0].gateId), "VES_TASK_REQUEST_GATES_INVALID"],
  ["a test gate without a test baseline", (r) => (r.gates[0].minimumTests = 0), "VES_TASK_REQUEST_GATES_INVALID"],
  [
    "escalation after the last attempt",
    (r) => (r.onGateFailure = { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 3 }),
    "VES_TASK_REQUEST_REPAIR_POLICY_INVALID"
  ],
  ["an unpriced implementer model", (r) => (r.driver.model = "claude-unpriced-9"), "VES_TASK_REQUEST_MODEL_UNPRICED"],
  ["an unpriced verifier model", (r) => (r.verifier.model = "gpt-unpriced"), "VES_TASK_REQUEST_MODEL_UNPRICED"],
  ["instructions above 16384 UTF-8 bytes", (r) => (r.instructions = "\u20ac".repeat(8192)), "VES_TASK_REQUEST_INVALID"]
];

// invariant: AD-084. A model offered on a subscription is admitted without a
// price; only a name that is neither priced nor offered is refused as unpriced.
for (const [name, mutate, field, model] of [
  ["a subscription-only implementer model", (r) => (r.driver.model = "claude-opus-5-5"), "driver", "claude-opus-5-5"],
  ["a subscription-only verifier model", (r) => (r.verifier.model = "gpt-5.5"), "verifier", "gpt-5.5"],
  ["the newest Codex verifier model", (r) => (r.verifier.model = "gpt-6.1-sol"), "verifier", "gpt-6.1-sol"]
]) {
  test(`the normalizer admits ${name} that has no price`, () => {
    const request = mutated(mutate);
    assert.equal(schemaAccepts(request), true);
    assert.equal(normalizeTaskRequest(request)[field].model, model);
  });
}

for (const [name, mutate, code] of crossFieldRejections) {
  test(`the normalizer rejects ${name} that the schema shape admits`, () => {
    const request = mutated(mutate);
    assert.equal(schemaAccepts(request), true);
    assert.throws(() => normalizeTaskRequest(request), { code });
  });
}
