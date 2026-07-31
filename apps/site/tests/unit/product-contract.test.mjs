import assert from "node:assert/strict";
import test from "node:test";

import {
  databases,
  deliveryStages,
  drivers,
  productDefinition,
  productHeadline,
  productScenario,
  productStatus
} from "../../src/data/product.ts";

test("publishes the approved first-viewport product contract", () => {
  assert.equal(productHeadline, "AI delivery that survives the model, the machine, and the handoff.");
  assert.equal(
    productDefinition,
    "Verchestra is a verified AI software-delivery harness. It turns discovery, planning, implementation, validation, and human approval into portable, signed, and reviewable delivery work."
  );
  assert.equal(
    productScenario,
    "A developer can begin with one AI environment and hand the next developer an executable contract, verified evidence, and the exact next action — without transferring credentials or relying on chat history."
  );
  assert.deepEqual(productStatus, {
    version: "0.0.0-qualification",
    completedTask: "T68d",
    nextTask: "T69",
    installable: false
  });
});

test("publishes the complete delivery sequence", () => {
  assert.deepEqual(
    deliveryStages.map(({ name }) => name),
    ["Request", "Discovery", "Execution Package", "Qualified driver", "Evidence", "Human review"]
  );
});

test("publishes every qualified driver and database with SAP ASE first-class", () => {
  assert.deepEqual(drivers, ["Claude Code", "Codex", "OpenCode / Qwen"]);
  assert.deepEqual(databases, [
    "SAP ASE / Sybase",
    "PostgreSQL",
    "MySQL / MariaDB",
    "SQL Server",
    "Oracle",
    "SQLite",
    "MongoDB"
  ]);
});
