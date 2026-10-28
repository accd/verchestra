import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// why: #596 item 3 and release-custody T7 (docs/release-custody.md 3.3). The
// npm package pins the bootstrap trust root, so whoever publishes it chooses
// what every new install trusts. This workflow is the token-less path: trusted
// publishing bound to this file and the `npm-publication` environment, with a
// provenance attestation on every version it publishes.

const WORKFLOWS = new URL("../../.github/workflows/", import.meta.url);
const workflow = readFileSync(new URL("npm-publish.yml", WORKFLOWS), "utf8");
const lines = workflow.split(/\r?\n/u);

const DISPATCH_INPUTS = Object.freeze(["revision", "publication_run_id", "version", "dist_tag"]);

// A job is a two-space key under `jobs:`; its body runs to the next one.
const jobs = (() => {
  const start = lines.indexOf("jobs:");
  assert.ok(start >= 0, "the workflow declares jobs");
  const found = {};
  let current;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (header !== null) found[(current = header[1])] = [];
    else if (current !== undefined) found[current].push(line);
  }
  return Object.fromEntries(Object.entries(found).map(([id, body]) => [id, body.join("\n")]));
})();

// Every line the shell executes: the body of a `run:` block, which ends at the
// first non-empty line indented above it.
const runBlockLines = (text) => {
  const body = [];
  let indent = -1;
  for (const line of text.split("\n")) {
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

test("the npm publication workflow is manual and takes exactly its four inputs", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(
    workflow,
    /^ {2}(?:push|pull_request|pull_request_target|schedule|release|workflow_call|workflow_run):/mu
  );
  const declared = [...workflow.matchAll(/^ {6}([a-z_]+):\r?\n {8}description:/gmu)].map(([, name]) => name);
  assert.deepEqual(declared, DISPATCH_INPUTS);
  assert.match(workflow, /^concurrency:\r?\n {2}group: npm-publish\r?\n {2}cancel-in-progress: false$/mu);
});

test("only the publish job can mint an OIDC token, and only inside the npm-publication environment", () => {
  assert.match(workflow, /^permissions:\r?\n {2}actions: read\r?\n {2}contents: read\r?\n/mu);
  assert.deepEqual(Object.keys(jobs), ["verify", "publish"]);
  assert.doesNotMatch(jobs.verify, /id-token|environment:|: write$/mu);
  assert.match(jobs.publish, /^ {4}environment: npm-publication$/mu);
  assert.match(jobs.publish, /^ {4}needs: verify$/mu);
  assert.match(jobs.publish, /^ {4}permissions:\n {6}contents: read\n {6}id-token: write\n(?! {6})/mu);
  assert.deepEqual(
    [...workflow.matchAll(/^\s+([a-z-]+): write$/gmu)].map(([, scope]) => scope),
    ["id-token"]
  );
});

test("no workflow other than this one binds npm-publication or runs npm publish", () => {
  for (const name of readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/u.test(file))) {
    if (name === "npm-publish.yml") continue;
    const text = readFileSync(new URL(name, WORKFLOWS), "utf8");
    assert.doesNotMatch(text, /npm-publication/u, name);
    assert.doesNotMatch(text, /^\s+(?:run:\s+)?npm publish\b/mu, name);
  }
});

test("no npm token exists: no secret, no registry-url, no auth variable", () => {
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|registry-url/u);
});

test("the publish job runs no repository code and publishes only the verified tarball", () => {
  assert.doesNotMatch(jobs.publish, /actions\/checkout|pnpm|setup-pnpm/u);
  const commands = runBlockLines(jobs.publish).filter((line) => /\bnpm publish\b/u.test(line));
  assert.deepEqual(
    commands.map((line) => line.trim()),
    ['npm publish "dist/$TARBALL" --provenance --access public --tag "$DIST_TAG"']
  );
  const body = runBlockLines(jobs.publish).join("\n");
  const integrityCheck = body.indexOf('test "$actual" = "$INTEGRITY" || {');
  assert.ok(
    integrityCheck >= 0 && integrityCheck < body.indexOf("npm publish"),
    "the tarball's integrity is checked before it is published"
  );
  assert.match(jobs.publish, /TARBALL: \$\{\{ needs\.verify\.outputs\.tarball \}\}/u);
  assert.match(jobs.publish, /INTEGRITY: \$\{\{ needs\.verify\.outputs\.integrity \}\}/u);
});

test("the verify job rebuilds from the publication run, compares byte for byte, and activates live first", () => {
  const body = runBlockLines(jobs.verify).join("\n");
  const order = [
    "pnpm build:vestra-launcher -- --release-inputs publication/release-inputs --out vestra-launcher-package",
    "diff -r vestra-launcher-package publication-package",
    "node vestra-launcher-package/bin/verchestra.mjs --version",
    "npm pack ./vestra-launcher-package"
  ].map((command) => body.indexOf(command));
  assert.ok(
    order.every((index) => index >= 0),
    "each step is present"
  );
  assert.deepEqual(
    [...order].sort((left, right) => left - right),
    order,
    "build, compare, activate, then pack"
  );
  assert.match(
    jobs.verify,
    /name: t76-release-metadata-\$\{\{ inputs\.revision \}\}-\$\{\{ inputs\.publication_run_id \}\}/u
  );
  assert.match(
    jobs.verify,
    /name: t76-launcher-package-verification-\$\{\{ inputs\.revision \}\}-\$\{\{ inputs\.publication_run_id \}\}/u
  );
  assert.match(jobs.verify, /persist-credentials: false/u);
  assert.doesNotMatch(workflow, /^\s+cache:/mu);
});

test("dispatch inputs reach the shell only through env", () => {
  const injected = runBlockLines(workflow).filter((line) => /\$\{\{/u.test(line));
  assert.deepEqual(injected, []);
});
