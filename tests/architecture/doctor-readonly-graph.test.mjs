import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// AC1 (T72, #13): "No mutable or paid adapter method is reachable from diagnostic
// execution." Deep doctor is composed in exactly one file. Before this guard the
// property held only by inspection - nothing proved it, so the audit read it as
// vacuously true. These assertions make it structural: the doctor graph may
// import only from a read-only allowlist, spawns only a read-only git probe, and
// touches no writing filesystem call. The narrow live adapters below are
// explicitly reviewed: runtime inspection opens SQLite defensively/read-only,
// the protected-path broker rejects traversal before an open, and PiDriver is
// limited to its manifest-only probe. Widening the graph is then a conscious,
// reviewed change to the allowlist, never an accident.

const source = readFileSync(new URL("../../apps/vestra-cli/src/doctor-composition.ts", import.meta.url), "utf8");

// Every module the deep-doctor composition root is allowed to reach. Each entry
// is read-only by contract: application owns pure rules, contracts is schema
// metadata, evidence seals the report, release-manifest resolves identity, domain
// names the workspace layout the doctor watches and takes no third-party or
// node: import itself (tests/architecture/repository-boundaries.test.mjs), the
// platform-node and policy readonly subpaths export only observation surfaces
// (tests/architecture/platform-node-readonly-subpath.test.mjs,
// tests/architecture/policy-readonly-subpath.test.mjs), and the node builtins
// are used only through their read-only calls (asserted below). Adding an
// entry here is the reviewed act of widening the graph.
const READ_ONLY_IMPORTS = Object.freeze(
  new Set([
    "node:child_process",
    "node:crypto",
    "node:fs",
    "node:path",
    "@verchestra/application",
    "@verchestra/contracts",
    "@verchestra/domain",
    "@verchestra/evidence",
    "@verchestra/platform-node/readonly",
    "@verchestra/policy/readonly",
    "./release-manifest.ts"
  ])
);

function importSpecifiers(code) {
  // Both static (`from "..."`) and dynamic (`import("...")`) edges count —
  // packages/platform-node/src/readonly.ts defers loading runtime-store.ts
  // via a dynamic import specifically to avoid an unrelated side effect on
  // every CLI invocation (T12), and that deferral must not also make the
  // edge invisible to this closure walker.
  const staticSpecifiers = [...code.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  const dynamicSpecifiers = [...code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]);
  return [...staticSpecifiers, ...dynamicSpecifiers];
}

test("deep doctor composes from a read-only allowlist only", () => {
  const specifiers = importSpecifiers(source);
  assert.ok(specifiers.length > 0, "the composition must import something to compose");
  for (const specifier of specifiers)
    assert.ok(
      READ_ONLY_IMPORTS.has(specifier),
      `doctor-composition imports ${specifier}, which is outside the read-only allowlist; ` +
        "widening the doctor graph must be a conscious change to READ_ONLY_IMPORTS with review"
    );
});

