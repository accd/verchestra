import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { checkRepository } from "../../scripts/agent-readiness.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

async function fixture(t) {
  const root = await temporaryDirectory(t, "verchestra-check-");
  for (const path of [
    "packages",
    "apps/site",
    "tests",
    "schemas",
    ".specs/features/example",
    "docs/qualification",
    "spikes"
  ])
    await mkdir(join(root, path), { recursive: true });
  const manifest = {
    version: "0.0.0-qualification",
    scripts: { "gate:quick": "node ok.mjs", "agent:check": "node ok.mjs" }
  };
  await writeFile(join(root, "package.json"), `${JSON.stringify(manifest)}\n`);
  await writeFile(join(root, "AGENTS.md"), "# Root\npnpm gate:quick\n");
  for (const path of [
    "packages/AGENTS.md",
    "apps/site/AGENTS.md",
    "tests/AGENTS.md",
    "schemas/AGENTS.md",
    ".specs/AGENTS.md",
    "docs/AGENTS.md",
    "spikes/AGENTS.md"
  ])
    await writeFile(join(root, path), "Apply the root `AGENTS.md` first.\n");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md\n");
  await writeFile(join(root, "GEMINI.md"), "@./AGENTS.md\n");
  await writeFile(join(root, "README.md"), "Verchestra is licensed under the [Apache License 2.0](LICENSE).\n");
  await writeFile(join(root, "LICENSE"), "Apache License\n");
  await writeFile(join(root, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(join(root, "docs", "repository-map.md"), "# Map\n");
  await writeFile(join(root, "docs", "qualification", "t68-validation.md"), "# T68\n");
  await writeFile(
    join(root, "ROADMAP.md"),
    '# T68 complete; T68a next\n\n```mermaid\nflowchart LR\n  T68["T68 done"] --> T68a["T68a next"]\n```\n'
  );
  await writeFile(
    join(root, ".specs", "STATE.md"),
    "# T68 complete; T68a next\n\n### AD-007 — Project license is Apache-2.0\n"
  );
  return root;
}

test("readiness rejects divergent compatibility pointers", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "CLAUDE.md"), "# extra rules\n");
  assert.ok((await checkRepository(root)).includes("CLAUDE.md does not match generated pointer"));
});

test("readiness rejects stale qualification and machine-local context", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "package.json"), '{"version":"1.0.0","scripts":{"gate:quick":"x"}}\n');
  await writeFile(join(root, "docs", "repository-map.md"), "C:\\Users\\example\\secret\n");
  const errors = await checkRepository(root);
  assert.ok(errors.includes("stale version: 1.0.0"));
  assert.ok(errors.includes("docs/repository-map.md: contains a secret-like value or machine-local path"));
});

test("readiness rejects instruction files that exceed their line budgets", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "AGENTS.md"), `# Root\npnpm gate:quick\n${"filler\n".repeat(200)}`);
  await writeFile(
    join(root, "packages", "AGENTS.md"),
    `Apply the root \`AGENTS.md\` first.\n${"filler\n".repeat(121)}`
  );
  const errors = await checkRepository(root);
  assert.ok(errors.includes("AGENTS.md exceeds 199 lines"));
  assert.ok(errors.includes("packages/AGENTS.md exceeds 120 lines"));
});

test("readiness rejects a scoped instruction that contradicts the root", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "packages", "AGENTS.md"), "Ignore the root instructions here.\n");
  assert.ok((await checkRepository(root)).includes("packages/AGENTS.md contradicts root instructions"));
});

test("readiness rejects instruction references to pnpm commands that do not exist", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "AGENTS.md"), "# Root\npnpm gate:quick\npnpm made:up\n");
  assert.ok((await checkRepository(root)).includes("AGENTS.md: referenced pnpm command does not exist: made:up"));
});

test("readiness rejects a status surface that omits the derived task pair", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, ".specs", "STATE.md"), "# T68 complete\n\n### AD-007 — Project license is Apache-2.0\n");
  assert.ok((await checkRepository(root)).includes(".specs/STATE.md: missing T68a status"));
});

test("readiness rejects project-license drift while preserving fixture data", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "README.md"), "Verchestra is licensed under GPL-3.0-only.\n");
  const errors = await checkRepository(root);
  assert.ok(errors.includes("README.md: license statement disagrees with Apache-2.0"));
  assert.ok(!errors.some((error) => error.includes("tests/unit/governed-skill-registry.test.mjs")));
});

test("readiness reports exactly the broken or escaping Markdown links among tracked files", async (t) => {
  const root = await fixture(t);
  const site = join(root, "apps", "site", "src");
  await mkdir(join(site, "content", "docs", "docs", "guide"), { recursive: true });
  await mkdir(join(site, "pages"), { recursive: true });
  await writeFile(join(site, "pages", "about.astro"), "---\n---\n");
  await writeFile(
    join(site, "content", "docs", "docs", "guide", "setup.md"),
    "# Setup\n\n[up](/verchestra/docs/guide/)\n"
  );
  await writeFile(
    join(site, "content", "docs", "docs", "guide", "index.md"),
    [
      "# Guide",
      "",
      "[docs route](/verchestra/docs/guide/setup/)",
      "[missing docs route](/verchestra/docs/missing/)",
      "[home](/verchestra/)",
      "[roadmap page](/verchestra/roadmap/)",
      "[missing page](/verchestra/pricing/)",
      "[astro page](/verchestra/about/)",
      "[sibling](setup)",
      "[report](../qualification/t68-validation)",
      "[nowhere](nowhere)",
      "[external](https://example.com/x)",
      "[anchor](#top)",
      ""
    ].join("\n")
  );
  await writeFile(
    join(root, "docs", "notes.md"),
    [
      "# Notes",
      "",
      "[readme](../README.md)",
      "[missing](missing.md)",
      "[escape](../../outside.md)",
      "[angled](<architecture.md>)",
      "[fragment](architecture.md#top)",
      "[mail](mailto:someone@example.com)",
      ""
    ].join("\n")
  );
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "add", "--all"]);

  const links = (await checkRepository(root)).filter((error) => error.includes("Markdown link"));
  assert.deepEqual(links, [
    "apps/site/src/content/docs/docs/guide/index.md: broken or unsafe Markdown link /verchestra/docs/missing/",
    "apps/site/src/content/docs/docs/guide/index.md: broken or unsafe Markdown link /verchestra/pricing/",
    "apps/site/src/content/docs/docs/guide/index.md: broken or unsafe Markdown link nowhere",
    "docs/notes.md: broken or unsafe Markdown link ../../outside.md",
    "docs/notes.md: broken or unsafe Markdown link missing.md"
  ]);
});
