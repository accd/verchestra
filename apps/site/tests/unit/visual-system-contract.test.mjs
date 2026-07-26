import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const siteRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(siteRoot, "../..");

test("keeps Impeccable outside the tracked repository and dependency graph", async () => {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })
    .split(/\r?\n/u)
    .filter(Boolean);
  const forbidden = tracked.filter(
    (path) =>
      /(^|\/)\.impeccable\//u.test(path) ||
      /(^|\/)\.agents\/skills\/impeccable\//u.test(path) ||
      /(^|\/)\.codex\/hooks\.json$/u.test(path) ||
      /(^|\/)(PRODUCT|DESIGN)\.md$/u.test(path)
  );
  const manifests = await Promise.all([
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(siteRoot, "package.json"), "utf8")
  ]);

  assert.deepEqual(forbidden, []);
  for (const manifest of manifests) {
    const packageJson = JSON.parse(manifest);
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {})
    ];
    assert.equal(dependencyNames.includes("impeccable"), false);
  }
});

test("preserves the incumbent Verchestra identity and accessibility floor", async () => {
  const stylesheet = await readFile(resolve(siteRoot, "src/styles/global.css"), "utf8");

  for (const contract of [
    '"Manrope Variable"',
    '"JetBrains Mono Variable"',
    "--violet: #8a7cff",
    "--cyan: #45d6d0",
    "--amber: #f5b75b",
    ".product-shell a:focus-visible",
    "--focus-ring: 3px solid var(--cyan)",
    "outline: var(--focus-ring)",
    "@media (prefers-reduced-motion: reduce)"
  ]) {
    assert.match(stylesheet, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("publishes a semantic visual token system for product and reading surfaces", async () => {
  const stylesheet = await readFile(resolve(siteRoot, "src/styles/global.css"), "utf8");

  for (const token of [
    "--font-sans:",
    "--font-mono:",
    "--content-wide:",
    "--content-reading:",
    "--space-1:",
    "--space-24:",
    "--radius-control:",
    "--radius-panel:",
    "--shadow-raised:",
    "--duration-fast:",
    "--ease-standard:",
    "--focus-ring:"
  ]) {
    assert.match(stylesheet, new RegExp(token, "u"));
  }
  assert.match(stylesheet, /font-display:\s*swap/u);
});
