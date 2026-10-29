// invariant: AC 15 and door 4 of .specs/features/database-registration/plan.md.
// The `vestra database` family validates and records registrations; it
// reaches no database client, no probe worker, no network module and no
// platform branch, and it is the only part of the CLI that loads
// @verchestra/data-probe, which main.ts reaches only through a dynamic import.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_SOURCE = join(ROOT, "apps", "vestra-cli", "src");
const FAMILY = join(CLI_SOURCE, "database");
const MAIN = join(CLI_SOURCE, "main.ts");
const ENTRY = "./database/database-command.ts";
const DATA_PROBE = "@verchestra/data-probe";
const DATA_PROBE_VALUES = new Set([
  "normalizeDatabaseRegistration",
  "normalizeDatabaseAccessPolicy",
  "DatabaseProbeError"
]);
// why: the modules that open a socket or start a process; a database client
// or a probe worker needs one of them, and so does the probe host.
const FORBIDDEN_BUILTINS = new Set(["child_process", "net", "tls", "dgram", "http", "https", "http2"]);

// why: comments name what the code must not do, so they are not code.
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:\\])\/\/.*$/gmu, "$1");
}

// invariant: a statement's imported names, each marked a type or a value, or
// null when it imports the whole module (a namespace, a default, a side
// effect, or a dynamic import), which no allowlist can narrow.
function importNames(clause) {
  const typeOnly = /^type\s/u.test(clause.trim());
  const braces = /^(?:type\s+)?\{([^}]*)\}$/u.exec(clause.trim());
  if (braces === null) return null;
  return braces[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => ({
      name: entry.replace(/^type\s+/u, "").split(/\s+as\s+/u)[0],
      type: typeOnly || /^type\s/u.test(entry)
    }));
}

