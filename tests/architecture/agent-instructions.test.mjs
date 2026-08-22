import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const scoped = [
  "packages/AGENTS.md",
  "apps/site/AGENTS.md",
  "tests/AGENTS.md",
  "schemas/AGENTS.md",
  ".specs/AGENTS.md",
  "docs/AGENTS.md",
  "spikes/AGENTS.md"
];

test("root instructions are concise and expose required repository rules", async () => {
  const source = await readFile(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.ok(source.split(/\r?\n/u).length < 200);
  for (const required of [
    "0.0.0-qualification",
    "T74 is complete and T75 is the next product task",
    "git status --short --branch",
    "corepack pnpm agent:context",
    "pnpm gate:quick",
    "prompt",
    "credentials",
    "uncommitted user work",
    "generated contracts",
    "Human review is mandatory"
  ]) {
    assert.match(source, new RegExp(required, "iu"), required);
  }
});

test("every required repository region has scoped refining instructions", async () => {
  for (const path of scoped) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.match(source, /Apply the root `AGENTS\.md` first\./u, path);
    assert.doesNotMatch(source, /\b(?:ignore|override|relax)\s+(?:the\s+)?root\b/iu, path);
  }
});

test("Claude and Gemini pointers contain no independent rules", async () => {
  assert.equal(await readFile(new URL("../../CLAUDE.md", import.meta.url), "utf8"), "@AGENTS.md\n");
  assert.equal(await readFile(new URL("../../GEMINI.md", import.meta.url), "utf8"), "@./AGENTS.md\n");
});

test("repository map covers the approved workspace packages", async () => {
  const map = await readFile(new URL("../../docs/repository-map.md", import.meta.url), "utf8");
  const { EXPECTED_PACKAGES } = await import("../../scripts/architecture.mjs");
  for (const path of [...EXPECTED_PACKAGES, "apps/site"]) assert.match(map, new RegExp(`\\x60${path}\\x60`, "u"), path);
});

// AGENTS.md declares repository and website content English-only. A translated
// README was merged once against that rule and reverted by owner decision, so
// the rule is now enforced rather than only stated: canonical root documents
// have exactly one language.
test("no translated root README exists", async () => {
  const entries = await readdir(new URL("../../", import.meta.url));
  const translated = entries.filter((entry) => /^README\..+\.md$/iu.test(entry));
  assert.deepEqual(translated, [], "translated READMEs are excluded by the English-only policy");
});
