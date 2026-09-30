import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/t76-refresh-timestamp.yml", import.meta.url), "utf8");
const publish = readFileSync(new URL("../../.github/workflows/t76-publish-release.yml", import.meta.url), "utf8");
const candidateBuild = readFileSync(
  new URL("../../.github/workflows/t76-candidate-build.yml", import.meta.url),
  "utf8"
);

const DISPATCH_INPUTS = Object.freeze(["publish_revision", "publish_run_id", "metadata_version", "timestamp_expires"]);
// invariant: the online key is the protected environment's secret (#408), read into
// the process variable the refresh script expects.
const ONLINE_SECRET = "VESTRA_TUF_ONLINE_KEY_PKCS8_BASE64";
const ONLINE_VARIABLE = "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64";

const lines = workflow.split(/\r?\n/);

// why: every line the shell actually executes: the body of a `run:` block, which
// ends at the first non-empty line indented above its own body.
const runBlockLines = () => {
  const body = [];
  let indent = -1;
  for (const line of lines) {
    if (/^\s*run: [|>]/u.test(line)) {
      indent = line.search(/\S/u) + 2;
      continue;
    }
    if (indent < 0) continue;
    if (line.trim() !== "" && line.search(/\S/u) < indent) {
      indent = -1;
      continue;
    }
    body.push(line);
  }
  return body;
};

// why: the steps as name → text, so a secret can be traced to the one step it reaches.
const steps = () =>
  workflow
    .split(/^ {6}- name: /mu)
    .slice(1)
    .map((text) => ({ name: text.split("\n")[0], text }));

test("the refresh workflow is manual, read-only, and publishes nothing", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|schedule|release|workflow_call):/mu);
  // why: `actions: read` only reaches the publish run's artifact; nothing is writable.
  assert.match(workflow, /^permissions:\r?\n {2}actions: read\r?\n {2}contents: read\r?\n/mu);
  assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/mu);
  assert.doesNotMatch(workflow, /id-token/u);
  assert.doesNotMatch(workflow, /gh release (?:create|upload)/u);
  assert.doesNotMatch(workflow, /action-gh-release|release-action|upload-release-asset/u);
  assert.doesNotMatch(workflow, /npm publish|pnpm publish/u);
  assert.doesNotMatch(workflow, /releases\/assets|uploads\.github\.com/u);
  // why: no storage endpoint and no upload tool: the operator uploads by hand.
  assert.doesNotMatch(workflow, /github\.repository/u);
  assert.doesNotMatch(workflow, /wrangler|rclone|aws s3|cloudflarestorage|gsutil|azcopy/iu);
  assert.doesNotMatch(workflow, /\bcurl\b|\bwget\b/u);
  // why: the ledger is recorded by a reviewed pull request, never by this run.
  assert.doesNotMatch(workflow, /git (?:commit|push|tag)/u);
});

test("only the online key is available, in exactly one step, never echoed", () => {
  const secretNames = new Set([...workflow.matchAll(/secrets\.([A-Za-z0-9_]+)/gu)].map(([, name]) => name));
  assert.deepEqual([...secretNames], [ONLINE_SECRET]);
  // why: the offline root/targets key and the T75 evidence key never appear here.
  assert.doesNotMatch(workflow, /VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64/u);
  assert.doesNotMatch(workflow, /VESTRA_TUF_OFFLINE_KEY/u);
  assert.doesNotMatch(workflow, /VESTRA_T75_EVIDENCE_(?:SIGNING_)?KEY/u);
  const bearing = steps().filter((step) => step.text.includes(`secrets.${ONLINE_SECRET}`));
  assert.equal(bearing.length, 1, "the online secret reaches exactly one step");
  assert.match(
    bearing[0].text,
    new RegExp(`^ {10}${ONLINE_VARIABLE}: \\$\\{\\{ secrets\\.${ONLINE_SECRET} \\}\\}$`, "mu")
  );
  assert.match(bearing[0].text, /node scripts\/t76-refresh-timestamp\.mjs/u);
  assert.doesNotMatch(workflow, /echo.*VESTRA_RELEASE/iu);
  assert.doesNotMatch(workflow, /cat.*VESTRA_RELEASE/iu);
  assert.doesNotMatch(workflow, /printenv|set -x|env \|/u);
});

