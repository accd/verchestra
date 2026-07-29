import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALWAYS_GATE,
  CONSERVATIVE_GATES,
  gatesDeclaredByReport,
  QUALIFICATION_REPORT,
  selectGates
} from "../../scripts/gate-selection.mjs";

const gatesFor = (...paths) => selectGates(paths).gates;

test("every change runs the quick gate", () => {
  assert.deepEqual(gatesFor("README.md"), [ALWAYS_GATE]);
  assert.deepEqual(gatesFor(), [ALWAYS_GATE]);
});

test("package boundary changes select a gate that runs the architecture suite", () => {
  assert.ok(gatesFor("packages/domain/src/index.ts").includes("gate:build"));
  assert.ok(gatesFor("scripts/architecture.mjs").includes("gate:build"));
  assert.ok(gatesFor("tests/architecture/repository-boundaries.test.mjs").includes("gate:build"));
});

for (const path of [
  "packages/policy/src/cedar-policy.ts",
  "packages/evidence/src/integrity/signer.ts",
  "packages/drivers/src/opencode-driver.ts",
  "packages/data-probe/src/oracle-adapter.ts",
  "packages/memory/src/memory-lifecycle.ts",
  "schemas/public-error/1.schema.json",
  "tests/security/cedar-policy.test.mjs",
  "tests/fault-injection/recovery-bundle-faults.test.mjs"
]) {
  test(`${path} selects the security gate`, () => assert.ok(gatesFor(path).includes("gate:security")));
}

for (const path of ["packages/distribution/src/hermetic-bundle.ts", "apps/vestra-cli/src/main.ts"]) {
  test(`${path} selects the release gate`, () => assert.ok(gatesFor(path).includes("gate:release")));
}

test("workflow changes select the release gate so CI cannot relax itself unchecked", () => {
  assert.ok(gatesFor(".github/workflows/ci.yml").includes("gate:release"));
});

test("application and behavior suites select the full gate", () => {
  assert.ok(gatesFor("packages/application/src/execution/task-executor.ts").includes("gate:full"));
  assert.ok(gatesFor("tests/e2e/handoff-journey.test.mjs").includes("gate:full"));
});

test("an unmapped path falls back to the conservative set", () => {
  const selection = selectGates(["some/new/surface/nobody/mapped.ts"]);
  for (const gate of CONSERVATIVE_GATES) assert.ok(selection.gates.includes(gate));
  assert.deepEqual(selection.unmapped, ["some/new/surface/nobody/mapped.ts"]);
  assert.equal(selection.reasons["gate:release"], "unmapped path");
});

test("a deleted or renamed path still selects its surface gate", () => {
  // git reports both sides of a rename and the old path of a deletion, and the
  // policy reads paths rather than file existence, so neither can slip through.
  assert.ok(gatesFor("packages/policy/src/removed-adapter.ts").includes("gate:security"));
  const rename = selectGates(["packages/policy/src/old.ts", "packages/distribution/src/new.ts"]).gates;
  assert.ok(rename.includes("gate:security") && rename.includes("gate:release"));
});

test("a generated projection selects the surface that generates it", () => {
  assert.ok(gatesFor("packages/contracts/src/generated.ts").includes("gate:build"));
  assert.deepEqual(gatesFor("llms.txt"), [ALWAYS_GATE]);
});

test("a multi-surface change unions every applicable gate", () => {
  const selection = selectGates([
    "packages/policy/src/cedar-policy.ts",
    "packages/distribution/src/tuf-update-client.ts",
    "packages/application/src/execution/gate-commit.ts",
    "docs/architecture.md"
  ]);
  assert.deepEqual(selection.gates, ["gate:build", "gate:full", "gate:quick", "gate:release", "gate:security"]);
  assert.deepEqual(selection.unmapped, []);
});

test("a qualification report contributes the gates it declares", () => {
  const report = [
    "---",
    "schema: verchestra-qualification-report/v1",
    "task: T68a",
    "gates: pnpm gate:quick, pnpm gate:security",
    "---",
    "",
    "# T68a Validation"
  ].join("\n");
  assert.ok(QUALIFICATION_REPORT.test("docs/qualification/t68a-validation.md"));
  assert.ok(QUALIFICATION_REPORT.test("docs/qualification/t68-validation.md"));
  assert.equal(QUALIFICATION_REPORT.test("docs/qualification/REPORT-CONTRACT.md"), false);
  assert.deepEqual(gatesDeclaredByReport(report), ["gate:quick", "gate:security"]);
  assert.deepEqual(gatesDeclaredByReport("# no frontmatter"), []);

  const selection = selectGates(["docs/qualification/t68a-validation.md"], gatesDeclaredByReport(report));
  assert.ok(selection.gates.includes("gate:security"));
});

test("the regression that CI missed now selects a detecting gate", () => {
  // test:architecture was red on clean main because apps/site was absent from
  // EXPECTED_PACKAGES, and CI stayed green because it only ran gate:quick.
  const selection = selectGates(["scripts/architecture.mjs", "tests/architecture/repository-boundaries.test.mjs"]);
  assert.ok(
    selection.gates.some((gate) => ["gate:build", "gate:security", "gate:release"].includes(gate)),
    "a change to the package graph must select a gate that runs test:architecture"
  );
});
