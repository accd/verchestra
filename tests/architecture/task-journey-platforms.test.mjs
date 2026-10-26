// invariant: #599 (TST-002). The single-session task journeys run on macOS and
// Linux, and a platform that does not run one says so: each guard ends in a
// named skip or in the assertion that the task path reports not configured,
// never in a silent return that passes without asserting anything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const JOURNEY_FILES = Object.freeze(["tests/e2e/task-cli-e2e.test.mjs", "tests/security/task-cli-security.test.mjs"]);
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the task journeys run on macOS and Linux and never return early unannounced", () => {
  for (const path of JOURNEY_FILES) {
    const source = read(path);
    assert.match(source, /^const JOURNEYS = DARWIN \|\| LINUX;$/mu, `${path} does not run on Linux`);
    assert.match(
      source,
      /cliFixture\(\{ secretService: LINUX, \.\.\.options \}\)/u,
      `${path} gives Linux no Secret Service`
    );
    assert.doesNotMatch(source, /if \(!DARWIN\) return/u, `${path} still returns off macOS`);
    // why: `return;` and `return <anything>;` are both guards, so a bare return
    // is caught as a guard whose outcome is empty.
    const guards = [...source.matchAll(/if \(!JOURNEYS\) return\b ?([^;]*);/gu)].map((match) => match[1]);
    assert.ok(guards.length > 0, `${path} has no journey guard`);
    for (const outcome of guards)
      assert.match(
        outcome,
        /^(?:t\.skip\(WINDOWS_JOURNEY\)|notConfiguredWithoutJourneys\(t\))$/u,
        `${path}: ${outcome}`
      );
  }
});
