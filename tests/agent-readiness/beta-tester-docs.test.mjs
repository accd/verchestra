// invariant: what an external beta tester reads first agrees with the code
// and with itself: the security limits of a task run, the probe host's stated
// containment limits (#569), and the setup, scope and reporting facts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveStateRoot } from "../../packages/platform-node/src/state-root.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const lower = (text) => text.toLowerCase().replaceAll(/\s+/gu, " ");

const NOT_A_SANDBOX = Object.freeze([
  "your own user privileges",
  "network access",
  "home directory",
  "not a sandbox",
  "disposable vm or container",
  "dedicated os user"
]);

test("quick-start and SECURITY state that a gate is not a sandbox", () => {
  for (const path of ["docs/quick-start.md", "SECURITY.md"]) {
    const text = lower(read(path));
    for (const phrase of NOT_A_SANDBOX) assert.ok(text.includes(phrase), `${path} does not say "${phrase}"`);
  }
  assert.doesNotMatch(lower(read("docs/quick-start.md")), /isolated task worktree/u);
});

const PROBE_HOST_LIMITS = Object.freeze([
  "a detached descendant can outlive its worker",
  "binds the entry file only",
  "consistency, not authenticity"
]);

function decision(id) {
  const state = read(".specs/STATE.md");
  const start = state.indexOf(`### ${id} `);
  assert.ok(start >= 0, `${id} is missing from .specs/STATE.md`);
  const end = state.indexOf("\n### ", start + 1);
  return state.slice(start, end < 0 ? undefined : end);
}

test("the probe-host documents state the three #569 limits", () => {
  const documents = {
    "AD-037": decision("AD-037"),
    "adr.md": read(".specs/features/out-of-process-probe-host/adr.md"),
    "threat-model.md": read(".specs/features/out-of-process-probe-host/threat-model.md")
  };
  let checked = 0;
  for (const [name, text] of Object.entries(documents)) {
    for (const limit of PROBE_HOST_LIMITS) {
      assert.ok(lower(text).includes(limit), `${name} does not state "${limit}"`);
      checked += 1;
    }
    assert.ok(text.includes("#569"), `${name} does not cite #569`);
  }
  assert.equal(checked, 9);
  assert.doesNotMatch(lower(documents["adr.md"]), /cannot outlive its probe/u);
});

const ledger = JSON.parse(read("docs/qualification/tuf-publication-ledger.json"));
const releases = ledger.entries.filter((entry) => entry.kind === "release");
const latest = releases.at(-1).semanticVersion;

function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, `no "## ${heading}" section`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

