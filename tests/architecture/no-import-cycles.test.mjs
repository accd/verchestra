// invariant: ARQ-005 (#597). No production module reaches itself through its
// static imports. A cycle through a package index, where a module imports the
// barrel that re-exports it, leaves one side of the cycle evaluated before the
// other under a bundler, and a class or constant read in that window is in its
// temporal dead zone. Relative specifiers and @verchestra/* specifiers, mapped
// through each package's exports, are edges; a type-only import is not, since
// it is erased before any module runs, and a dynamic import() is not, since it
// loads only after its importer has finished evaluating.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STATEMENT = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gu;
const BARE = /(?:^|[\n;])\s*import\s*["']([^"']+)["']/gu;

// why: an `import { type A, type B }` names only types, so it is erased too.
function typeOnly(keyword, typeKeyword, clause) {
  if (typeKeyword !== undefined) return true;
  const named = /^\{([\s\S]*)\}$/u.exec(clause.trim());
  if (named === null) return false;
  const entries = named[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 && entries.every((entry) => entry.startsWith("type "));
}

export function runtimeSpecifiers(code) {
  const specifiers = [];
  for (const match of code.matchAll(STATEMENT)) if (!typeOnly(match[1], match[2], match[3])) specifiers.push(match[4]);
  for (const match of code.matchAll(BARE)) specifiers.push(match[1]);
  return specifiers;
}

function packageEntries() {
  const entries = new Map();
  for (const parent of ["packages", "apps"])
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      const manifestPath = join(ROOT, parent, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const exports = typeof manifest.exports === "string" ? { ".": manifest.exports } : (manifest.exports ?? {});
      for (const [subpath, target] of Object.entries(exports))
        if (typeof target === "string")
          entries.set(
            `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`,
            join(ROOT, parent, entry.name, target)
          );
    }
  return entries;
}

function sources(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(resolve(path));
  }
  return files;
}

function productionGraph() {
  const entries = packageEntries();
  const files = [];
  for (const parent of ["packages", "apps"])
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      const source = join(ROOT, parent, entry.name, "src");
      if (entry.isDirectory() && existsSync(source)) files.push(...sources(source));
    }
  const known = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const targets = new Set();
    for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      const target = specifier.startsWith(".") ? resolve(dirname(file), specifier) : entries.get(specifier);
      if (target !== undefined && known.has(resolve(target))) targets.add(resolve(target));
    }
    graph.set(file, targets);
  }
  return graph;
}

// why: Tarjan's strongly connected components; a component of two or more
// modules, or one module that imports itself, is a cycle.
export function cycles(graph) {
  let next = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const found = [];
  const visit = (node) => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (onStack.has(target)) low.set(node, Math.min(low.get(node), index.get(target)));
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) found.push(component.sort());
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return found;
}

test("the detector reads runtime edges and finds a cycle", () => {
  assert.deepEqual(runtimeSpecifiers('import { A } from "./a.ts";\nimport type { B } from "./b.ts";'), ["./a.ts"]);
  assert.deepEqual(runtimeSpecifiers('import { type B, type C } from "./b.ts";'), []);
  assert.deepEqual(runtimeSpecifiers('import { type B, C } from "./b.ts";'), ["./b.ts"]);
  assert.deepEqual(runtimeSpecifiers('export { A } from "./a.ts";\nexport * from "./c.ts";'), ["./a.ts", "./c.ts"]);
  assert.deepEqual(runtimeSpecifiers('export type { A } from "./a.ts";'), []);
  assert.deepEqual(runtimeSpecifiers('import "./side-effect.ts";'), ["./side-effect.ts"]);
  assert.deepEqual(runtimeSpecifiers('const later = await import("./lazy.ts");'), []);
  const graph = new Map([
    ["a", new Set(["b"])],
    ["b", new Set(["c"])],
    ["c", new Set(["a"])],
    ["d", new Set(["d"])],
    ["e", new Set(["a"])]
  ]);
  assert.deepEqual(cycles(graph), [["a", "b", "c"], ["d"]].sort());
});

test("no production module reaches itself through its static imports", () => {
  const graph = productionGraph();
  assert.ok(graph.size > 200, `only ${graph.size} production modules were read`);
  const edges = [...graph.values()].reduce((total, targets) => total + targets.size, 0);
  assert.ok(edges > graph.size, `only ${edges} import edges were resolved`);
  const found = cycles(graph).map((component) => component.map((file) => relative(ROOT, file).replaceAll("\\", "/")));
  assert.deepEqual(found, []);
});