test("the refresh job is bound to the protected tuf-release-signing environment (#408)", () => {
  // why: the online key lives only in that environment; the job cannot start
  // until its reviewer approves a run dispatched from main.
  assert.equal([...workflow.matchAll(/^ {4}environment: /gmu)].length, 1, "exactly one job binds an environment");
  assert.match(workflow, /^ {2}refresh:\n(?: {4}.*\n)*? {4}environment: tuf-release-signing\n/mu);
});

test("every dispatch input is declared, required, default-free, and validated against an exact pattern", () => {
  for (const name of DISPATCH_INPUTS) {
    const block = new RegExp(`^ {6}${name}:\\n(?: {8}.*\\n)+`, "mu").exec(workflow)?.[0] ?? "";
    assert.match(block, /required: true/u, `${name} must be a required dispatch input`);
    assert.doesNotMatch(block, /^ {8}default:/mu, `${name} must carry no silent default`);
  }
  for (const pattern of [
    '[[ "$PUBLISH_REVISION" =~ ^[0-9a-f]{40}$ ]]',
    '[[ "$PUBLISH_RUN_ID" =~ ^[0-9]{1,20}$ ]]',
    '[[ "$METADATA_VERSION" =~ ^[1-9][0-9]{0,8}$ ]]',
    '[[ "$TIMESTAMP_EXPIRES" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$ ]]'
  ])
    assert.equal(workflow.includes(pattern), true, `${pattern} must validate its input exactly`);
  assert.match(workflow, /node --version.*v24\.14\.0/u);
});

