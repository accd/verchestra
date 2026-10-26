// invariant: ARQ-006 (#597). No production entry point of a package exports a
// test double. A double lives in its package's src/testing.ts; tests import it
// from there, and the one production module that runs against a double, the
// self-test's full scenario, names that module through the package's
// "./testing" export. Every other entry, the index and each subpath, is
// walked through its re-exports, `export *` included.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOUBLE = /^(?:Mock|Fake|Stub|Spy|Dummy)[A-Z]/u;
const TESTING_IMPORTERS = Object.freeze({
  "apps/vestra-cli/src/self-test-full-scenario.ts": ["@verchestra/effects/testing"]
});
const AUDITED_DOUBLES = Object.freeze({
  "packages/effects/src/testing.ts": "MockEffectAdapter",
  "packages/extension-host/src/testing.ts": "MockProbeWorker",
  "packages/platform-node/src/testing.ts": "MockSecretAdapter"
});

// why: the names a module exports, following `export * from` into the module
// it names, so a double cannot reach an entry point one re-export away.
export function exportedNames(file, read = (path) => readFileSync(path, "utf8"), seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  const code = read(file);
  const names = [];
  for (const match of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gu))
    for (const entry of match[1].split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+as\s+/u)
        .at(-1);
      if (name) names.push(name);
    }
  for (const match of code.matchAll(
    /export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu
  ))
    names.push(match[1]);
  for (const match of code.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/gu)) names.push(match[1]);
  for (const match of code.matchAll(/export\s+\*\s+from\s+["'](\.[^"']+)["']/gu))
    names.push(...exportedNames(resolve(dirname(file), match[1]), read, seen));
  return names;
}

function entryPoints() {
  const entries = [];
  for (const parent of ["packages", "apps"])
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      const directory = join(ROOT, parent, entry.name);
      const manifestPath = join(directory, "package.json");
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const exports = typeof manifest.exports === "string" ? { ".": manifest.exports } : (manifest.exports ?? {});
      const targets = Object.entries(exports)
        .filter(([subpath, target]) => subpath !== "./testing" && typeof target === "string")
        .map(([, target]) => resolve(directory, target));
      const index = resolve(directory, "src/index.ts");
      if (existsSync(index) && !targets.includes(index)) targets.push(index);
      entries.push(...targets.filter((target) => existsSync(target)));
    }
  return entries;
}

function productionSources(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionSources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

const repositoryPath = (file) => relative(ROOT, file).replaceAll("\\", "/");

test("the export walker follows re-exports and declarations", () => {
  const files = {
    "/p/index.ts": 'export { A, type B, C as D } from "./a.ts";\nexport * from "./star.ts";\nexport class E {}',
    "/p/star.ts": 'export interface F {}\nexport * from "./deeper.ts";\nexport const G = 1;',
    "/p/deeper.ts": "export class MockThing {}\nexport async function h() {}"
  };
  const read = (path) => files[path.replaceAll("\\", "/").replace(/^[A-Za-z]:/u, "")];
  const names = exportedNames(resolve("/p/index.ts"), read);
  assert.deepEqual(names.sort(), ["A", "B", "D", "E", "F", "G", "MockThing", "h"].sort());
  assert.equal(names.filter((name) => DOUBLE.test(name)).length, 1);
  assert.equal(DOUBLE.test("DeterministicMockDriver"), false);
});

test("no production entry point exports a test double", () => {
  const entries = entryPoints();
  assert.ok(entries.length > 20, `only ${entries.length} entry points were read`);
  const exposed = [];
  for (const entry of entries)
    for (const name of exportedNames(entry)) if (DOUBLE.test(name)) exposed.push(`${repositoryPath(entry)}: ${name}`);
  assert.deepEqual(exposed, []);
  for (const [path, name] of Object.entries(AUDITED_DOUBLES))
    assert.ok(exportedNames(join(ROOT, path)).includes(name), `${path} should export ${name}`);
});

test("only the self-test composition reaches a test double from production source", () => {
  const importers = {};
  for (const parent of ["packages", "apps"])
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      const source = join(ROOT, parent, entry.name, "src");
      if (!entry.isDirectory() || !existsSync(source)) continue;
      for (const file of productionSources(source)) {
        if (repositoryPath(file).endsWith("/testing.ts")) continue;
        const code = readFileSync(file, "utf8");
        const specifiers = [...code.matchAll(/from\s+["']([^"']+)["']/gu)]
          .map((match) => match[1])
          .filter((specifier) => /(?:^@verchestra\/[^/]+\/testing|\/testing\.ts)$/u.test(specifier));
        if (specifiers.length > 0) importers[repositoryPath(file)] = specifiers;
      }
    }
  assert.deepEqual(importers, TESTING_IMPORTERS);
});