test("the README Beta testers section scopes every command family", () => {
  const beta = section(read("README.md"), "Beta testers");
  assert.ok(beta.includes(`npx verchestra@${latest}`), `the section does not pin ${latest}`);
  for (const [family, label] of [
    ["init", "beta"],
    ["self-test", "beta"],
    ["doctor", "beta"],
    ["secret", "beta"],
    ["task", "experimental"]
  ])
    assert.match(
      beta,
      new RegExp(`\\|\\s*\`${family}\`\\s*\\|\\s*${label}\\s*\\|`, "u"),
      `${family} is not labelled ${label}`
    );
  assert.match(beta, /SUPPORT\.md#what-to-attach/u, "the section does not say what to attach");
  assert.match(beta, /SECURITY\.md#[a-z-]*sandbox/u, "the section does not link the not-a-sandbox statement");
});

const PINNED_DOCUMENTS = Object.freeze([
  "README.md",
  "docs/quick-start.md",
  "apps/vestra-launcher/README.md",
  "apps/site/src/content/docs/docs/install-and-run.md"
]);

test("every pinned npx command names the latest ledger version", () => {
  let pins = 0;
  for (const path of PINNED_DOCUMENTS) {
    // why: a placeholder such as `verchestra@<earlier version>` names no build;
    // only a concrete version is a pin.
    for (const match of read(path).matchAll(/npx (?:--yes )?verchestra@(\d\S*?)(?=[\s`"'),]|$)/gmu)) {
      pins += 1;
      assert.equal(match[1], latest, `${path} pins ${match[1]}`);
    }
  }
  assert.ok(pins >= 2, `only ${pins} pinned commands were found`);
});

test("the quick-start gives the state directory for every supported OS", () => {
  const text = read("docs/quick-start.md");
  const darwin = resolveStateRoot({ platform: "darwin", homeDirectory: "/Users/u", env: {} });
  const linux = resolveStateRoot({ platform: "linux", homeDirectory: "/home/u", env: {} });
  const xdg = resolveStateRoot({ platform: "linux", homeDirectory: "/home/u", env: { XDG_STATE_HOME: "/xdg" } });
  const windows = resolveStateRoot({
    platform: "win32",
    homeDirectory: "C:\\Users\\u",
    env: { LOCALAPPDATA: "C:\\L" }
  });
  const expected = [
    darwin.replace("/Users/u", "~"),
    linux.replace("/home/u", "~"),
    xdg.replace("/xdg", "$XDG_STATE_HOME"),
    windows.replace("C:\\L", "%LOCALAPPDATA%")
  ];
  assert.deepEqual(expected, [
    "~/Library/Application Support/Verchestra/state",
    "~/.local/state/verchestra",
    "$XDG_STATE_HOME/verchestra",
    "%LOCALAPPDATA%\\Verchestra\\state"
  ]);
  for (const directory of expected)
    assert.ok(text.includes(`\`${directory}\``), `the quick-start does not give ${directory}`);
  assert.ok(text.includes("`.verchestra/workspace.yaml`"), "the quick-start does not say where the Workspace ID is");
});

test("every quick-start setup block has a PowerShell form", () => {
  const text = read("docs/quick-start.md");
  const setup = text.slice(text.indexOf("\n## 1. Install"), text.indexOf("\n## 5. "));
  const fences = [...setup.matchAll(/^```(\w+)$/gmu)]
    .map((match) => match[1])
    .filter((lang) => lang !== "text" && lang !== "json");
  assert.ok(fences.length >= 10, `only ${fences.length} setup blocks were found`);
  for (let index = 0; index < fences.length; index += 2) {
    assert.equal(fences[index], "bash", `setup block ${index} is ${fences[index]}`);
    assert.equal(fences[index + 1], "powershell", `bash setup block ${index} has no PowerShell form after it`);
  }
  assert.match(
    text,
    /claude\.exe[\s\S]{0,400}install\.ps1/u,
    "the quick-start does not say where claude.exe comes from"
  );
  assert.match(text, /codex\.exe[\s\S]{0,400}github\.com\/openai\/codex\/releases/u, "nor where codex.exe comes from");
});

test("the docs state the Node 24.14.0 floor for npx", () => {
  for (const path of ["README.md", "docs/quick-start.md"]) {
    const text = lower(read(path));
    assert.ok(text.includes("node 24.14.0 or later"), `${path} does not state the Node floor`);
    assert.doesNotMatch(text, /not a prerequisite/u, path);
    assert.doesNotMatch(text, /node\*\* only as far as/u, path);
  }
});

test("the quick-start says doctor is not a setup check", () => {
  const text = lower(read("docs/quick-start.md"));
  assert.ok(text.includes("`vestra doctor` is not a setup check"));
  assert.match(text, /`blocked` is its expected verdict/u);
});

test("the tester bug form requires exactly the five fields", () => {
  const form = read(".github/ISSUE_TEMPLATE/tester_bug_report.yml");
  const ids = [...form.matchAll(/^\s+id: ([a-z-]+)$/gmu)].map((match) => match[1]);
  const required = [...form.matchAll(/required: true/gu)].length;
  assert.deepEqual(ids, ["version", "platform", "node", "command", "envelope"]);
  assert.equal(required, 5);
  assert.match(form, /^labels: \["bug"\]$/mu);
  assert.doesNotMatch(form, /status:/u);
  assert.match(form, /vestra --version --output json/u);
});

test("SUPPORT lists what to attach", () => {
  const attach = section(read("SUPPORT.md"), "What to attach");
  for (const command of [
    "vestra --version --output json",
    "--output json",
    "vestra task status --output json",
    "vestra doctor --output json"
  ])
    assert.ok(attach.includes(command), `SUPPORT.md does not ask for ${command}`);
});

test("the CHANGELOG has a section per published sequence", () => {
  const changelog = read("CHANGELOG.md");
  // why: every later publication adds its own sequence, so the CHANGELOG
  // grows with the ledger instead of stopping at the first release.
  assert.ok(releases.length >= 8, `the ledger records ${releases.length} releases`);
  for (const entry of releases) {
    const start = changelog.indexOf(`## [${entry.semanticVersion}]`);
    assert.ok(start >= 0, `no CHANGELOG section for ${entry.semanticVersion}`);
    const end = changelog.indexOf("\n## ", start + 1);
    const body = changelog.slice(start, end < 0 ? undefined : end);
    if (entry.releaseId !== null)
      assert.ok(body.includes(entry.releaseId), `${entry.semanticVersion} names no releaseId`);
  }
});
