import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GATE_STAGES } from "../../scripts/gate-stages.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/platform-matrix.yml", import.meta.url), "utf8");

const escapeForRegExp = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// The supported fleet is issue #16's own scope list. This binding is the whole
// point of the workflow: T75 acceptance requires that "zero required platform
// case is skipped", so the exact five legs — and the runner, platform, and
// architecture each resolves to — are pinned here rather than trusted to a
// reviewer's glance at the YAML.
const FLEET = Object.freeze([
  { label: "Windows x64", os: "windows-latest", platform: "win32", arch: "x64" },
  { label: "macOS x64", os: "macos-13", platform: "darwin", arch: "x64" },
  { label: "macOS arm64", os: "macos-14", platform: "darwin", arch: "arm64" },
  { label: "Linux glibc x64", os: "ubuntu-latest", platform: "linux", arch: "x64" },
  { label: "Linux glibc arm64", os: "ubuntu-24.04-arm", platform: "linux", arch: "arm64" }
]);

test("the platform matrix covers exactly the supported fleet, each bound to its runner and architecture", () => {
  for (const leg of FLEET) {
    const block = new RegExp(
      [
        `- label: ${escapeForRegExp(leg.label)}`,
        `\\s*\\n\\s*os: ${escapeForRegExp(leg.os)}`,
        `\\s*\\n\\s*platform: ${escapeForRegExp(leg.platform)}`,
        `\\s*\\n\\s*arch: ${escapeForRegExp(leg.arch)}\\b`
      ].join(""),
      "u"
    );
    assert.match(workflow, block, `${leg.label} must map to ${leg.os} (${leg.platform}/${leg.arch})`);
  }
  // Exactly the declared legs: an extra unpinned leg, or a dropped one, is the
  // "skipped required platform case" the acceptance criteria forbid.
  const legCount = [...workflow.matchAll(/^\s*- label: /gmu)].length;
  assert.equal(legCount, FLEET.length, "the matrix must declare exactly the supported fleet");
});

test("a failing platform leg surfaces rather than cancelling the fleet", () => {
  // One platform gap is the signal this workflow exists to produce; fail-fast
  // would hide the other four platforms behind the first failure.
  assert.match(workflow, /fail-fast: false/u);
});

test("the fleet runs on demand only, never as a per-commit tax", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}push:/mu);
  assert.doesNotMatch(workflow, /^ {2}pull_request:/mu);
});

test("the fleet holds only read authority and one cross-platform shell", () => {
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/mu);
  // full-validation.yml's bash entry points (set -euo pipefail, heredocs, case
  // guards) only run identically on Windows when bash is forced there.
  assert.match(workflow, /^defaults:\r?\n {2}run:\r?\n {4}shell: bash/mu);
});

test("every leg checks out full history so the merge-base ancestor proof holds", () => {
  // A shallow fetch marks the candidate as a graft boundary and silently reports
  // an older task; the same failure full-validation.yml guards against.
  assert.match(workflow, /fetch-depth: 0/u);
});

test("the closed gate options match the gate profiles and the shell guard agrees", () => {
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
  // The release-candidate security gate is the criterion the fleet exists to
  // prove, so it is the default a bare dispatch runs.
  assert.match(workflow, /default: "security"/u);
});

test("a selectable gate that probes drivers installs them, derived from the profile definition", () => {
  const needsProbes = Object.entries(GATE_STAGES)
    .filter(([, stages]) => stages.includes("test:qualification"))
    .map(([gate]) => gate);
  assert.ok(needsProbes.length > 0, "at least one profile must run test:qualification");
  // Derived from the candidate revision's own gate definition, so a new probing
  // profile cannot be added without the install following it.
  assert.match(workflow, /import \{ GATE_STAGES \} from '\.\/scripts\/gate-stages\.mjs';/u);
  assert.match(workflow, /stages\.includes\('test:qualification'\)/u);
  assert.match(workflow, /if: steps\.probes\.outputs\.needed == 'yes'/u);
  assert.match(
    workflow,
    /npm install --global --no-audit --no-fund @anthropic-ai\/claude-code@[\d.]+ @openai\/codex@[\d.]+/u
  );
  assert.match(workflow, /case "\$claude_version" in/u);
  assert.match(workflow, /case "\$codex_version" in/u);
});

test("the selected gate reaches the shell through the environment, not interpolation", () => {
  // An expression pasted into run: is the script-injection shape; the case guard
  // already closes it and refusing the shape closes it twice.
  assert.match(workflow, /run: pnpm "\$CANDIDATE_GATE"/u);
  assert.doesNotMatch(workflow, /run: pnpm \$\{\{/u);
});

test("each leg records evidence binding platform, architecture, runtime, and a self-check", () => {
  // Acceptance criterion 3 — reports bind platform, architecture, runtime,
  // candidate, and evidence digests.
  assert.match(workflow, /revision,\r?\n\s*ref:/u);
  assert.match(workflow, /platform: process\.platform/u);
  assert.match(workflow, /arch: process\.arch/u);
  assert.match(workflow, /runtime: process\.version/u);
  assert.match(workflow, /createHash\("sha256"\)/u);
  // The matrix labels claim an architecture; the runner must actually be it or
  // the evidence lies, so the leg refuses a mismatch rather than recording it.
  assert.match(workflow, /runner arch \$\{process\.arch\} does not match matrix/u);
  // The evidence file is named for what it records, and each leg's artifact is
  // unique so five legs never overwrite one another.
  assert.match(workflow, /platform-validation\.json/u);
  assert.match(
    workflow,
    /name: platform-evidence-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.arch \}\}-\$\{\{ github\.run_id \}\}/u
  );
});
