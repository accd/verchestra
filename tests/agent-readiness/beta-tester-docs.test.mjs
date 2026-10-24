// invariant: what an external beta tester reads first agrees with the code
// and with itself: the security limits of a task run, the probe host's stated
// containment limits (#569), and the setup, scope and reporting facts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
