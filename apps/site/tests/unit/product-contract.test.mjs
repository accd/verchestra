import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import {
  capabilityMatrix,
  databases,
  maturityDefinitions,
  notToday,
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
    completedTask: "T75",
    nextTask: "T76",
    installable: false
  });
});

test("publishes the complete delivery sequence", () => {
  assert.deepEqual(
    deliveryStages.map(({ name }) => name),
    ["Request", "Discovery", "Execution Package", "Qualified driver", "Evidence", "Human review"]
  );
});

// Order changed by AD-017 (owner, 2026-08-09): SQLite leads as the only
// live-qualified engine; the rest follow alphabetically with contract parity.
test("publishes every driver and database, SQLite leading as the live-qualified engine", () => {
  assert.deepEqual(drivers, ["Claude Code", "Codex", "OpenCode / Qwen"]);
  assert.deepEqual(databases, [
    "SQLite",
    "MongoDB",
    "MySQL / MariaDB",
    "Oracle",
    "PostgreSQL",
    "SAP ASE / Sybase",
    "SQL Server"
  ]);
});

// The capability matrix is the one typed source for "what works today". The
// README mirrors it as a Markdown table, and this is the drift test: a
// capability whose name or maturity lags in either surface fails here, so
// status can never be hand-duplicated apart.
test("the README capability table mirrors the typed matrix exactly", async () => {
  const readme = await readFile(new URL("../../../../README.md", import.meta.url), "utf8");
  // Parse the Markdown rows structurally instead of matching formatted text:
  // Prettier pads table cells, and a whitespace-sensitive regex either never
  // matches or - worse - passes vacuously and detects nothing.
  const rows = new Map(
    [...readme.matchAll(/^\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|$/gmu)].map((cells) => [
      cells[1].trim(),
      { maturity: cells[2].trim(), reference: cells[3].trim() }
    ])
  );
  for (const entry of capabilityMatrix) {
    const row = rows.get(entry.capability);
    assert.ok(row, `${entry.capability} must appear in the README table`);
    assert.equal(row.maturity, entry.maturity, `${entry.capability} maturity drifted`);
    assert.equal(row.reference, entry.reference, `${entry.capability} reference drifted`);
  }
});

test("every capability declares a real maturity and an evidence destination", () => {
  const states = Object.keys(maturityDefinitions);
  assert.ok(capabilityMatrix.length >= 8, "the matrix must stay substantive");
  for (const entry of capabilityMatrix) {
    assert.ok(states.includes(entry.maturity), `${entry.capability}: unknown maturity ${entry.maturity}`);
    assert.ok(entry.evidenceRoute.length > 0, `${entry.capability} needs an evidence destination`);
    assert.doesNotMatch(entry.evidenceRoute, /^https?:/u, "evidence stays on-site so the link checker covers it");
  }
  // The alpha exposes exactly one command, so exactly one capability may claim
  // to be runnable today.
  assert.equal(capabilityMatrix.filter((entry) => entry.maturity === "available").length, 1);
});

test("the exclusion list keeps its strongest present-tense facts", () => {
  assert.ok(notToday.length >= 6);
  assert.ok(notToday.some((line) => line.includes("0.0.0-qualification")));
  assert.ok(notToday.some((line) => line.includes("not configured")));
  for (const line of notToday) assert.match(line, /^It (is not|does not) /u);
});
