import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("publishes only the exact site artifact that passed both required gates", () => {
  assert.match(workflow, /name: Quality gate/u);
  assert.match(workflow, /name: Site quality/u);
  // The quality job selects profiles from the changed surface, then executes
  // their stage union. The latter prevents overlapping profiles from rerunning
  // format, lint, typecheck, and test stages serially.
  assert.match(workflow, /node scripts\/select-gates\.mjs/u);
  assert.match(workflow, /if: contains\(steps\.selection\.outputs\.stages, 'test:qualification'\)/u);
  assert.match(workflow, /@anthropic-ai\/claude-code@2\.1\.168 @openai\/codex@0\.115\.0/u);
  assert.doesNotMatch(workflow, /npm install --global --ignore-scripts/u);
  assert.match(workflow, /case "\$claude_version" in "2\.1\.168"\|"2\.1\.168 "\*/u);
  assert.match(workflow, /case "\$codex_version" in "codex-cli 0\.115\.0"\|"codex-cli 0\.115\.0 "\*/u);
  assert.match(workflow, /for stage in \$\{\{ steps\.selection\.outputs\.stages \}\}/u);
  assert.match(workflow, /pnpm run "\$stage"/u);
  assert.match(workflow, /path: gate-selection\.json/u);
  assert.match(workflow, /run: pnpm site:test/u);
  assert.match(workflow, /path: apps\/site\/dist/u);
  assert.match(workflow, /needs: \[quality, site\]/u);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
});

test("pins every delivery action and isolates elevated Pages permissions", () => {
  const actionUses = [...workflow.matchAll(/uses: ([^\s#]+)/gu)].map((match) => match[1]);
  // The exact count is a tripwire: adding an action must be a reviewed decision,
  // never an unnoticed one. It rose to 10 when the quality job began retaining
  // gate-selection evidence, and to 11 when the site job began caching the
  // qualified browsers.
  assert.equal(actionUses.length, 11);
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@[a-f0-9]{40} # v\d+\.\d+\.\d+\n {8}with:\n.*\n.*gate-selection/su
  );
  for (const action of actionUses) {
    assert.match(action, /^[^@]+@[a-f0-9]{40}$/u);
  }
  assert.match(workflow, /deploy:[\s\S]*permissions:\n      pages: write\n      id-token: write/u);
  assert.doesNotMatch(workflow.split(/\n  deploy:/u)[0], /pages: write|id-token: write/u);
});

test("cancels stale deployments and binds the production environment", () => {
  assert.match(workflow, /group: pages-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /name: github-pages/u);
  assert.match(workflow, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/u);
});

test("caches the qualified browsers keyed on the resolved Playwright version", () => {
  // Caching must never shrink coverage: the install keeps all three qualified
  // browser projects, and a warm cache only skips the download. The key carries
  // the exact Playwright version because each version requires specific browser
  // revisions, so a stale cache entry is never restored.
  assert.match(workflow, /run: pnpm --filter @verchestra\/site exec playwright install chromium firefox webkit/u);
  assert.match(
    workflow,
    /node --print "require\('\.\/apps\/site\/package\.json'\)\.devDependencies\['@playwright\/test'\]"/u
  );
  assert.match(workflow, /uses: actions\/cache@[a-f0-9]{40} # v\d+\.\d+\.\d+/u);
  assert.match(workflow, /path: ~\/\.cache\/ms-playwright/u);
  assert.match(workflow, /key: \$\{\{ runner\.os \}\}-ms-playwright-\$\{\{ steps\.playwright\.outputs\.version \}\}/u);
});
