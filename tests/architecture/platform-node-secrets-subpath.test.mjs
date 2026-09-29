// invariant: #379 D3 — @verchestra/platform-node/secrets is the credential
// entry point a composition root imports. The package root re-exports
// runtime-store, which loads node:sqlite and prints an experimental warning on
// stderr (tests/e2e/cli-launchers-e2e.test.mjs compares stderr byte for byte),
// so this subpath's whole static and dynamic import closure must never reach
// node:sqlite or the runtime store, and the CLI must reach the credential
// store only through it.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../", import.meta.url);

function importSpecifiers(code) {
  const staticSpecifiers = [...code.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  const dynamicSpecifiers = [...code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]);
  const bare = [...code.matchAll(/^import\s+["']([^"']+)["'];?$/gmu)].map((match) => match[1]);
  return [...staticSpecifiers, ...dynamicSpecifiers, ...bare];
}

function resolveSpecifier(specifier, fromFilePath) {
  if (specifier.startsWith(".")) return resolve(dirname(fromFilePath), specifier);
  if (specifier.startsWith("@verchestra/")) {
    const [, packageName, ...subpathParts] = specifier.split("/");
    const subpath = subpathParts.length === 0 ? "." : `./${subpathParts.join("/")}`;
    const manifest = JSON.parse(readFileSync(new URL(`packages/${packageName}/package.json`, repoRoot), "utf8"));
    const target = manifest.exports?.[subpath];
    assert.ok(target, `${specifier} has no declared export`);
    return fileURLToPath(new URL(`packages/${packageName}/${target.replace(/^\.\//u, "")}`, repoRoot));
  }
  return null;
}

function closure(entry) {
  const visited = new Set([entry]);
  const edges = [];
  const queue = [entry];
  while (queue.length > 0) {
    const filePath = queue.shift();
    for (const specifier of importSpecifiers(readFileSync(filePath, "utf8"))) {
      edges.push({ from: filePath, specifier });
      const resolved = resolveSpecifier(specifier, filePath);
      if (resolved !== null && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { visited, edges };
}

const secretsEntry = fileURLToPath(new URL("packages/platform-node/src/secrets.ts", repoRoot));
const compositionEntry = fileURLToPath(new URL("apps/vestra-cli/src/secret-composition.ts", repoRoot));

function assertNoSqlite(entry) {
  const { visited, edges } = closure(entry);
  assert.ok(visited.size > 3, `expected a real multi-file closure, resolved ${visited.size}`);
  for (const { from, specifier } of edges) {
    assert.notEqual(specifier, "node:sqlite", `${from} imports node:sqlite`);
    assert.notEqual(specifier, "@verchestra/platform-node", `${from} imports the platform-node root`);
  }
  for (const file of visited) assert.doesNotMatch(file, /runtime-store/u, `${file} is in the closure`);
}

test("the package declares the ./secrets export subpath", () => {
  const manifest = JSON.parse(readFileSync(new URL("packages/platform-node/package.json", repoRoot), "utf8"));
  assert.equal(manifest.exports["./secrets"], "./src/secrets.ts");
});

test("the secrets subpath names every export explicitly", () => {
  assert.doesNotMatch(readFileSync(secretsEntry, "utf8"), /export\s*\*/u);
});

test("the secrets subpath's import closure never reaches node:sqlite or the runtime store", () => {
  assertNoSqlite(secretsEntry);
});

test("the CLI credential composition's import closure never reaches node:sqlite", () => {
  assertNoSqlite(compositionEntry);
  const imports = importSpecifiers(readFileSync(compositionEntry, "utf8"));
  assert.ok(imports.includes("@verchestra/platform-node/secrets"));
});

test("main.ts loads the credential composition lazily and never the platform-node root", () => {
  const main = readFileSync(new URL("apps/vestra-cli/src/main.ts", repoRoot), "utf8");
  const staticImports = [...main.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.equal(staticImports.includes("./secret-composition.ts"), false, "must be a dynamic import");
  assert.equal(
    staticImports.some((specifier) => specifier.startsWith("@verchestra/platform-node")),
    false
  );
  assert.match(main, /await import\("\.\/secret-composition\.ts"\)/u);
});

test("the doctor composition root does not gain the credential store", () => {
  const doctor = readFileSync(new URL("apps/vestra-cli/src/doctor-composition.ts", repoRoot), "utf8");
  for (const forbidden of ["@verchestra/platform-node/secrets", "secret-composition", "createOsCredentialStore"])
    assert.equal(doctor.includes(forbidden), false, forbidden);
});
