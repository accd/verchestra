import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// why: the single-binary workflow is the only place four of the five targets
// are proven to start from their embedded runtime, and it runs on the same
// hosted fleet as the T76 candidate build. Its shape is therefore asserted the
// way t76-candidate-workflow.test.mjs asserts that one: manual, read-only,
// SHA-pinned, bound to exactly the qualified fleet, and incapable of
// publishing.

const workflow = readFileSync(new URL("../../.github/workflows/single-binary-build.yml", import.meta.url), "utf8");
const lines = workflow.split(/\r?\n/u);

const FLEET = Object.freeze([
  ["Windows x64", "windows-latest", "win32", "x64"],
  ["macOS x64", "macos-15-intel", "darwin", "x64"],
  ["macOS arm64", "macos-14", "darwin", "arm64"],
  ["Linux glibc x64", "ubuntu-latest", "linux", "x64"],
  ["Linux glibc arm64", "ubuntu-24.04-arm", "linux", "arm64"]
]);

function runBlocks() {
  const blocks = [];
  lines.forEach((line, index) => {
    if (!/^\s*run: [|>]/u.test(line)) return;
    const indent = line.search(/\S/u) + 2;
    const body = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() !== "" && lines[cursor].search(/\S/u) < indent) break;
      body.push(lines[cursor]);
    }
    blocks.push({ start: index, indent, body });
  });
  return blocks;
}

test("the workflow is manual, read-only, and requests no identity", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /^permissions:\r?\n {2}actions: read\r?\n {2}contents: read\r?\n\r?\n/mu);
  assert.doesNotMatch(workflow, /:\s*write\b/u, "no scope may be granted write");
  assert.doesNotMatch(workflow, /id-token/u, "no OIDC identity may be requested");
  assert.doesNotMatch(workflow, /secrets\./u, "no secret may be read");
  assert.match(workflow, /fail-fast: false/u);
});

test("the matrix binds exactly the supported five-target fleet on native runners", () => {
  for (const [label, os, platform, arch] of FLEET) {
    const block = new RegExp(
      `- label: ${label}\\s*\\n\\s*os: ${os}\\s*\\n\\s*platform: ${platform}\\s*\\n\\s*arch: ${arch}\\b`,
      "u"
    );
    assert.match(workflow, block, `${label} must map to ${os} (${platform}/${arch})`);
  }
  assert.equal([...workflow.matchAll(/^\s*- label: /gmu)].length, FLEET.length);
  assert.match(workflow, /process\.platform !== process\.env\.MATRIX_PLATFORM/u);
  assert.match(workflow, /process\.arch !== process\.env\.MATRIX_ARCH/u);
  assert.match(workflow, /node --version.*v24\.14\.0/u);
});

test("every action is pinned to a full commit SHA", () => {
  const uses = [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gmu)].map((match) => match[1]);
  assert.ok(uses.length >= 5);
  for (const action of uses) assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, action);
});

test("no dispatch input is interpolated into a shell block", () => {
  for (const block of runBlocks()) {
    assert.doesNotMatch(
      block.body.join("\n"),
      /\$\{\{/u,
      `run block at line ${block.start + 1} interpolates an expression`
    );
  }
  assert.match(workflow, /\[\[ "\$BUILD_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u);
  assert.match(workflow, /"\$INPUTS_RUN_ID" =~ \^\[0-9\]\{1,20\}\$/u);
  assert.match(workflow, /"\$INPUTS_REVISION" =~ \^\[0-9a-f\]\{40\}\$/u);
});

test("nothing in the workflow can publish, sign with an identity, or notarize", () => {
  for (const forbidden of [
    /npm publish/u,
    /pnpm publish/u,
    /gh release/u,
    /upload-release-asset/u,
    /aws s3/u,
    /wrangler/u,
    /notarytool/u,
    /signtool/u,
    /codesign/u,
    /attest-build-provenance/u
  ]) {
    assert.doesNotMatch(workflow, forbidden, `${forbidden} must not appear`);
  }
  const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@/gu)];
  assert.equal(uploads.length, 2, "artifacts are the only output");
  assert.match(workflow, /retention-days: 30/u);
});

test("the runtime is the pinned official archive, verified before any build or test", () => {
  const fetchStep = workflow.indexOf("- name: Fetch the pinned official Node archive and check its digest");
  const suites = workflow.indexOf("- name: Run the single-binary suites with zero skips allowed");
  const build = workflow.indexOf("- name: Build twice from the reviewed inputs and compare every byte");
  assert.ok(fetchStep !== -1 && fetchStep < suites && suites < build);
  assert.match(workflow, /apps\/vestra-launcher\/single-binary\/node-runtime\.json/u);
  assert.match(workflow, /if \(digest !== pin\.sha256\) throw/u);
  assert.match(workflow, /--node-cache node-dist-cache/u);
});

test("the suites run against the fetched runtime and a skipped case fails the leg", () => {
  assert.match(workflow, /VES_NODE_DIST_CACHE: node-dist-cache/u);
  assert.match(workflow, /tests\/build\/vestra-binary\.test\.mjs/u);
  assert.match(workflow, /tests\/unit\/sea-inject\.test\.mjs/u);
  assert.match(workflow, /grep -Eq '\^ℹ fail 0\$'/u);
  assert.match(workflow, /grep -Eq '\^ℹ skipped 0\$'/u);
});

test("reviewed binaries are built twice, compared byte for byte, and run with PATH emptied", () => {
  assert.match(workflow, /for out in vestra-binary vestra-binary-replay; do/u);
  assert.match(workflow, /two builds from identical inputs emitted different bytes/u);
  assert.match(workflow, /const env = \{ PATH: "",/u);
  assert.match(workflow, /--release-inputs reviewed\/t76-release-publication\/release-inputs/u);
  assert.match(
    workflow,
    /name: t76-release-metadata-\$\{\{ inputs\.release_inputs_revision \}\}-\$\{\{ inputs\.release_inputs_run_id \}\}/u
  );
  assert.match(
    workflow,
    /expected = new Set\(\["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"\]\)/u
  );
});

test("every heredoc in the workflow terminates where the shell can find it", () => {
  for (const block of runBlocks()) {
    block.body.forEach((line, offset) => {
      const tag = /<<'([A-Z]+)'/u.exec(line)?.[1];
      if (tag === undefined) return;
      const rest = block.body.slice(offset + 1);
      assert.ok(
        rest.some((candidate) => candidate.trimEnd() === `${" ".repeat(block.indent)}${tag}`),
        `heredoc ${tag} at line ${block.start + offset + 2} does not terminate at column 0 of its block`
      );
    });
  }
});
