import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkRepository } from "../../scripts/agent-readiness.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-check-"));
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
  await writeFile(join(root, "docs", "architecture.md"), "# Architecture\n");
  await writeFile(join(root, "docs", "repository-map.md"), "# Map\n");
  await writeFile(join(root, "docs", "qualification", "t68-validation.md"), "# T68\n");
  await writeFile(join(root, "ROADMAP.md"), "# T68 complete; T69 next\n");
  await writeFile(join(root, ".specs", "STATE.md"), "# T68 complete; T69 next\n");
  return root;
}

test("readiness rejects divergent compatibility pointers", async () => {
  const root = await fixture();
  await writeFile(join(root, "CLAUDE.md"), "# extra rules\n");
  assert.ok((await checkRepository(root)).includes("CLAUDE.md does not match generated pointer"));
});

test("readiness rejects stale qualification and machine-local context", async () => {
  const root = await fixture();
  await writeFile(join(root, "package.json"), '{"version":"1.0.0","scripts":{"gate:quick":"x"}}\n');
  await writeFile(join(root, "docs", "repository-map.md"), "C:\\Users\\example\\secret\n");
  const errors = await checkRepository(root);
  assert.ok(errors.includes("stale version: 1.0.0"));
  assert.ok(errors.includes("docs/repository-map.md: contains a secret-like value or machine-local path"));
});
