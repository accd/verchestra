import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/t76-candidate-build.yml", import.meta.url), "utf8");

const FLEET = Object.freeze([
  ["Windows x64", "windows-latest", "win32", "x64"],
  ["macOS x64", "macos-15-intel", "darwin", "x64"],
  ["macOS arm64", "macos-14", "darwin", "arm64"],
  ["Linux glibc x64", "ubuntu-latest", "linux", "x64"],
  ["Linux glibc arm64", "ubuntu-24.04-arm", "linux", "arm64"]
]);

test("T76 candidate workflow is manual, read-only, and fail-fast disabled", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request):/mu);
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/mu);
  assert.match(workflow, /fail-fast: false/u);
});

test("T76 candidate workflow binds exactly the supported five-target fleet", () => {
  for (const [label, os, platform, arch] of FLEET) {
    const block = new RegExp(
      [
        `- label: ${label}`,
        `\\s*\\n\\s*os: ${os}`,
        `\\s*\\n\\s*platform: ${platform}`,
        `\\s*\\n\\s*arch: ${arch}\\b`
      ].join(""),
      "u"
    );
    assert.match(workflow, block, `${label} must map to ${os} (${platform}/${arch})`);
  }
  assert.equal([...workflow.matchAll(/^\s*- label: /gmu)].length, FLEET.length);
});

test("each target checks the exact revision, qualified runtime, and runner identity", () => {
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.revision \}\}/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /node --version.*v24\.14\.0/u);
  assert.match(workflow, /process\.platform !== process\.env\.MATRIX_PLATFORM/u);
  assert.match(workflow, /process\.arch !== process\.env\.MATRIX_ARCH/u);
});

test("every closed gate is executed and its counters are sealed before building", () => {
  assert.match(workflow, /profiles=\(quick full build security release\)/u);
  assert.match(workflow, /pnpm "gate:\$\{profile\}"/u);
  assert.match(workflow, /assertionCount = sum\(\/\\u2139 tests/u);
  assert.match(workflow, /skipped = sum\(\/\\u2139 skipped/u);
  assert.match(workflow, /todo = sum\(\/\\u2139 todo/u);
  assert.match(workflow, /survivingMutants: 0/u);
  assert.match(workflow, /if: steps\.gates\.outcome == 'success'/u);
  assert.match(workflow, /--evaluations gate-evaluations\.json/u);
});

test("target bytes and evidence are portable, content-addressed artifacts", () => {
  assert.match(workflow, /--out t76-target-output/u);
  assert.match(workflow, /releaseDigest: bundle\.releaseDigest/u);
  assert.match(workflow, /gateEvidenceDigest/u);
  assert.match(workflow, /canonicalizeJsonV2\(evidence\)/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/u);
  assert.match(workflow, /retention-days: 30/u);
});

test("collection requires exactly one successful closure for every target", () => {
  assert.match(workflow, /^  collect:/mu);
  assert.match(workflow, /needs: target\r?\n\s*if: always\(\)/u);
  assert.match(
    workflow,
    /expected = new Set\(\["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"\]\)/u
  );
  assert.match(workflow, /entries\.length !== expected\.size/u);
  assert.match(workflow, /value\.revision !== process\.env\.CANDIDATE_REVISION/u);
  assert.match(workflow, /t76-target-index-\$\{\{ inputs\.revision \}\}/u);
});
