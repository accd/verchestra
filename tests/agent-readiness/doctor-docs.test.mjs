// X5 (.specs/features/doctor-scoped-verdict, S3): the pages a user reads tell
// them a healthy installation reports PASS, and name the six subsystems this
// release does not offer, so a not-offered check never reads as a setup step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const PAGES = ["README.md", "docs/quick-start.md", "apps/site/src/content/docs/docs/install-and-run.md"];
const NOT_OFFERED = [
  "connectors.available",
  "drivers.available",
  "policy.enforceable",
  "probes.available",
  "sandbox.enforced",
  "state.durable"
];

test("the docs say a healthy installation reports PASS and name what is not offered", () => {
  for (const path of PAGES) {
    const text = read(path);
    assert.match(
      text,
      /healthy installation[^.]*reports `PASS`/u,
      `${path} does not say a healthy installation reports PASS`
    );
    assert.match(text, /`not-offered`/u, `${path} does not name the not-offered status`);
    for (const capability of NOT_OFFERED)
      assert.ok(text.includes(`\`${capability}\``), `${path} does not name ${capability}`);
  }
});

test("the quick start no longer calls BLOCKED expected", () => {
  const guide = read("docs/quick-start.md").replaceAll(/\s+/gu, " ");
  assert.doesNotMatch(guide, /`BLOCKED` is its expected verdict/u);
  assert.doesNotMatch(guide, /set up only for `task`, `BLOCKED`/u);
});
