// invariant: AC 17 of .specs/features/probe-run/plan.md (AD-086). Verchestra
// delivers no database credential to a probe worker, so the `vestra probe`
// family reads the OS credential store only to unlock the Workspace evidence
// key: no module under apps/vestra-cli/src/probe/ imports the secret broker,
// the credential reader or an OS credential backend, and none reads a
// registration's logical credential name, which only the plan carries.
// why: the scan names credential surfaces, so the spawn guard is installed as
// for every test that could reach one (no-keychain-spawn-in-tests).
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FAMILY = join(ROOT, "apps", "vestra-cli", "src", "probe");
const SIGNING = "../task/task-signing.ts";
const SIGNING_NAMES = new Set(["unlockedSigner", "workspaceTrustRoot"]);
// why: the names that read or broker a credential, wherever they come from.
const CREDENTIAL_NAMES = new Set([
  "SecretBroker",
  "withSecret",
  "createOsCredentialStore",
  "readCredentials",
  "requireCredentialBound"
]);
// why: the modules that reach the OS credential store.
const CREDENTIAL_MODULES = [/^@verchestra\/platform-node\/secrets$/u, /(?:^|\/)task-credentials\.ts$/u, /secret/iu];
const LOGICAL_CREDENTIAL = /\blogicalCredentialName\b/u;

// why: comments name what the code must not do, so they are not code.
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:\\])\/\/.*$/gmu, "$1");
}

function importStatements(source) {
  const statements = [];
  for (const match of source.matchAll(/\b(?:import|export)\s+([^;"'`]*?)\s*\bfrom\s*["']([^"']+)["']/gu)) {
    const braces = /^(?:type\s+)?\{([^}]*)\}$/u.exec(match[1].trim());
    const names =
      braces === null
        ? null
        : braces[1]
            .split(",")
            .map((entry) => entry.trim().replace(/^type\s+/u, ""))
            .filter((entry) => entry.length > 0)
            .map((entry) => entry.split(/\s+as\s+/u)[0]);
    statements.push({ specifier: match[2], names });
  }
  for (const match of source.matchAll(/\bimport\s*(?:\(\s*)?["']([^"']+)["']/gu))
    statements.push({ specifier: match[1], names: null });
  return statements;
}

function sources(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(?:ts|mts|mjs)$/u.test(name) ? [path] : [];
  });
}

// invariant: C18. What a probe family module may not import or read.
function findings(where, source) {
  const text = code(source);
  const found = [];
  for (const statement of importStatements(text)) {
    const names = statement.names ?? ["*"];
    if (CREDENTIAL_MODULES.some((pattern) => pattern.test(statement.specifier)))
      found.push(`${where} imports ${statement.specifier}`);
    else if (names.some((name) => CREDENTIAL_NAMES.has(name)))
      found.push(`${where} imports ${names.join(", ")} from ${statement.specifier}`);
    else if (statement.specifier === SIGNING && !names.every((name) => SIGNING_NAMES.has(name)))
      found.push(`${where} imports ${names.join(", ")} from ${statement.specifier}`);
  }
  for (const name of CREDENTIAL_NAMES)
    if (new RegExp(`\\b${name}\\b`, "u").test(text)) found.push(`${where} names ${name}`);
  if (LOGICAL_CREDENTIAL.test(text)) found.push(`${where} reads logicalCredentialName`);
  return [...new Set(found)];
}

test("the probe family reads no credential but the signing passphrase", () => {
  const files = sources(FAMILY);
  assert.ok(files.length >= 6, `the family has only ${files.length} modules`);
  const where = (file) => relative(ROOT, file).replaceAll("\\", "/");
  assert.deepEqual(
    files.flatMap((file) => findings(where(file), readFileSync(file, "utf8"))),
    [],
    "AC 17: the probe family reaches the credential store only through unlockedSigner"
  );
  const unlocks = files.filter((file) => /\bunlockedSigner\s*\(/u.test(code(readFileSync(file, "utf8"))));
  assert.deepEqual(unlocks.map(where), ["apps/vestra-cli/src/probe/probe-run.ts"], "the one passphrase read");
  // why: the scan itself must flag each forbidden shape, or a pass above would
  // prove nothing.
  for (const source of [
    `import { SecretBroker } from "@verchestra/platform-node";\n`,
    `import { createOsCredentialStore } from "@verchestra/platform-node/secrets";\n`,
    `import { readCredentials } from "../task/task-credentials.ts";\n`,
    `import { SIGNING_PASSPHRASE } from "../task/task-credentials.ts";\n`,
    `import { workspaceSigner } from "../task/task-signing.ts";\n`,
    `const { executeSecretCommand } = await import("../secret-composition.ts");\n`,
    `await broker.withSecret(handle, (value) => value);\n`,
    `const name = plan.logicalCredentialName;\n`
  ])
    assert.ok(findings("probe.ts", source).length > 0, `the scan misses: ${source.trim()}`);
  assert.deepEqual(
    findings(
      "probe.ts",
      `import { unlockedSigner, workspaceTrustRoot } from "../task/task-signing.ts";\n// never logicalCredentialName nor withSecret\n`
    ),
    []
  );
});
