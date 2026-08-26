import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/t76-publish-release.yml", import.meta.url), "utf8");
const candidateBuild = readFileSync(
  new URL("../../.github/workflows/t76-candidate-build.yml", import.meta.url),
  "utf8"
);

const DISPATCH_INPUTS = Object.freeze([
  "revision",
  "candidate_run_id",
  "base_url",
  "expires",
  "metadata_version",
  "rollback_revision",
  "rollback_run_id"
]);

const lines = workflow.split(/\r?\n/);

// Every line that the shell actually executes, i.e. the body of a `run:` block.
// A block ends at the first non-empty line indented above its own body.
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

test("the T76 publication workflow is manual, read-only, and publishes nothing", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|schedule|release|workflow_call):/mu);
  assert.match(workflow, /^permissions:\r?\n {2}actions: read\r?\n {2}contents: read\r?\n/mu);
  // Read-only means read-only: no scope may be granted write, and no id-token
  // may be minted for a downstream publisher.
  assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/mu);
  assert.doesNotMatch(workflow, /id-token/u);
  // Publishing stays a human step, exactly as `npm publish` does.
  assert.doesNotMatch(workflow, /gh release (?:create|upload)/u);
  assert.doesNotMatch(workflow, /action-gh-release|release-action|upload-release-asset/u);
  assert.doesNotMatch(workflow, /npm publish|pnpm publish/u);
  assert.doesNotMatch(workflow, /releases\/assets|uploads\.github\.com/u);
});

test("the workflow owns no storage endpoint, no upload tool, and only the two role-separated release secrets", () => {
  // The object store belongs to the operator, not to CI: no storage CLI, no
  // storage credential, and no repository-derived location may appear here. The
  // only secrets this workflow may name are the two role-separated signing keys.
  assert.doesNotMatch(workflow, /github\.repository/u);
  assert.doesNotMatch(workflow, /wrangler/iu);
  assert.doesNotMatch(workflow, /rclone/iu);
  assert.doesNotMatch(workflow, /aws s3/iu);
  assert.doesNotMatch(workflow, /cloudflarestorage/iu);
  const secretNames = new Set([...workflow.matchAll(/secrets\.([A-Za-z0-9_]+)/gu)].map(([, name]) => name));
  assert.deepEqual(
    [...secretNames].sort(),
    ["VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64", "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64"].sort()
  );
});

