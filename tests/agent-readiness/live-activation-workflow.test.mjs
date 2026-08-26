import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/live-activation-matrix.yml", import.meta.url), "utf8");

const escapeForRegExp = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// The same supported fleet the deterministic gate matrix runs (issue #16 /
// platform-matrix.yml). L7 is about live activation on every one of these, so
// the exact five legs and the runner each resolves to are pinned here rather
// than trusted to a reviewer's glance.
const FLEET = Object.freeze([
  { label: "Windows x64", os: "windows-latest", platform: "win32", arch: "x64" },
  { label: "macOS x64", os: "macos-15-intel", platform: "darwin", arch: "x64" },
  { label: "macOS arm64", os: "macos-14", platform: "darwin", arch: "arm64" },
  { label: "Linux glibc x64", os: "ubuntu-latest", platform: "linux", arch: "x64" },
  { label: "Linux glibc arm64", os: "ubuntu-24.04-arm", platform: "linux", arch: "arm64" }
]);

test("the live matrix covers exactly the supported fleet, each bound to its runner and architecture", () => {
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
  const legCount = [...workflow.matchAll(/^\s*- label: /gmu)].length;
  assert.equal(legCount, FLEET.length, "the matrix must declare exactly the supported fleet");
});

test("a failing live leg surfaces rather than cancelling the fleet", () => {
  assert.match(workflow, /fail-fast: false/u);
});

test("the live matrix runs on demand only, never as a per-commit tax", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}push:/mu);
  assert.doesNotMatch(workflow, /^ {2}pull_request:/mu);
  assert.doesNotMatch(workflow, /pull_request_target/u);
});

test("the live matrix holds only read authority, carries no secret, and forces one shell", () => {
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/mu);
  // A live activation test needs no repository secret; it runs a public package.
  // Naming one would be the exact over-authority this workflow must never have.
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.match(workflow, /^defaults:\r?\n {2}run:\r?\n {4}shell: bash/mu);
});

test("every action is SHA-pinned to a reviewed release", () => {
  const uses = [...workflow.matchAll(/uses: (\S+)/gu)].map((match) => match[1]);
  assert.ok(uses.length > 0, "the workflow must use at least one action");
  for (const reference of uses)
    assert.match(reference, /@[0-9a-f]{40}$/u, `${reference} must be pinned to a 40-character commit SHA`);
});

test("the version selectors reach the shell through the environment, not interpolation", () => {
  // The dispatch inputs are attacker-influenceable text; interpolating them into
  // run: is the script-injection shape. They must arrive as env and be validated.
  assert.match(workflow, /BASE_VERSION: \$\{\{ inputs\.base_version \}\}/u);
  assert.match(workflow, /UPDATE_VERSION: \$\{\{ inputs\.update_version \}\}/u);
  // Every `${{ inputs.* }}` occurrence is an env-mapping value, never inside a
  // shell command — so the run body can only see them as validated env vars.
  const inputRefs = [...workflow.matchAll(/(\S+): \$\{\{ inputs\.\w+ \}\}/gu)];
  assert.equal(inputRefs.length, 2, "dispatch inputs may reach the job only through env mappings");
  assert.equal(inputRefs.filter((match) => /VERSION$/u.test(match[1])).length, 2);
  // The run body references them as shell env vars, not as expressions.
  assert.match(workflow, /"verchestra@\$BASE_VERSION"/u);
  assert.match(workflow, /"verchestra@\$UPDATE_VERSION"/u);
  // Validated before either can reach a command line.
  assert.match(workflow, /\*\[!A-Za-z0-9\.-\]\*\) echo "invalid version selector/u);
});

test("each leg refuses to attribute a live activation to the wrong target", () => {
  assert.match(workflow, /node_platform.*!=.*MATRIX_PLATFORM/u);
  assert.match(workflow, /node_arch.*!=.*MATRIX_ARCH/u);
});

test("each leg runs the full installed-user lifecycle: activate, update, rollback, prove, recover", () => {
  assert.match(workflow, /run_phase activate\s+npx --yes "verchestra@\$BASE_VERSION"\s+--version/u);
  assert.match(workflow, /run_phase update\s+npx --yes "verchestra@\$UPDATE_VERSION"\s+--version/u);
  assert.match(workflow, /run_phase rollback\s+npx --yes "verchestra@\$BASE_VERSION"\s+--version/u);
  assert.match(workflow, /run_phase self-test\s+npx --yes "verchestra@\$BASE_VERSION"\s+self-test --profile smoke/u);
  // Disaster recovery: the managed state root is wiped, then recovered from nothing.
  assert.match(workflow, /rm -rf "\$STATE_ROOT"/u);
  assert.match(workflow, /run_phase recover\s+npx --yes "verchestra@\$BASE_VERSION"\s+--version/u);
});

test("the state root wiped is the launcher's own machine-local layout, per platform", () => {
  assert.match(workflow, /Windows\) STATE_ROOT="\$\{LOCALAPPDATA:-\$HOME\/AppData\/Local\}\/Verchestra\/state"/u);
  assert.match(workflow, /macOS\) {3}STATE_ROOT="\$HOME\/Library\/Application Support\/Verchestra\/state"/u);
  assert.match(workflow, /Linux\) {3}STATE_ROOT="\$\{XDG_STATE_HOME:-\$HOME\/\.local\/state\}\/verchestra"/u);
});

test("every leg's transcript is uploaded even on failure, and named uniquely", () => {
  // A failed live leg is evidence too; recording only the successes would let a
  // reviewer read a green fleet for a run where a platform never activated.
  assert.match(workflow, /- name: Upload the live transcript\r?\n\s*# [^\n]*\r?\n\s*if: always\(\)/u);
  assert.match(workflow, /path: transcript/u);
  assert.match(
    workflow,
    /name: live-activation-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.arch \}\}-\$\{\{ github\.run_id \}\}/u
  );
});
