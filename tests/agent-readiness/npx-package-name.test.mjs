import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { systemGit } from "../helpers/system-git.mjs";

const repositoryRoot = new URL("../../", import.meta.url);

// why: `vestra` is only a binary inside the `verchestra` package, and the npm
// name `vestra` is not owned by this project. A user-facing `npx vestra …`
// outside an install fetches whatever package holds that name, so every
// runnable instruction must name the `verchestra` package.
test("user-facing instructions never run npx vestra, which would resolve an unowned npm name", () => {
  const tracked = execFileSync(systemGit(), ["ls-files", "README.md", "docs", "apps/site/src"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })
    .split("\n")
    .filter((path) => /\.(md|mdx|astro)$/u.test(path));
  assert.ok(tracked.length > 0);
  const offenders = [];
  for (const path of tracked) {
    const lines = readFileSync(new URL(path, repositoryRoot), "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = line.trimStart();
      const runnable = code.startsWith("npx vestra") || /`npx vestra [a-z-]/u.test(line);
      if (runnable) offenders.push(`${path}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