test("every dispatch input is declared and validated against an exact pattern before use", () => {
  for (const name of DISPATCH_INPUTS)
    assert.match(workflow, new RegExp(`^ {6}${name}:`, "mu"), `${name} must be a dispatch input`);
  assert.match(workflow, /\[\[ "\$CANDIDATE_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u);
  assert.match(workflow, /\[\[ "\$\(git rev-parse HEAD\)" == "\$CANDIDATE_REVISION" \]\]/u);
  assert.match(workflow, /\[\[ "\$CANDIDATE_RUN_ID" =~ \^\[0-9\]\{1,20\}\$ \]\]/u);
  // The base URL pattern's character classes structurally exclude a userinfo
  // credential, a query, a fragment, and a `${...}` substitution marker, and
  // the trailing slash keeps it a directory-style base.
  assert.equal(
    workflow.includes('[[ "$PUBLICATION_BASE_URL" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._-]+)*/$ ]]'),
    true,
    "base_url must be validated against the exact structural pattern"
  );
  assert.match(workflow, /\[\[ "\$METADATA_EXPIRES" =~ /u);
  assert.match(workflow, /\[\[ "\$METADATA_VERSION" =~ \^\[1-9\]/u);
  assert.match(workflow, /\[\[ "\$ROLLBACK_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u);
  assert.match(workflow, /\[\[ "\$ROLLBACK_RUN_ID" =~ \^\[0-9\]\{1,20\}\$ \]\]/u);
  assert.match(workflow, /node --version.*v24\.14\.0/u);
});

test("no untrusted value reaches a run block except through env", () => {
  // A dispatch input interpolated straight into a shell body is the classic
  // workflow injection. Every `${{ ... }}` in this file must therefore sit on an
  // `env:` or `with:` mapping, never inside an executed script.
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
});

test("each role-separated release secret is a distinct key, reaches one step, and is never echoed", () => {
  for (const name of ["VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64", "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64"]) {
    const uses = [...workflow.matchAll(new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.\\S+ \\}\\}`, "gu"))];
    assert.equal(uses.length, 1, `${name} reaches exactly one step`);
    assert.match(workflow, new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`, "u"));
  }
  // The T75 evidence key carries different authority and must never be
  // substituted for, or read alongside, either release key.
  assert.doesNotMatch(workflow, /VESTRA_T75_EVIDENCE_SIGNING_KEY/u);
  assert.doesNotMatch(workflow, /echo.*VESTRA_RELEASE/iu);
  assert.doesNotMatch(workflow, /cat.*VESTRA_RELEASE/iu);
});

test("the sealed closure and the prior rollback index come from exact run ids", () => {
  const candidateRunIds = [...workflow.matchAll(/run-id: \$\{\{ inputs\.candidate_run_id \}\}/gu)];
  assert.equal(candidateRunIds.length, 2, "the index and the target artifacts come from the same requested run");
  assert.match(workflow, /name: t76-target-index-\$\{\{ inputs\.revision \}\}-\$\{\{ inputs\.candidate_run_id \}\}/u);
  assert.match(workflow, /pattern: t76-target-\*-\$\{\{ inputs\.candidate_run_id \}\}/u);
  assert.match(workflow, /merge-multiple: false/u);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/u);
  assert.match(workflow, /--index candidate\/t76-target-index\.json/u);
  assert.match(workflow, /--targets targets/u);
  // The rollback proof is a complete prior reconciled index from its own exact
  // run, never a digest pair typed into the dispatch form.
  const rollbackRunIds = [...workflow.matchAll(/run-id: \$\{\{ inputs\.rollback_run_id \}\}/gu)];
  assert.equal(rollbackRunIds.length, 1, "the prior index comes from the requested rollback run");
  assert.match(
    workflow,
    /name: t76-target-index-\$\{\{ inputs\.rollback_revision \}\}-\$\{\{ inputs\.rollback_run_id \}\}/u
  );
  assert.match(workflow, /path: rollback/u);
  assert.match(workflow, /--rollback-index rollback\/t76-target-index\.json/u);
  assert.doesNotMatch(workflow, /rollback_release_digest|rollback_verification_digest/u);
});

test("the operator-supplied base URL reaches the signer as a validated quoted argument", () => {
  assert.match(workflow, /--base-url "\$PUBLICATION_BASE_URL"/u);
  assert.doesNotMatch(workflow, /--repository|--tag /u);
  assert.doesNotMatch(workflow, /RELEASE_TAG/u);
});

test("every action is SHA-pinned to the revision the repository already reviewed", () => {
  const pins = [...workflow.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)];
  assert.equal(pins.length, 9, "checkout, two setups, three downloads, and three uploads are expected");
  const reviewed = new Map(
    [...candidateBuild.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)].map(([, action, sha]) => [action, sha])
  );
  for (const [, action, sha, version] of pins) {
    assert.match(version, /^v\d+\.\d+\.\d+$/u, `${action} must carry its reviewed action version comment`);
    const already = reviewed.get(action);
    if (already !== undefined) assert.equal(sha, already, `${action} must use the pin already reviewed for T76`);
  }
  assert.doesNotMatch(workflow, /uses: \S+@(?!\w{40})/u);
  assert.match(workflow, /version: 10\.34\.5/u);
  assert.match(workflow, /node-version: 24\.14\.0/u);
});

test("a workflow that runs repository Node code installs its dependencies first", () => {
  // The same failure the T75 signing workflow shipped: a run that reaches
  // repository sources with no install cannot even load the canonicalizer.
  const install = workflow.indexOf("pnpm install --frozen-lockfile");
  const firstNodeRun = workflow.indexOf("node scripts/");
  assert.ok(install >= 0, "the workflow installs dependencies");
  assert.ok(firstNodeRun >= 0, "the workflow runs repository Node code");
  assert.ok(install < firstNodeRun, "dependencies are installed before any repository script runs");
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts\s+pnpm rebuild esbuild/u);
  // The rebuild list is proven rather than trusted, exactly as the candidate
  // build proves its own.
  assert.match(workflow, /require\('esbuild'\)\.buildSync/u);
  assert.doesNotMatch(workflow, /pnpm install --frozen-lockfile\n/u);
});

test("every heredoc in the workflow terminates where the shell can find it", () => {
  // A heredoc terminator indented past column 0 of its own emitted script makes
  // bash read to end-of-file; the candidate build lost five targets to exactly
  // that before a single gate ran.
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

test("the run emits signed metadata, signed targets, pinned inputs, and the upload manifest", () => {
  assert.match(workflow, /--out t76-release-publication/u);
  assert.match(workflow, /name: t76-release-metadata-\$\{\{ inputs\.revision \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(workflow, /name: t76-release-targets-\$\{\{ inputs\.revision \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(workflow, /t76-release-publication\/publication-manifest\.json/u);
  assert.match(workflow, /t76-release-publication\/publication\/\*\/metadata/u);
  assert.match(workflow, /t76-release-publication\/publication\/\*\/targets/u);
  assert.match(workflow, /t76-release-publication\/release-inputs/u);
  // An empty artifact would look like a successful publication that produced
  // nothing, so every upload fails closed instead of warning.
  assert.equal([...workflow.matchAll(/if-no-files-found: error/gu)].length, 3);
  assert.doesNotMatch(workflow, /if-no-files-found: (?:warn|ignore)/u);
});

test("the emitted pinned inputs are proved against the real launcher build", () => {
  // The pinned inputs are only useful if `build:vestra-launcher` accepts them,
  // and that acceptance includes the rootDigest check the build performs. One
  // release-inputs directory serves every target, so no per-target selection
  // variable may exist.
  assert.match(workflow, /pnpm build:vestra-launcher --/u);
  assert.match(workflow, /--release-inputs "t76-release-publication\/release-inputs"/u);
  assert.doesNotMatch(workflow, /VERIFIED_TARGET_KEY/u);
  assert.match(workflow, /name: t76-launcher-package-verification-/u);
});
