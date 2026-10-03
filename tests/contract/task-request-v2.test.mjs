import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
const schemaText = (version) =>
  readFile(new URL(`../../schemas/task-request/${version}.schema.json`, import.meta.url), "utf8");
const [v1, v2] = [JSON.parse(await schemaText(1)), JSON.parse(await schemaText(2))];

function schemaAccepts(request) {
  try {
    registry.validate("task-request", "2", request);
    return true;
  } catch (error) {
    assert.equal(error.code, "VES_SCHEMA_VALIDATION_FAILED");
    return false;
  }
}

test("task-request@2 is registered beside version 1 and accepts one example per mode", () => {
  assert.ok(registry.list().includes("task-request@1"));
  assert.ok(registry.list().includes("task-request@2"));
  for (const mode of ["agent", "graph", "swarm"]) assert.equal(schemaAccepts(validTaskRequestV2(mode)), true, mode);
});

test("version 2 keeps every version 1 member except the single driver, and adds the execution descriptor", () => {
  assert.equal(v2.$id, "ves://task-request/2");
  assert.equal(v2.title, "TaskRequestV2");
  assert.equal(v2.additionalProperties, false);
  for (const member of ["sourceRevision", "task", "gates", "budgets", "onGateFailure", "verifier", "instructions"])
    assert.deepEqual(v2.properties[member], v1.properties[member], member);
  assert.equal(Object.hasOwn(v2.properties, "driver"), false);
  assert.deepEqual(v2.required, [...v1.required.filter((member) => member !== "driver"), "execution"]);
  assert.deepEqual(
    Object.keys(v2.properties).sort((left, right) => Number(left > right) - Number(left < right)),
    [
      "budgets",
      "execution",
      "gates",
      "instructions",
      "onGateFailure",
      "schemaVersion",
      "sourceRevision",
      "task",
      "verifier"
    ]
  );
});

// why: the descriptor is a vendor-neutral contract (SSI-11). Naming an SDK, a
// schema library, or a provider SDK would tie the approved shape to one.
test("the version 2 contract names no SDK, schema library, or provider SDK", async () => {
  const text = (await schemaText(2)).toLowerCase();
  for (const name of ["strands", "zod", "ajv", "@anthropic-ai", "openai", "bedrock", "@modelcontextprotocol"])
    assert.equal(text.includes(name), false, name);
});

test("the generated contracts carry a TaskRequestV2 type named by the schema title", async () => {
  const generated = await readFile(new URL("../../packages/contracts/src/generated.ts", import.meta.url), "utf8");
  assert.match(generated, /^export interface TaskRequest \{$/mu);
  assert.match(generated, /^export interface TaskRequestV2 \{\n {2}schemaVersion: 2;$/mu);
  assert.ok(
    generated.indexOf("export interface TaskRequestV2 {") > generated.indexOf("export interface TaskRequest {")
  );
});
