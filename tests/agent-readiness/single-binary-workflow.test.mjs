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
  assert.match(workflow, /^permissions:\r?\n {2}contents: read\r?\n\r?\n/mu);
  assert.match(
    workflow,
    /^ {2}target:\r?\n(?: {4}\S.*\r?\n)*? {4}permissions:\r?\n {6}actions: read\r?\n {6}contents: read\r?\n/mu,
    "only the job that downloads another run's inputs may read actions"
  );
  assert.equal([...workflow.matchAll(/^\s*actions: read$/gmu)].length, 1, "actions: read is granted exactly once");
  assert.equal([...workflow.matchAll(/^\s*permissions:/gmu)].length, 2, "no other job widens the workflow grant");
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
  assert.match(workflow, /--release-inputs reviewed\/release-inputs \\/u);
  assert.doesNotMatch(workflow, /t76-release-publication/u);
  assert.match(
    workflow,
    /name: t76-release-metadata-\$\{\{ inputs\.release_inputs_revision \}\}-\$\{\{ inputs\.release_inputs_run_id \}\}/u
  );
  assert.match(
    workflow,
    /expected = new Set\(\["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"\]\)/u
  );
});

// why: the first dispatch with reviewed inputs failed on all five legs because the workflow read
// `reviewed/t76-release-publication/release-inputs`, a directory the artifact does not contain.
// `actions/upload-artifact` makes the least common ancestor of several paths the artifact root, so the
// layout is derived here from the publish workflow's own upload paths instead of being written twice.
// The model below (a final segment with an extension is a file, cut at the first wildcard) reproduces what
// the action did on the real upload: the log of job 123880634649 in run 40999595578 reads "The least common
// ancestor is .../t76-release-publication. This will be the root directory of the artifact" (29 files).
function metadataArtifactRoot() {
  const publish = readFileSync(new URL("../../.github/workflows/t76-publish-release.yml", import.meta.url), "utf8");
  const step = /name: t76-release-metadata-[^\n]*\n\s+path: \|\n((?:\s+\S[^\n]*\n)+)/u.exec(publish);
  assert.ok(step, "the publish workflow uploads the t76-release-metadata artifact from a path list");
  const paths = [];
  for (const line of step[1].split("\n")) {
    const text = line.trim();
    // the list ends at the next YAML key of the same step
    if (text === "" || /^[\w-]+:/u.test(text)) break;
    paths.push(text);
  }
  assert.equal(paths.length, 4, "the metadata artifact is uploaded from exactly four paths");
  const directories = paths.map((path) => {
    const segments = path.split("/");
    const wildcard = segments.findIndex((segment) => segment.includes("*"));
    const kept = wildcard === -1 ? segments : segments.slice(0, wildcard);
    // a final segment with an extension is a file, so its directory is the parent
    return /\.[a-z]+$/u.test(kept.at(-1)) ? kept.slice(0, -1) : kept;
  });
  const common = directories.reduce((left, right) => {
    let length = 0;
    while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
    return left.slice(0, length);
  });
  return { root: common.join("/"), paths };
}

test("the reviewed inputs directory is the one the metadata artifact exposes", () => {
  const { root, paths } = metadataArtifactRoot();
  assert.equal(root, "t76-release-publication");
  const inputs = paths.find((path) => path.endsWith("/release-inputs"));
  assert.ok(inputs, "the artifact carries the release-inputs directory");
  const relative = inputs.slice(root.length + 1);
  assert.equal(relative, "release-inputs");
  const download = /name: t76-release-metadata-[^\n]*\n\s+path: (\S+)/u.exec(workflow);
  assert.ok(download, "the workflow downloads the metadata artifact to a path");
  assert.equal(download[1], "reviewed");
  assert.match(workflow, new RegExp(`--release-inputs ${download[1]}/${relative} \\\\`, "u"));
});

test("the derivation reproduces the directory the published package was built from", () => {
  const { root, paths } = metadataArtifactRoot();
  const relative = paths.find((path) => path.endsWith("/release-inputs")).slice(root.length + 1);
  const npm = readFileSync(new URL("../../.github/workflows/npm-publish.yml", import.meta.url), "utf8");
  const download = /name: t76-release-metadata-[^\n]*\n\s+path: (\S+)/u.exec(npm);
  assert.ok(download, "npm-publish downloads the metadata artifact to a path");
  assert.match(npm, new RegExp(`--release-inputs ${download[1]}/${relative}(?![\\w/.-])`, "u"));
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
