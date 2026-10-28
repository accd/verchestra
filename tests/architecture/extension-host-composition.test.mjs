// invariant (#569, door 4 of .specs/features/probe-host-composition/plan.md):
// the CLI composes the out-of-process probe host's admission and nothing else
// of it until slice 2's grant exists. The walk covers every module reachable
// from the CLI and the launcher. An edge into packages/extension-host is
// allowed only from the extension check module, only through the admission
// subpath, and only for `WorkspaceProbeAdmission` and its types; the worker,
// the supervisor, and the spawned transport stay unreachable.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOST = join(ROOT, "packages", "extension-host");
const ENTRY_ROOTS = ["apps/vestra-cli/src", "apps/vestra-launcher/src", "apps/vestra-launcher/closure"];
const COMPOSER = "apps/vestra-cli/src/extension/extension-check.ts";
const ADMISSION_SPECIFIER = "@verchestra/extension-host/admission";
const ADMISSION_NAMES = new Set([
  "WorkspaceProbeAdmission",
  "WorkspaceProbeWorkerApproval",
  "WorkspaceProbeWorkerApprovals",
  "WorkspaceProbeWorkerExtension",
  "WorkspaceProbeWorkerExtensions",
  "WorkspaceProbeWorkerGrant",
  "WorkspaceProbeWorkerRequest",
  "WorkspaceProbeWorkerTrust"
]);
// why: these start or drive a worker; slice 1 starts none (AC 14).
const SPAWNING_NAMES = new Set(["FramedProbeWorker", "ProbeWorkerSupervisor", "SpawnedProbeWorker"]);
const HOST_UNREACHABLE = ["src/index.ts", "src/framed-probe-worker.ts", "src/testing.ts"];

// why: a statement's imported names, or null when it imports the whole module
// (a namespace, a default, a side effect, or a dynamic import), which no
// allowlist can narrow.
function importNames(clause) {
  const braces = /^(?:type\s+)?\{([^}]*)\}$/u.exec(clause.trim());
  if (braces === null) return null;
  return braces[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^type\s+/u, ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.split(/\s+as\s+/u)[0]);
}

