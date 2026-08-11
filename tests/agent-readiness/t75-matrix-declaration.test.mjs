import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GATE_STAGES } from "../../scripts/gate-stages.mjs";

const matrix = JSON.parse(
  readFileSync(new URL("../../.specs/features/platform-qualification-matrix/matrix.json", import.meta.url), "utf8")
);
const workflow = readFileSync(new URL("../../.github/workflows/platform-matrix.yml", import.meta.url), "utf8");
const probeIndex = readFileSync(new URL("../../packages/data-probe/src/index.ts", import.meta.url), "utf8");
const selfTestRules = readFileSync(
  new URL("../../packages/application/src/self-test/self-test.ts", import.meta.url),
  "utf8"
);

const dimension = (name) => matrix.dimensions.find((entry) => entry.dimension === name);
const cases = (name) => (dimension(name)?.cases ?? []).map((entry) => entry.case);
const STATUSES = new Set(Object.keys(matrix.statuses));

// T75 acceptance criterion 1 is "zero required platform or topology case is
// skipped". That is only checkable if the required set is derived from the
// canonical sources rather than transcribed by hand — a hand-written list can
// silently lose a case, which is precisely the omission the criterion forbids.
// These tests bind the declaration to those sources.

test("every dimension issue #16 names is declared", () => {
  // Named in the issue's own Scope section.
  const required = ["platform", "topology", "driver", "sandbox", "database", "installer", "recovery", "self-test"];
  const declared = matrix.dimensions.map((entry) => entry.dimension);
  for (const name of required) {
    assert.ok(declared.includes(name), `issue #16 names the ${name} matrix and it is not declared`);
  }
});

test("every declared case carries a status the matrix defines", () => {
  for (const entry of matrix.dimensions) {
    for (const item of entry.cases) {
      assert.ok(STATUSES.has(item.status), `${entry.dimension}/${item.case} has undeclared status ${item.status}`);
      assert.ok(
        typeof item.evidence === "string" && item.evidence.length > 0,
        `${entry.dimension}/${item.case} carries no evidence`
      );
    }
  }
});

test("the platform dimension declares exactly the fleet the workflow runs", () => {
  const fleet = [...workflow.matchAll(/platform: (\w+)\r?\n\s*arch: (\w+)/gu)].map(
    (match) => `${match[1]}-${match[2]}`
  );
  assert.ok(fleet.length > 0, "the workflow must declare a fleet");
  assert.deepEqual(cases("platform").sort(), [...fleet].sort());
});

test("the gate-profile dimension declares exactly the closed profile set", () => {
  const profiles = Object.keys(GATE_STAGES).map((gate) => gate.replace("gate:", ""));
  assert.deepEqual(cases("gate-profile").sort(), profiles.sort());
});

test("the database dimension declares exactly the engines the probe admits", () => {
  const engines = /const ENGINES = \[([^\]]+)\]/u.exec(probeIndex)?.[1];
  assert.ok(engines, "the engine set must be readable from data-probe");
  const declared = [...engines.matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(cases("database").sort(), declared.sort());
});

test("the self-test dimension declares exactly the four sealed profiles", () => {
  const ids = /export type SelfTestProfileId =([^;]+);/u.exec(selfTestRules)?.[1];
  assert.ok(ids, "the profile ids must be readable from the self-test rules");
  const declared = [...ids.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(cases("self-test").sort(), declared.sort());
});

test("nothing not-qualified is described as if it passed", () => {
  // The honesty clause. A case that is not qualified must say why, and must not
  // borrow the language of one that is.
  for (const entry of matrix.dimensions) {
    for (const item of entry.cases) {
      if (item.status === "qualified") continue;
      assert.ok(
        item.evidence.length > 40,
        `${entry.dimension}/${item.case} is ${item.status} and must explain itself, not just assert a label`
      );
    }
  }
});

test("the database claim matches AD-017 rather than the superseded principal-target wording", () => {
  // #16 originally called SAP ASE a principal qualification target while no
  // live engine but SQLite was ever qualified. AD-017 narrowed the claim; this
  // pins the correction so it cannot quietly regress.
  const sybase = dimension("database").cases.find((item) => item.case === "sybase");
  assert.equal(sybase.status, "contract-qualified");
  assert.match(sybase.evidence, /NOT a principal qualification target/u);
  const sqlite = dimension("database").cases.find((item) => item.case === "sqlite");
  assert.equal(sqlite.status, "qualified", "SQLite is the one engine with a real driver");
});

test("the environmental platform case is never counted as a pass", () => {
  const intel = dimension("platform").cases.find((item) => item.case === "darwin-x64");
  assert.equal(intel.status, "environmental");
  assert.notEqual(intel.status, "qualified");
});
