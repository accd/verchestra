import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ALWAYS_GATE, CONSERVATIVE_GATES, QUALIFICATION_REPORT, selectGates } from "../../scripts/gate-selection.mjs";
import { GATE_STAGES, stagesForGates } from "../../scripts/gate-stages.mjs";
import { githubOutputFor } from "../../scripts/gate-output.mjs";
import { buildEvidence } from "../../scripts/select-gates.mjs";

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

test("a qualification report selects the conservative profiles regardless of its declaration", () => {
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
  assert.ok(report.includes("gates: pnpm gate:quick, pnpm gate:security"));
  const selection = selectGates(["docs/qualification/t68a-validation.md"]);
  assert.ok(selection.gates.includes("gate:full"));
  assert.ok(selection.gates.includes("gate:release"));
});

for (const path of [".github/workflows/ci.yml", ".github/dependabot.yml"]) {
  test(`${path} selects conservative full and release verification`, () => {
    const gates = gatesFor(path);
    assert.ok(gates.includes("gate:full"));
    assert.ok(gates.includes("gate:release"));
  });
}

test("the stage union is deterministic and executes each selected stage once", () => {
  const stages = stagesForGates(["gate:quick", "gate:full", "gate:release"]);
  assert.equal(new Set(stages).size, stages.length);
  assert.deepEqual(stages, [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "test:agent-readiness",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:fault",
    "build",
    "test:architecture",
    "test:qualification",
    "test:security",
    "test:release"
  ]);
  assert.deepEqual(GATE_STAGES["gate:quick"], stages.slice(0, 5));
});

test("a multi-commit push range includes every commit since github.event.before", () => {
  const repository = mkdtempSync(join(tmpdir(), "verchestra-gate-selection-"));
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "--initial-branch=main");
    git("config", "user.email", "gate-test@example.invalid");
    git("config", "user.name", "Gate test");
    writeFileSync(join(repository, "README.md"), "initial\n");
    git("add", ".");
    git("commit", "-m", "initial");
    const before = git("rev-parse", "HEAD");
    mkdirSync(join(repository, "packages", "application", "src"), { recursive: true });
    writeFileSync(join(repository, "packages", "application", "src", "first.ts"), "export {};\n");
    git("add", ".");
    git("commit", "-m", "application change");
    mkdirSync(join(repository, "packages", "distribution", "src"), { recursive: true });
    writeFileSync(join(repository, "packages", "distribution", "src", "second.ts"), "export {};\n");
    git("add", ".");
    git("commit", "-m", "distribution change");

    const evidence = buildEvidence({ base: before, repository });
    assert.equal(evidence.selectionMode, "git-range");
    assert.equal(evidence.changedPathCount, 2);
    assert.ok(evidence.gates.includes("gate:full"));
    assert.ok(evidence.gates.includes("gate:release"));
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("an all-zero initial push SHA records a conservative fallback without paths", () => {
  const evidence = buildEvidence({ base: "0".repeat(40) });
  assert.equal(evidence.selectionMode, "conservative-fallback");
  assert.equal(evidence.fallbackReason, "base SHA is unavailable");
  assert.ok(evidence.gates.includes("gate:full"));
  assert.ok(evidence.gates.includes("gate:release"));
  assert.equal(JSON.stringify(evidence).includes("<conservative-fallback>"), false);
});

test("GitHub output contains only the selected stage list", () => {
  assert.equal(
    githubOutputFor({ stages: ["format:check", "test:e2e", "test:release"] }),
    "stages=format:check test:e2e test:release\n"
  );
  assert.throws(() => githubOutputFor({ stages: ["format:check", "bad stage"] }), /no valid stages/u);
});

test("the CI contract compares event-specific bases and runs emitted stages once", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/u);
  assert.match(workflow, /github\.event\.before/u);
  assert.doesNotMatch(workflow, /HEAD~1/u);
  assert.match(workflow, /steps\.selection\.outputs\.stages/u);
  assert.match(workflow, /pnpm run "\$stage"/u);
  assert.match(workflow, /node scripts\/gate-output\.mjs gate-selection\.json "\$GITHUB_OUTPUT"/u);
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
