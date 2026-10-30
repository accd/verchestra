// invariant (#569, door 4 of .specs/features/probe-host-composition/plan.md,
// and AD-086): the CLI composes the out-of-process probe host in two places
// only. The walk covers every module reachable from the CLI and the launcher.
// The extension check module reaches admission alone, through the admission
// subpath, for `WorkspaceProbeAdmission` and its types; from it the worker,
// the supervisor, and the spawned transport stay unreachable. The probe
// family's run module, which starts a probe worker under its grant, also
// reaches the supervisor, the framed protocol and the in-memory parameter
// broker and result sink through the package index, and the spawned transport
// through platform-node; no other module names any of them. The first-party
// SQLite probe worker (AD-087), which runs only as its own bundled process,
// takes the probe protocol's frame codec, by name, through the package index.
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
const RUNNER = "apps/vestra-cli/src/probe/probe-run.ts";
const WORKER = "apps/vestra-cli/src/probe/sqlite-probe-worker.ts";
const ADMISSION_SPECIFIER = "@verchestra/extension-host/admission";
const HOST_SPECIFIER = "@verchestra/extension-host";
const TRANSPORT_SPECIFIER = "@verchestra/platform-node";
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
const SUPERVISION_NAMES = new Set([
  "FramedProbeWorker",
  "MemoryProbeResultSink",
  "MemoryProtectedParameterBroker",
  "ProbeWorkerSupervisor"
]);
// why: the frame codec a worker speaks the protocol with, and nothing that
// supervises, admits or starts one.
const CODEC_NAMES = new Set(["ProbeFrameDecoder", "encodeProbeFrame"]);
// why: these start or drive a worker; only the probe run module starts one.
const SPAWNING_NAMES = new Set(["FramedProbeWorker", "ProbeWorkerSupervisor", "SpawnedProbeWorker"]);
// invariant: what each composing module's host edges may load inside
// extension-host: admission alone from the extension check, and never the
// testing doubles from either.
const HOST_UNREACHABLE = Object.freeze({
  [COMPOSER]: ["src/index.ts", "src/framed-probe-worker.ts", "src/testing.ts"],
  [RUNNER]: ["src/testing.ts"],
  [WORKER]: ["src/testing.ts"]
});

// why: the composing modules a walk admits, and the edge each may have into
// extension-host: its module, its specifier, and the names it may import.
function composition(composer, runner, worker) {
  return {
    runner,
    edges: [
      [composer, ADMISSION_SPECIFIER, ADMISSION_NAMES],
      [runner, ADMISSION_SPECIFIER, ADMISSION_NAMES],
      [runner, HOST_SPECIFIER, SUPERVISION_NAMES],
      [worker, HOST_SPECIFIER, CODEC_NAMES]
    ]
  };
}
const PRODUCT = composition(join(ROOT, COMPOSER), join(ROOT, RUNNER), join(ROOT, WORKER));

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

// invariant: four edges are allowed, each only in its shape. Anything else
// is a finding: an app module other than the probe run module naming a
// spawning export from any package, the run module naming one from anywhere
// but the host index or the transport's package, or any other edge into
// extension-host. Packages themselves may name their own exports; the walk
// judges what the apps import.
function statementFinding(file, statement, allowed, hostEdge) {
  const names = statement.names ?? ["*"];
  const described = `${repositoryPath(file)} imports ${names.join(", ")} from ${statement.specifier}`;
  const appModule = !file.startsWith(join(ROOT, "packages"));
  const spawnsHere = file === allowed.runner && [HOST_SPECIFIER, TRANSPORT_SPECIFIER].includes(statement.specifier);
  if (appModule && !spawnsHere && names.some((name) => SPAWNING_NAMES.has(name))) return described;
  if (!hostEdge) return undefined;
  const permitted = allowed.edges.some(
    ([module, specifier, permittedNames]) =>
      file === module && statement.specifier === specifier && names.every((name) => permittedNames.has(name))
  );
  return permitted ? undefined : described;
}

