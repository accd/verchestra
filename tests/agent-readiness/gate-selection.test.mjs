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

for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"]) {
  test(`${path} (root dependency surface) selects conservative supply-chain verification`, () => {
    // A dependency or lockfile bump can move behavior on any surface, so it may
    // not slip through on gate:quick the way the metadata catch-all once allowed.
    const gates = gatesFor(path);
    assert.ok(gates.includes("gate:full"));
    assert.ok(gates.includes("gate:release"));
  });
}

for (const path of [
  "scripts/gate.mjs",
  "scripts/gate-stages.mjs",
  "scripts/gate-selection.mjs",
  "scripts/test-scope.mjs"
]) {
  test(`${path} (gate machinery) selects conservative verification`, () => {
    // A change to how gates are composed or selected must run the most
    // verification, not the least; otherwise the policy can relax itself unseen.
    const gates = gatesFor(path);
    assert.ok(gates.includes("gate:full"));
    assert.ok(gates.includes("gate:release"));
  });
}

test("the security gate exercises contract and e2e evidence, not only the unit and security suites", () => {
  assert.ok(GATE_STAGES["gate:security"].includes("test:contract"));
  assert.ok(GATE_STAGES["gate:security"].includes("test:e2e"));
});

test("the mutation sensor suite is executed by the gate its path selects", () => {
  // tests/mutation/ selects gate:full; that gate must actually run test:mutation,
  // or the sensor suite is orphaned - routed but executed by nothing.
  assert.ok(gatesFor("tests/mutation/verification-sensor.test.mjs").includes("gate:full"));
  assert.ok(GATE_STAGES["gate:full"].includes("test:mutation"));
});

test("the stage union is deterministic and executes each selected stage once", () => {
  const stages = stagesForGates(["gate:quick", "gate:full", "gate:release"]);
  assert.equal(new Set(stages).size, stages.length);
  assert.deepEqual(stages, [
    "format:check",
    "lint",
    "complexity:check",
    "typecheck",
    "test:unit",
    "test:agent-readiness",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:fault",
    "test:mutation",
    "build",
    "test:architecture",
    "test:qualification",
    "test:security",
    "test:release"
  ]);
  assert.deepEqual(GATE_STAGES["gate:quick"], stages.slice(0, 6));
});

test("every gate profile enforces the complexity ratchet immediately after lint", () => {
  for (const [gate, stages] of Object.entries(GATE_STAGES)) {
    const lintIndex = stages.indexOf("lint");
    assert.notEqual(lintIndex, -1, `${gate} must lint`);
    assert.equal(stages[lintIndex + 1], "complexity:check", `${gate} must run the complexity ratchet after lint`);
  }
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

test("manual qualification validation accepts only its closed gate profiles", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/full-validation.yml", import.meta.url), "utf8");
  assert.match(workflow, /gate:\s*\n\s*description: "Closed qualification profile to run"/u);
  assert.match(workflow, /echo "gate=gate:\$REQUESTED_GATE"/u);
  assert.doesNotMatch(workflow, /gate: "gate:full"/u);
});

// Making a profile selectable is not the same as making it runnable. Three of
// the five run test:qualification, which probes installed driver binaries; a
// manual run that omits them fails on a clean runner while passing on a machine
// that happens to have the CLIs, which is the opposite of portable evidence.
test("a manually selectable gate that probes drivers installs them", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/full-validation.yml", import.meta.url), "utf8");
  const needsProbes = Object.entries(GATE_STAGES)
    .filter(([, stages]) => stages.includes("test:qualification"))
    .map(([gate]) => gate);
  assert.ok(needsProbes.length > 0, "at least one profile must run test:qualification");
  const options = /options:[ \t]*\r?\n((?:[ \t]*- \w+[ \t]*\r?\n)+)/u.exec(workflow);
  const offered = [...options[1].matchAll(/- (\w+)/gu)].map((entry) => `gate:${entry[1]}`);
  assert.ok(
    needsProbes.some((gate) => offered.includes(gate)),
    "this test is only meaningful while a probing profile is selectable"
  );
  // The need is derived from the candidate revision's own gate definition, so a
  // new probing profile cannot be added without the install following it.
  assert.match(workflow, /import \{ GATE_STAGES \} from '\.\/scripts\/gate-stages\.mjs';/u);
  assert.match(workflow, /stages\.includes\('test:qualification'\)/u);
  assert.match(workflow, /if: steps\.probes\.outputs\.needed == 'yes'/u);
  assert.match(
    workflow,
    /npm install --global --no-audit --no-fund @anthropic-ai\/claude-code@[\d.]+ @openai\/codex@[\d.]+/u
  );
  // The same pinned versions CI verifies, verified the same way.
  assert.match(workflow, /case "\$claude_version" in/u);
  assert.match(workflow, /case "\$codex_version" in/u);
});

// A manual run is where a maintainer produces attestable evidence, so it has to
// be able to attest every profile a qualification report may cite. Offering only
// quick and full is what pushed the T68a report to drop gate:security.
test("every gate the report contract recognises is selectable", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/full-validation.yml", import.meta.url), "utf8");
  const options = /options:[ \t]*\r?\n((?:[ \t]*- \w+[ \t]*\r?\n)+)/u.exec(workflow);
  assert.ok(options, "the dispatch input must declare a closed option list");
  const offered = [...options[1].matchAll(/- (\w+)/gu)].map((entry) => `gate:${entry[1]}`);
  assert.deepEqual([...offered].sort(), [...Object.keys(GATE_STAGES)].sort());
  // The shell guard must agree with the option list, so neither can drift alone.
  const guard = /case "\$REQUESTED_GATE" in\s*\n\s*([\w|]+)\)/u.exec(workflow);
  assert.ok(guard, "the shell must guard the requested gate independently");
  assert.deepEqual(
    guard[1]
      .split("|")
      .map((name) => `gate:${name}`)
      .sort(),
    [...offered].sort()
  );
});

test("the selected gate reaches the shell through the environment, not interpolation", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/full-validation.yml", import.meta.url), "utf8");
  // An expression pasted into run: is the script-injection shape. The case guard
  // already closes it; refusing the shape closes it twice.
  assert.match(workflow, /run: pnpm "\$CANDIDATE_GATE"/u);
  assert.doesNotMatch(workflow, /run: pnpm \$\{\{/u);
});

test("the recorded evidence file is named after the profile it can record", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/full-validation.yml", import.meta.url), "utf8");
  // A gate:quick run written to full-validation.json would read stronger than it
  // is, which is the failure this repository keeps having to correct.
  assert.doesNotMatch(workflow, /full-validation\.json/u);
  assert.match(workflow, /qualification-validation\.json/u);
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