test("deep doctor reaches no writing filesystem call", () => {
  for (const forbidden of [
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "rmSync",
    "rmdirSync",
    "unlinkSync",
    "createWriteStream",
    "writeFile",
    "openSync"
  ])
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`, "u"), `doctor-composition must not call ${forbidden}`);
});

test("deep doctor spawns only a read-only git version probe", () => {
  const spawns = [...source.matchAll(/spawnSync\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/gu)];
  assert.equal(spawns.length, 1, "exactly one child process is expected, the git probe");
  assert.equal(spawns[0][1], "git", "the only spawned process is git");
  assert.match(spawns[0][2], /"--version"/u, "git is invoked read-only, for its version");
});

test("deep doctor names no command bus, provider, connector, or writer adapter", () => {
  // Symbol names, not English words, so the file's own prose ("opens a writer",
  // "calls a provider") cannot trip the guard.
  for (const forbidden of [
    "createCommandBus",
    "CommandBus",
    "@verchestra/connectors",
    "@verchestra/data-probe",
    "RuntimeStore",
    "isAuthorized"
  ])
    assert.doesNotMatch(source, new RegExp(forbidden, "u"), `doctor execution must not reach ${forbidden}`);
});

// DDL-12 / T11 (#207): the four tests above prove doctor-composition.ts's own
// text is read-only. They do not prove the modules it pulls in stay
// read-only too — a module reached two or three hops away could import a
// writer without ever appearing in doctor-composition.ts's own source. This
// resolves the full static import closure (relative paths and
// @verchestra/* package-exports-mapped paths, never executed) and asserts no
// edge anywhere in it — not only doctor-composition.ts's own — names a
// forbidden package root.
//
// This checks import EDGES (specifier strings), not raw file text, so a
// forbidden class name appearing in an unrelated comment somewhere in the
// closure cannot trip it — the exact false-positive class
// tests/architecture/platform-node-readonly-subpath.test.mjs and
// tests/architecture/policy-readonly-subpath.test.mjs hit while this feature
// was built. Each of those two subpath guards already proves its own file's
// export SURFACE is exact; this proves nothing in the wider closure reaches
// either package by any OTHER path.

const repoRoot = new URL("../../", import.meta.url);
const entryPath = fileURLToPath(new URL("../../apps/vestra-cli/src/doctor-composition.ts", import.meta.url));

const FORBIDDEN_PACKAGE_SPECIFIERS = Object.freeze([
  "@verchestra/drivers",
  "@verchestra/connectors",
  "@verchestra/data-probe",
  "@verchestra/platform-node",
  "@verchestra/policy"
]);

// The two narrow subpaths are the sole approved entry points into their
// otherwise-forbidden package roots.
const ALLOWED_NARROW_SUBPATHS = Object.freeze(["@verchestra/platform-node/readonly", "@verchestra/policy/readonly"]);

function packageExportsMap(packageName) {
  const manifestPath = fileURLToPath(new URL(`packages/${packageName}/package.json`, repoRoot));
  return JSON.parse(readFileSync(manifestPath, "utf8")).exports ?? {};
}

// Resolves one import specifier from the file that contains it to either an
// absolute file path (something to keep walking) or null (a node: builtin or
// a third-party npm package — an opaque leaf outside this repo's own source,
// never recursed into).
function resolveSpecifier(specifier, fromFilePath) {
  if (specifier.startsWith("node:")) return null;
  if (specifier.startsWith(".")) return resolve(dirname(fromFilePath), specifier);
  if (specifier.startsWith("@verchestra/")) {
    const [, packageName, ...subpathParts] = specifier.split("/");
    const subpath = subpathParts.length === 0 ? "." : `./${subpathParts.join("/")}`;
    const exportsMap = packageExportsMap(packageName);
    const target = exportsMap[subpath];
    assert.ok(target, `${specifier} has no declared export in packages/${packageName}/package.json`);
    return fileURLToPath(new URL(`packages/${packageName}/${target.replace(/^\.\//u, "")}`, repoRoot));
  }
  return null; // third-party npm package: a leaf, not this repo's source
}

function transitiveClosure(entry) {
  const visited = new Set([entry]);
  const queue = [entry];
  const violations = [];
  while (queue.length > 0) {
    const filePath = queue.shift();
    const code = readFileSync(filePath, "utf8");
    for (const specifier of importSpecifiers(code)) {
      const isForbiddenRoot = FORBIDDEN_PACKAGE_SPECIFIERS.some(
        (forbidden) => specifier === forbidden && !ALLOWED_NARROW_SUBPATHS.includes(specifier)
      );
      if (isForbiddenRoot) {
        violations.push(`${filePath} imports forbidden package root ${specifier}`);
        continue;
      }
      const resolved = resolveSpecifier(specifier, filePath);
      if (resolved !== null && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { visited, violations };
}

test("the doctor composition's full transitive import closure names no forbidden package root", () => {
  const { visited, violations } = transitiveClosure(entryPath);
  assert.deepEqual(violations, []);
  // A closure of exactly one file (the entry itself, nothing recursed into)
  // would mean the walk never actually traversed anything — the property
  // this test proves would be vacuous, not established.
  assert.ok(visited.size > 5, `expected a real multi-file closure, resolved only ${visited.size} file(s)`);
});

test("deep doctor uses only reviewed read-only live adapter operations", () => {
  assert.match(
    source,
    /inspectRuntimeDatabase\([\s\S]*?dbPath[\s\S]*?\)/u,
    "SQLite is inspected through the readonly subpath wrapper"
  );
  assert.match(source, /ProtectedPathBroker\.create\(/u, "sandbox enforcement is checked through the path broker");
  assert.match(source, /logicalPath: "escape\/runtime\.db"/u, "sandbox check proves traversal rejection");
  assert.match(source, /secretPresence\(/u, "secret readiness checks presence without a read operation");
  for (const forbidden of [".start(", ".send(", ".cancel(", ".close(", ".read(", "loadExtension("]) {
    const escapedForbidden = forbidden
      .replaceAll("\\", "\\\\")
      .replaceAll(".", "\\.")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)");
    assert.doesNotMatch(source, new RegExp(escapedForbidden, "u"), "doctor must not invoke " + forbidden);
  }
});