function hostEdges(entries, allowed = PRODUCT) {
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
      const finding = statementFinding(file, statement, allowed, hostEdge);
      if (finding !== undefined) findings.push(finding);
      if (hostEdge) {
        edges.push(`${repositoryPath(file)} imports ${statement.specifier}`);
        if (target !== null) hostTargets.push({ from: repositoryPath(file), target });
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
  assert.deepEqual(
    findings,
    [],
    "AC 16: only the extension check module imports admission, and only the probe run module the supervisor"
  );
  assert.deepEqual(
    [...edges].sort(),
    [
      `${COMPOSER} imports ${ADMISSION_SPECIFIER}`,
      `${RUNNER} imports ${HOST_SPECIFIER}`,
      `${RUNNER} imports ${ADMISSION_SPECIFIER}`,
      `${WORKER} imports ${HOST_SPECIFIER}`
    ].sort(),
    "the composition edges are the only ones"
  );
  for (const [from, unreachable] of Object.entries(HOST_UNREACHABLE)) {
    const closure = hostClosure(hostTargets.filter((edge) => edge.from === from).map((edge) => edge.target));
    assert.ok(closure.includes("src/workspace-trust.ts"), `${from}'s edges load ${closure.join(", ")}`);
    for (const module of unreachable)
      assert.equal(closure.includes(module), false, `${from}'s edges reach extension-host ${module}`);
  }
  const runnerClosure = hostClosure(hostTargets.filter((edge) => edge.from === RUNNER).map((edge) => edge.target));
  assert.ok(runnerClosure.includes("src/index.ts"), "the probe run module never reached the supervisor");
});

test("the walk flags spawning imports and other modules", () => {
  // why: the walk itself must flag each forbidden shape, or a pass above
  // would prove nothing.
  const probe = mkdtempSync(join(tmpdir(), "verchestra-extension-host-walk-"));
  try {
    const composer = join(probe, "extension-check.ts");
    const runner = join(probe, "probe-run.ts");
    const worker = join(probe, "sqlite-probe-worker.ts");
    const allowed = composition(composer, runner, worker);
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
      [composer, `const host = await import("${ADMISSION_SPECIFIER}");\n`],
      [composer, `import { ProbeWorkerSupervisor } from "${HOST_SPECIFIER}";\n`],
      [composer, `import { SpawnedProbeWorker } from "${TRANSPORT_SPECIFIER}";\n`],
      [module("probe-other.ts", ""), `import { ProbeWorkerSupervisor } from "${HOST_SPECIFIER}";\n`],
      [module("probe-spawn.ts", ""), `import { SpawnedProbeWorker } from "${TRANSPORT_SPECIFIER}";\n`],
      [runner, `import { ProbeFrameDecoder } from "${HOST_SPECIFIER}";\n`],
      [runner, `import { SpawnedProbeWorker } from "acme-transport";\n`],
      [runner, `import * as host from "${HOST_SPECIFIER}";\n`],
      [worker, `import { ProbeWorkerSupervisor } from "${HOST_SPECIFIER}";\n`],
      [worker, `import { ProbeFrameDecoder, ProbeSequenceGuard } from "${HOST_SPECIFIER}";\n`],
      [worker, `import { encodeProbeFrame } from "${ADMISSION_SPECIFIER}";\n`],
      [worker, `import * as host from "${HOST_SPECIFIER}";\n`],
      [worker, `import { SpawnedProbeWorker } from "${TRANSPORT_SPECIFIER}";\n`]
    ];
    for (const [path, code] of cases) {
      writeFileSync(path, code);
      const { findings } = hostEdges([path], allowed);
      assert.equal(findings.length, 1, `the walk misses: ${code.trim()}`);
    }
    writeFileSync(
      composer,
      `import { WorkspaceProbeAdmission, type WorkspaceProbeWorkerApproval } from "${ADMISSION_SPECIFIER}";\n`
    );
    const admitted = hostEdges([composer], allowed);
    assert.deepEqual(admitted.findings, []);
    assert.equal(admitted.edges.length, 1, "the walk misses the allowed admission edge");
    writeFileSync(
      runner,
      [
        `import { FramedProbeWorker, MemoryProbeResultSink, ProbeWorkerSupervisor } from "${HOST_SPECIFIER}";`,
        `import { WorkspaceProbeAdmission, type WorkspaceProbeWorkerGrant } from "${ADMISSION_SPECIFIER}";`,
        `import { SpawnedProbeWorker, type RuntimeStore } from "${TRANSPORT_SPECIFIER}";`,
        ""
      ].join("\n")
    );
    const running = hostEdges([runner], allowed);
    assert.deepEqual(running.findings, [], "the walk refuses the probe run module's own edges");
    assert.equal(running.edges.length, 2, "the walk misses the probe run module's host edges");
    writeFileSync(worker, `import { ProbeFrameDecoder, encodeProbeFrame } from "${HOST_SPECIFIER}";\n`);
    const serving = hostEdges([worker], allowed);
    assert.deepEqual(serving.findings, [], "the walk refuses the worker module's frame codec");
    assert.equal(serving.edges.length, 1, "the walk misses the worker module's host edge");
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