function importStatements(code) {
  const statements = [];
  for (const match of code.matchAll(/\b(?:import|export)\s+([^;"'`]*?)\s*\bfrom\s*["']([^"']+)["']/gu))
    statements.push({ specifier: match[2], names: importNames(match[1]) });
  for (const match of code.matchAll(/\bimport\s*["']([^"']+)["']/gu))
    statements.push({ specifier: match[1], names: null });
  for (const match of code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu))
    statements.push({ specifier: match[1], names: null });
  return statements;
}

function resolveSpecifier(specifier, fromFilePath) {
  if (specifier.startsWith(".")) return resolve(dirname(fromFilePath), specifier);
  if (!specifier.startsWith("@verchestra/")) return null;
  const [, packageName, ...subpathParts] = specifier.split("/");
  const subpath = subpathParts.length === 0 ? "." : `./${subpathParts.join("/")}`;
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", packageName, "package.json"), "utf8"));
  const target = manifest.exports?.[subpath];
  assert.ok(typeof target === "string", `${specifier} has no declared export`);
  return join(ROOT, "packages", packageName, target.replace(/^\.\//u, ""));
}

function sources(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.(?:ts|mts|mjs)$/u.test(name) && !name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

const repositoryPath = (file) => relative(ROOT, file).replaceAll("\\", "/");

// invariant: one edge is allowed, and only in one shape. Anything else is a
// finding: an app module naming a spawning export from any package, or any
// other edge into extension-host. Packages themselves may name their own
// exports; the walk judges what the apps import.
function statementFinding(file, statement, composer, hostEdge) {
  const names = statement.names ?? ["*"];
  const described = `${repositoryPath(file)} imports ${names.join(", ")} from ${statement.specifier}`;
  const appModule = !file.startsWith(join(ROOT, "packages"));
  if (appModule && names.some((name) => SPAWNING_NAMES.has(name))) return described;
  if (!hostEdge) return undefined;
  const allowed =
    file === composer &&
    statement.specifier === ADMISSION_SPECIFIER &&
    names.every((name) => ADMISSION_NAMES.has(name));
  return allowed ? undefined : described;
}

function hostEdges(entries, composer = join(ROOT, COMPOSER)) {
  const visited = new Set(entries);
  const queue = [...entries];
  const edges = [];
  const findings = [];
  const hostTargets = [];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const statement of importStatements(readFileSync(file, "utf8"))) {
      const target = resolveSpecifier(statement.specifier, file);
      const hostEdge =
        statement.specifier.startsWith("@verchestra/extension-host") || target?.startsWith(HOST) === true;
      const finding = statementFinding(file, statement, composer, hostEdge);
      if (finding !== undefined) findings.push(finding);
      if (hostEdge) {
        edges.push(`${repositoryPath(file)} imports ${statement.specifier}`);
        if (target !== null) hostTargets.push(target);
        continue;
      }
      if (target !== null && !visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }
  }
  return { visited, edges, findings, hostTargets };
}

// why: the modules the allowed edge loads, followed inside extension-host, so
// a change there that pulls in the worker or the supervisor is seen too.
function hostClosure(targets) {
  const seen = new Set();
  const queue = [...targets];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const statement of importStatements(readFileSync(file, "utf8"))) {
      const target = resolveSpecifier(statement.specifier, file);
      if (target !== null && target.startsWith(HOST)) queue.push(target);
    }
  }
  return [...seen].map((file) => relative(HOST, file).replaceAll("\\", "/"));
}

test("only the extension commands reach admission", () => {
  const entries = ENTRY_ROOTS.flatMap((root) => sources(join(ROOT, root)));
  const { visited, edges, findings, hostTargets } = hostEdges(entries);
  assert.ok(visited.size > 150, `the walk reached only ${visited.size} modules`);
  assert.ok(
    [...visited].some((path) => path.startsWith(join(ROOT, "packages", "application"))),
    "the walk never left the apps"
  );
  assert.deepEqual(findings, [], "AC 16: only the extension check module imports admission, and only admission");
  assert.deepEqual(edges, [`${COMPOSER} imports ${ADMISSION_SPECIFIER}`], "the composition edge is the only one");
  const closure = hostClosure(hostTargets);
  assert.ok(closure.includes("src/workspace-trust.ts"), `the admission edge loads ${closure.join(", ")}`);
  for (const module of HOST_UNREACHABLE)
    assert.equal(closure.includes(module), false, `the admission edge reaches extension-host ${module}`);
});

test("the walk flags spawning imports and other modules", () => {
  // why: the walk itself must flag each forbidden shape, or a pass above
  // would prove nothing.
  const probe = mkdtempSync(join(tmpdir(), "verchestra-extension-host-walk-"));
  try {
    const composer = join(probe, "extension-check.ts");
    const module = (name, code) => {
      const path = join(probe, name);
      writeFileSync(path, code);
      return path;
    };
    const cases = [
      [composer, `import { FramedProbeWorker } from "@verchestra/extension-host";\n`],
      [composer, `import { ProbeWorkerSupervisor, WorkspaceProbeAdmission } from "${ADMISSION_SPECIFIER}";\n`],
      [composer, `import { SpawnedProbeWorker } from "${ADMISSION_SPECIFIER}";\n`],
      [module("spawn.ts", ""), `import { SpawnedProbeWorker } from "@verchestra/platform-node";\n`],
      [module("other.ts", ""), `import { WorkspaceProbeAdmission } from "${ADMISSION_SPECIFIER}";\n`],
      [composer, `import * as host from "${ADMISSION_SPECIFIER}";\n`],
      [composer, `const host = await import("${ADMISSION_SPECIFIER}");\n`]
    ];
    for (const [path, code] of cases) {
      writeFileSync(path, code);
      const { findings } = hostEdges([path], composer);
      assert.equal(findings.length, 1, `the walk misses: ${code.trim()}`);
    }
    writeFileSync(
      composer,
      `import { WorkspaceProbeAdmission, type WorkspaceProbeWorkerApproval } from "${ADMISSION_SPECIFIER}";\n`
    );
    const allowed = hostEdges([composer], composer);
    assert.deepEqual(allowed.findings, []);
    assert.equal(allowed.edges.length, 1, "the walk misses the allowed admission edge");
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
});

test("extension-host is an exported CLI dependency", () => {
  const host = JSON.parse(readFileSync(join(HOST, "package.json"), "utf8"));
  assert.equal(typeof host.exports, "object");
  assert.equal(host.exports["."], "./src/index.ts");
  assert.equal(host.exports["./admission"], "./src/workspace-trust.ts");
  const cli = JSON.parse(readFileSync(join(ROOT, "apps", "vestra-cli", "package.json"), "utf8"));
  assert.equal(cli.dependencies["@verchestra/extension-host"], "workspace:0.0.0");
  assert.equal(resolveSpecifier(ADMISSION_SPECIFIER, join(ROOT, COMPOSER)), join(HOST, "src", "workspace-trust.ts"));
});
