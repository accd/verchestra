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
  assert.match(workflow, /@anthropic-ai\/claude-code@2\.1\.282 @openai\/codex@0\.115\.0/u);
  assert.doesNotMatch(workflow, /npm install --global --ignore-scripts/u);
  assert.match(workflow, /case "\$claude_version" in "2\.1\.282"\|"2\.1\.282 "\*/u);
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
  // gate-selection evidence, to 11 when the site job began caching the
  // qualified browsers, and to 12 when the site job began retaining the
  // Lighthouse report set (issue #110 / PR #139 review point 3).
  assert.equal(actionUses.length, 12);
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

test("an unresolvable Playwright version refuses to cache instead of sharing one key", () => {
  // node --print exits 0 while printing "undefined" if the dependency moves out
  // of devDependencies, and 0 while printing "^1.62.0" if the pin loosens. Either
  // would key every future run identically and restore browsers built for a
  // different version, which is the one thing this cache must never do.
  assert.match(workflow, /if ! \[\[ "\$version" =~ \^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]; then/u);
  assert.match(workflow, /refusing to cache browsers under an ambiguous key/u);
});

test("the site job budget exceeds the bounds of the steps it contains", () => {
  // Three 5-minute apt attempts, the two 15-minute lock waits before the
  // retries, and an 8-minute browser install come to about 53 minutes before
  // the qualification run starts. A budget that does not clear that composes
  // back into a cancelled job reporting a test failure.
  const site = /\n {2}site:\n([\s\S]*?)\n {2}deploy:/u.exec(workflow);
  assert.ok(site, "the site job must be present");
  const jobBudget = Number(/timeout-minutes: (\d+)/u.exec(site[1])[1]);
  const aptAttempts = Number(/for attempt in ((?:\d+ ?)+)/u.exec(site[1])[1].trim().split(/\s+/u).length);
  const aptSeconds = Number(/timeout (\d+) pnpm/u.exec(site[1])[1]);
  const lockSeconds = Number(/while \[ "\$waited" -lt (\d+) \]/u.exec(site[1])[1]);
  const stepBudgets = [...site[1].matchAll(/^ {8}timeout-minutes: (\d+)$/gmu)].map((entry) => Number(entry[1]));
  const bounded =
    (aptAttempts * aptSeconds + (aptAttempts - 1) * lockSeconds) / 60 +
    stepBudgets.reduce((total, value) => total + value, 0);
  assert.ok(
    jobBudget > bounded + 10,
    `the job budget of ${jobBudget}m must leave over 10m beyond the ${bounded}m its bounded steps may consume`
  );
});

// invariant: a timed-out attempt leaves the apt-get it started through sudo
// running and holding the dpkg lock, so a retry first waits, for a bounded
// time, until no apt-get or dpkg is left, and only between attempts. That
// apt-get is still installing the same packages, so the wait gives it at least
// as long again as the attempt that started it, and says how long it waited.
test("a browser dependency retry waits for the apt-get the last attempt left behind", () => {
  const step = /- name: Install browser system dependencies\n {8}run: \|\n([\s\S]*?)\n {6}- name:/u.exec(workflow);
  assert.ok(step, "the browser dependency step must be present");
  const body = step[1];
  const attemptFails = body.indexOf('failed on attempt ${attempt} of 3."');
  const lastAttempt = body.indexOf('[ "$attempt" -lt 3 ] || break');
  const lockWait =
    /while \[ "\$waited" -lt (\d+) \] && \{ pgrep -x apt-get >\/dev\/null \|\| pgrep -x dpkg >\/dev\/null; \}; do/u.exec(
      body
    );
  assert.ok(lockWait, "the wait checks for apt-get and dpkg");
  const wait = lockWait.index;
  const reported = body.indexOf('echo "Waited ${waited}s for the apt-get and dpkg the last attempt left behind."');
  const loopEnd = body.lastIndexOf("done");
  assert.ok(attemptFails > 0, "a failed attempt is named");
  assert.ok(lastAttempt > attemptFails, "no wait follows the last attempt");
  assert.ok(wait > lastAttempt && wait < loopEnd, "the wait runs between attempts, inside the retry loop");
  assert.ok(reported > wait && reported < loopEnd, "each wait reports how long it ran");
  const attemptSeconds = Number(/timeout (\d+) pnpm/u.exec(body)[1]);
  assert.ok(
    Number(lockWait[1]) >= attemptSeconds,
    `a ${lockWait[1]}s wait is shorter than the ${attemptSeconds}s attempt whose apt-get it waits for`
  );
  assert.match(body, /sleep 5\n\s+waited=\$\(\(waited \+ 5\)\)/u, "the wait advances its bound");
  assert.match(
    body,
    /This is a runner environment failure, not a site qualification failure: no test has run yet\."\n\s+exit 1/u
  );
});