function importStatements(source) {
  const text = code(source);
  const statements = [];
  for (const match of text.matchAll(/\b(?:import|export)\s+([^;"'`]*?)\s*\bfrom\s*["']([^"']+)["']/gu))
    statements.push({ specifier: match[2], names: importNames(match[1]), dynamic: false });
  for (const match of text.matchAll(/\bimport\s*["']([^"']+)["']/gu))
    statements.push({ specifier: match[1], names: null, dynamic: false });
  for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu))
    statements.push({ specifier: match[1], names: null, dynamic: true });
  return statements;
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
const builtin = (specifier) => specifier.replace(/^node:/u, "").split("/")[0];

// invariant: C21. What a database family module may not import or read.
function familyFindings(file, source) {
  const findings = [];
  const where = repositoryPath(file);
  for (const statement of importStatements(source)) {
    if (FORBIDDEN_BUILTINS.has(builtin(statement.specifier))) findings.push(`${where} imports ${statement.specifier}`);
    if (statement.specifier.startsWith("@verchestra/extension-host"))
      findings.push(`${where} imports ${statement.specifier}`);
    if (statement.specifier !== DATA_PROBE && !statement.specifier.startsWith(`${DATA_PROBE}/`)) continue;
    const names = statement.names ?? [{ name: "*", type: false }];
    for (const { name } of names.filter((entry) => !entry.type && !DATA_PROBE_VALUES.has(entry.name)))
      findings.push(`${where} imports ${name} from ${statement.specifier}`);
  }
  if (/\bprocess\s*\.\s*platform\b|\bprocess\s*\[\s*["']platform["']\s*\]/u.test(code(source)))
    findings.push(`${where} reads process.platform`);
  return findings;
}

test("the database family reaches no database client, worker or platform branch", () => {
  const files = sources(FAMILY);
  assert.ok(files.length >= 4, `the family has only ${files.length} modules`);
  assert.ok(files.includes(join(FAMILY, "database-command.ts")));
  const findings = files.flatMap((file) => familyFindings(file, readFileSync(file, "utf8")));
  assert.deepEqual(findings, [], "AC 15: the database family reaches no client, worker, network or platform branch");
  const probeEdges = files.flatMap((file) =>
    importStatements(readFileSync(file, "utf8")).filter((statement) => statement.specifier === DATA_PROBE)
  );
  assert.ok(probeEdges.length > 0, "the family never imports data-probe, so the allowlist proved nothing");
  // why: the scan itself must flag each forbidden shape, or a pass above
  // would prove nothing.
  const probe = join(FAMILY, "probe.ts");
  for (const source of [
    `import { spawn } from "node:child_process";\n`,
    `import { execFile } from "child_process";\n`,
    `import { connect } from "node:net";\n`,
    `import { connect } from "node:tls";\n`,
    `import { createSocket } from "node:dgram";\n`,
    `import { request } from "node:http";\n`,
    `import { request } from "node:https";\n`,
    `import { connect } from "node:http2";\n`,
    `import { WorkspaceProbeAdmission } from "@verchestra/extension-host/admission";\n`,
    `export { FramedProbeWorker } from "@verchestra/extension-host";\n`,
    `import { SqliteReadConnection } from "${DATA_PROBE}";\n`,
    `import { normalizeDatabaseRegistration, ProbePlanner } from "${DATA_PROBE}";\n`,
    `import * as probe from "${DATA_PROBE}";\n`,
    `const probe = await import("${DATA_PROBE}");\n`,
    `const windows = process.platform === "win32";\n`
  ])
    assert.equal(familyFindings(probe, source).length, 1, `the scan misses: ${source.trim()}`);
  assert.deepEqual(
    familyFindings(
      probe,
      `import {\n  DatabaseProbeError,\n  normalizeDatabaseAccessPolicy,\n  normalizeDatabaseRegistration,\n  type DatabaseRegistration\n} from "${DATA_PROBE}";\nimport type { DatabaseAccessPolicy } from "${DATA_PROBE}";\n// process.platform is named only here\n`
    ),
    []
  );
});

// why: main.ts's static closure inside the CLI, so a module main.ts loads
// eagerly that loads the family is seen too.
function staticClosure(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const statement of importStatements(readFileSync(file, "utf8"))) {
      if (statement.dynamic || !statement.specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), statement.specifier);
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

function inside(directory, file) {
  const path = relative(directory, file);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

// invariant: C23. Only database family modules import data-probe, and main.ts
// reaches the family only through its dynamic import of the entry.
function compositionFindings(files, main, family) {
  const findings = [];
  for (const file of files) {
    const edges = importStatements(readFileSync(file, "utf8")).filter((statement) =>
      statement.specifier.startsWith(DATA_PROBE)
    );
    if (edges.length > 0 && !inside(family, file)) findings.push(`${repositoryPath(file)} imports ${DATA_PROBE}`);
  }
  for (const file of staticClosure(main))
    if (inside(family, file)) findings.push(`${repositoryPath(main)} loads ${repositoryPath(file)} eagerly`);
  const entries = importStatements(readFileSync(main, "utf8")).filter(
    (statement) => statement.dynamic && statement.specifier === ENTRY
  );
  if (entries.length !== 1) findings.push(`${repositoryPath(main)} has no dynamic import of ${ENTRY}`);
  return findings;
}

test("only the database family loads data-probe", () => {
  const files = sources(CLI_SOURCE);
  assert.ok(files.length > 50, `the walk reached only ${files.length} modules`);
  assert.deepEqual(compositionFindings(files, MAIN, FAMILY), [], "door 4: only the database family loads data-probe");
  assert.ok(staticClosure(MAIN).size > 5, "main.ts's static closure was not walked");
  // why: the walk itself must flag each forbidden shape, or a pass above
  // would prove nothing.
  const probe = mkdtempSync(join(tmpdir(), "verchestra-database-walk-"));
  try {
    const family = join(probe, "database");
    const main = join(probe, "main.ts");
    const write = (path, source) => {
      writeFileSync(path, source);
      return path;
    };
    mkdirSync(family);
    const importsProbe = `import { DatabaseProbeError } from "${DATA_PROBE}";\n`;
    const entry = write(join(family, "database-command.ts"), importsProbe);
    const other = write(join(probe, "other.ts"), importsProbe);
    write(join(probe, "eager.ts"), `export * from "${ENTRY}";\n`);
    const dynamicMain = `const loaded = await import("${ENTRY}");\n`;
    write(main, dynamicMain);
    assert.deepEqual(compositionFindings([entry, main], main, family), []);
    for (const [label, files_, source] of [
      ["a module outside the family imports data-probe", [entry, other], dynamicMain],
      ["main imports the entry statically", [entry], `import { entry } from "${ENTRY}";\n${dynamicMain}`],
      ["main loads a module that loads the entry", [entry], `import "./eager.ts";\n${dynamicMain}`],
      ["main never imports the entry", [entry], "export const nothing = 0;\n"]
    ]) {
      write(main, source);
      assert.equal(compositionFindings(files_, main, family).length, 1, `the walk misses: ${label}`);
    }
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
});
