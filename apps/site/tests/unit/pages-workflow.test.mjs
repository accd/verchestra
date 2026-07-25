import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("publishes only the exact site artifact that passed both required gates", () => {
  assert.match(workflow, /name: Quality gate/u);
  assert.match(workflow, /name: Site quality/u);
  assert.match(workflow, /run: pnpm gate:quick/u);
  assert.match(workflow, /run: pnpm site:test/u);
  assert.match(workflow, /path: apps\/site\/dist/u);
  assert.match(workflow, /needs: \[quality, site\]/u);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
});

test("pins every delivery action and isolates elevated Pages permissions", () => {
  const actionUses = [...workflow.matchAll(/uses: ([^\s#]+)/gu)].map((match) => match[1]);
  assert.equal(actionUses.length, 9);
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