test("no untrusted value reaches a run block except through env", () => {
  const executed = runBlockLines();
  assert.ok(executed.length > 0, "the workflow must actually run something");
  for (const line of executed)
    assert.doesNotMatch(line, /\$\{\{/u, `a run block may not interpolate a workflow expression: ${line.trim()}`);
  for (const name of DISPATCH_INPUTS)
    assert.match(
      workflow,
      new RegExp(`^ {10}[A-Z_]+: \\$\\{\\{ inputs\\.${name} \\}\\}$`, "mu"),
      `${name} must cross into the shell as an env value`
    );
  assert.match(workflow, /--metadata-version "\$METADATA_VERSION"/u);
  assert.match(workflow, /--timestamp-expires "\$TIMESTAMP_EXPIRES"/u);
  assert.match(workflow, /--run-id "\$GITHUB_RUN_ID"/u);
  // why: the committed anchors always apply: no test-only anchor override is passed.
  assert.doesNotMatch(workflow, /--release-anchor|--timestamp-anchor/u);
});

test("the published metadata comes from the exact publish run's artifact", () => {
  assert.match(workflow, /run-id: \$\{\{ inputs\.publish_run_id \}\}/u);
  assert.match(
    workflow,
    /name: t76-release-metadata-\$\{\{ inputs\.publish_revision \}\}-\$\{\{ inputs\.publish_run_id \}\}/u
  );
  // why: the same artifact name the publish workflow uploads.
  assert.match(publish, /name: t76-release-metadata-\$\{\{ inputs\.revision \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/u);
  assert.match(workflow, /--current current/u);
});

test("the ledger is main's tip, the checked-out copy must be its prefix, and both precede signing", () => {
  assert.match(workflow, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/u);
  assert.match(
    workflow,
    /git show origin\/main:docs\/qualification\/tuf-publication-ledger\.json > main-ledger\/tuf-publication-ledger\.json/u
  );
  assert.match(
    workflow,
    /node scripts\/tuf-publication-ledger\.mjs assert-prefix \\\s+docs\/qualification\/tuf-publication-ledger\.json \\\s+main-ledger\/tuf-publication-ledger\.json/u
  );
  assert.match(workflow, /--ledger main-ledger\/tuf-publication-ledger\.json/u);
  const install = workflow.indexOf("pnpm install --frozen-lockfile --ignore-scripts");
  const prefix = workflow.indexOf("assert-prefix");
  const signing = workflow.indexOf("node scripts/t76-refresh-timestamp.mjs");
  assert.ok(install >= 0 && install < prefix, "dependencies are installed before any repository script runs");
  assert.ok(prefix < signing, "the ledger is proven before anything is signed");
});

test("every action is SHA-pinned to the revision the repository already reviewed", () => {
  const pins = [...workflow.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)];
  assert.equal(pins.length, 5, "checkout, two setups, one download, and one upload are expected");
  const reviewed = new Map(
    [...`${candidateBuild}\n${publish}`.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)].map(([, action, sha]) => [
      action,
      sha
    ])
  );
  for (const [, action, sha, version] of pins) {
    assert.match(version, /^v\d+\.\d+\.\d+$/u, `${action} must carry its reviewed action version comment`);
    assert.equal(sha, reviewed.get(action), `${action} must use the pin already reviewed for T76`);
  }
  assert.doesNotMatch(workflow, /uses: \S+@(?!\w{40})/u);
  assert.match(workflow, /version: 10\.34\.5/u);
  assert.match(workflow, /node-version: 24\.14\.0/u);
});

test("every heredoc in the workflow terminates where the shell can find it", () => {
  const runBlockIndent = (index) => {
    for (let cursor = index; cursor >= 0; cursor -= 1)
      if (/^\s*run: [|>]/u.test(lines[cursor])) return lines[cursor].search(/\S/u) + 2;
    throw new Error(`no run block above line ${index + 1}`);
  };
  const openers = lines.map((line, index) => ({ line, index })).filter(({ line }) => /<<'[A-Z]+'/u.test(line));
  assert.ok(openers.length > 0);
  for (const { line, index } of openers) {
    const tag = /<<'([A-Z]+)'/u.exec(line)[1];
    const indent = runBlockIndent(index);
    let terminated = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (candidate.trim() !== "" && candidate.search(/\S/u) < indent) break;
      if (candidate.trimEnd() === `${" ".repeat(indent)}${tag}`) {
        terminated = true;
        break;
      }
    }
    assert.equal(terminated, true, `heredoc ${tag} at line ${index + 1} does not terminate at column 0 of its block`);
  }
});

test("the run uploads the re-signed metadata, the upload manifest, and the ledger entry, and nothing offline", () => {
  assert.match(workflow, /--out t76-timestamp-refresh/u);
  assert.match(
    workflow,
    /name: t76-timestamp-refresh-\$\{\{ inputs\.publish_revision \}\}-\$\{\{ github\.run_id \}\}/u
  );
  assert.match(workflow, /t76-timestamp-refresh\/refresh-manifest\.json/u);
  assert.match(workflow, /t76-timestamp-refresh\/ledger-entry\.json/u);
  assert.match(workflow, /t76-timestamp-refresh\/publication\/\*\/metadata/u);
  assert.equal([...workflow.matchAll(/uses: actions\/upload-artifact@/gu)].length, 1);
  assert.equal([...workflow.matchAll(/if-no-files-found: error/gu)].length, 1);
  assert.doesNotMatch(workflow, /if-no-files-found: (?:warn|ignore)/u);
  // why: only the refresh output is uploaded; the downloaded offline-signed input
  // (root, targets, components) is never re-emitted.
  const upload = steps().find((step) => step.text.includes("actions/upload-artifact@"));
  const uploaded = /^ {10}path: \|\n((?: {12}\S.*\n)+)/mu.exec(upload.text)[1].trim().split(/\s+/u);
  assert.deepEqual(uploaded, [
    "t76-timestamp-refresh/refresh-manifest.json",
    "t76-timestamp-refresh/ledger-entry.json",
    "t76-timestamp-refresh/publication/*/metadata"
  ]);
});
