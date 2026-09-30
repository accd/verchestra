import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// why: the credential-store workflow is the only place the real-store
// qualification suite (`pnpm qualify:keychain`, #379) runs on Linux, Windows,
// and macOS. Its shape is asserted like the other qualification workflows:
// read-only, SHA-pinned to actions the repository already reviewed, bound to
// exactly the three platforms, nothing skipped, and no secret in reach.

const workflowsRoot = new URL("../../.github/workflows/", import.meta.url);
const workflow = readFileSync(new URL("os-credential-store.yml", workflowsRoot), "utf8");

const LEGS = Object.freeze([
  ["Linux", "ubuntu-latest", "linux"],
  ["Windows", "windows-latest", "win32"],
  ["macOS", "macos-latest", "darwin"]
]);

test("it runs on demand and on pull requests that touch the credential stores, never on push", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:\r?\n {2}pull_request:\r?\n {4}paths:\r?\n/mu);
  assert.doesNotMatch(workflow, /^ {2}(push|schedule|workflow_run|pull_request_target):/mu);
  const paths = [...workflow.matchAll(/^ {6}- "([^"]+)"$/gmu)].map((match) => match[1]);
  for (const required of [
    ".github/workflows/os-credential-store.yml",
    "apps/vestra-cli/src/secret-composition.ts",
    "docs/qualification/os-secret-backend-*.md",
    "packages/platform-node/src/os-secret-backends/**",
    "packages/platform-node/src/secret-broker.ts",
    "spikes/os-secret-store/**"
  ])
    assert.ok(paths.includes(required), required);
});

test("it holds read-only repository access and reaches no secret or identity", () => {
  assert.match(workflow, /^permissions:\r?\n {2}contents: read\r?\n\r?\n/mu);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gmu)].length, 1, "no job widens the workflow grant");
  assert.doesNotMatch(workflow, /:\s*write\b/u);
  assert.doesNotMatch(workflow, /id-token/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.match(workflow, /persist-credentials: false/u);
});

test("the matrix is exactly Linux, Windows, and macOS, and one failing store never cancels the others", () => {
  for (const [label, os, platform] of LEGS)
    assert.match(
      workflow,
      new RegExp(`- label: ${label}\\s*\\n\\s*os: ${os}\\s*\\n\\s*platform: ${platform}\\b`, "u"),
      `${label} must map to ${os} (${platform})`
    );
  assert.equal([...workflow.matchAll(/^\s*- label: /gmu)].length, LEGS.length);
  assert.match(workflow, /fail-fast: false/u);
  assert.match(workflow, /process\.platform !== process\.env\.MATRIX_PLATFORM/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test("Linux installs the Secret Service tools, and every leg runs the qualification suite unconditionally", () => {
  assert.match(
    workflow,
    /- name: Install the Secret Service tools\r?\n\s*if: matrix\.platform == 'linux'\r?\n\s*run: \|\r?\n(?:\s+.*\r?\n)*?\s+sudo apt-get install --yes --no-install-recommends libsecret-tools gnome-keyring dbus-x11\r?\n/u
  );
  assert.match(workflow, /- name: Qualify the platform credential store\r?\n\s*run: pnpm qualify:keychain\s*$/u);
  assert.equal([...workflow.matchAll(/run: pnpm qualify:keychain/gu)].length, 1);
  assert.match(workflow, /node-version: 24\.14\.0/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
});

test("every action is pinned to a full commit SHA the repository already uses elsewhere", () => {
  const pins = (text) => [...text.matchAll(/^\s*(?:- )?uses: (\S+)/gmu)].map((match) => match[1]);
  const own = pins(workflow);
  assert.ok(own.length >= 3);
  const elsewhere = new Set(
    readdirSync(workflowsRoot)
      .filter((name) => name.endsWith(".yml") && name !== "os-credential-store.yml")
      .flatMap((name) => pins(readFileSync(new URL(name, workflowsRoot), "utf8")))
  );
  for (const action of own) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, action);
    assert.ok(elsewhere.has(action), `${action} is not a pin already reviewed in another workflow`);
  }
});

test("no expression is interpolated into a shell block", () => {
  const lines = workflow.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (!/^\s*run: /u.test(line)) return;
    const indent = line.search(/\S/u) + 2;
    const body = [line.replace(/^\s*run: /u, "")];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() !== "" && lines[cursor].search(/\S/u) < indent) break;
      body.push(lines[cursor]);
    }
    assert.doesNotMatch(body.join("\n"), /\$\{\{/u, `run block at line ${index + 1} interpolates an expression`);
  });
});

test("the suite the workflow runs is the standalone real-store suite, which no gate runs", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts["qualify:keychain"], "node --test spikes/os-secret-store/test/*.test.mjs");
});
