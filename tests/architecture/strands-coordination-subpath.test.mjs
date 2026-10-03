// invariant: SSI-02, SSI-03, SSI-05, SSI-12, SSI-13. The Strands SDK and Zod
// are imported only under packages/agent-runtime/src/coordination/strands/,
// only through `@strands-agents/sdk/multiagent`, and reached only through the
// `@verchestra/agent-runtime/strands-coordination` subpath. Nothing there may
// name what would let the SDK call a model, read a credential, keep a session,
// run a tool, or export telemetry (TM-001, TM-017), and the package's main
// entry never reaches the SDK.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const STRANDS_DIRECTORY = "packages/agent-runtime/src/coordination/strands/";
const ENTRY = `${STRANDS_DIRECTORY}index.ts`;

// why: a comment may name a banned symbol to explain why it is banned.
function code(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

function sources(directory) {
  const files = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) files.push(...sources(`${path}/`));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

const productSources = [
  ...sources("apps/vestra-cli/closure/"),
  ...["apps", "packages"].flatMap((top) =>
    readdirSync(join(root, top), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          return sources(`${top}/${entry.name}/src/`);
        } catch {
          return [];
        }
      })
  )
];

// why: static, bare, dynamic, and require forms, so no spelling slips past.
function specifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/gu),
    ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gmu),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/gu),
    ...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)
  ].map((match) => match[1]);
}

const isSdk = (specifier) => specifier === "@strands-agents/sdk" || specifier.startsWith("@strands-agents/sdk/");
const isZod = (specifier) => specifier === "zod" || specifier.startsWith("zod/");

test("the scan reads every product source and finds the adapter", () => {
  assert.ok(productSources.length > 250, `only ${productSources.length} sources were scanned`);
  assert.ok(productSources.includes(ENTRY));
});

test("only the Strands adapter imports the SDK or Zod, and the SDK only through ./multiagent", () => {
  const outside = [];
  const notSubpath = [];
  for (const path of productSources) {
    for (const specifier of specifiers(code(readFileSync(join(root, path), "utf8")))) {
      if ((isSdk(specifier) || isZod(specifier)) && !path.startsWith(STRANDS_DIRECTORY))
        outside.push(`${path}: ${specifier}`);
      if (isSdk(specifier) && specifier !== "@strands-agents/sdk/multiagent") notSubpath.push(`${path}: ${specifier}`);
    }
  }
  assert.deepEqual(outside, []);
  assert.deepEqual(notSubpath, []);
  const adapter = sources(STRANDS_DIRECTORY).flatMap((path) =>
    specifiers(code(readFileSync(join(root, path), "utf8"))).filter(isSdk)
  );
  assert.ok(adapter.length > 0, "the adapter imports the SDK nowhere");
});

test("the adapter names no model, agent, router, session, MCP client, sandbox, vended tool, or telemetry", () => {
  const banned = [
    [/\bnew\s+Agent\b|\bAgent\s*\(|[{,]\s*Agent\s*[,}]/u, "a Strands Agent"],
    [/\bBedrock\w*|\bAnthropicModel\b|\bOpenAIModel\b|\bGoogleModel\b|\bVercelModel\b|\bModelRouter\b/u, "a model"],
    [/\bMcpClient\b|@modelcontextprotocol/u, "an MCP client"],
    [/\bSessionManager\b|\bsessionManager\b|\bS3Storage\b/u, "a session manager"],
    [/\bpreserveContext\b/u, "preserved context"],
    [/\bsandbox\b|\bSandbox\b|vended-tools|vended-plugins|\bbash\b/u, "a sandbox or vended tool"],
    [/telemetry|@opentelemetry|\bconfigureLogging\b|\bsetTracerProvider\b/u, "telemetry or logging setup"],
    [/\bA2A\w*|\/a2a\b/u, "an A2A client"],
    [
      /\bprocess\.env\b|\bspawn\(|child_process|node:net|node:http|\bfetch\(/u,
      "an ambient environment, process, or network"
    ]
  ];
  const findings = [];
  for (const path of sources(STRANDS_DIRECTORY)) {
    const source = code(readFileSync(join(root, path), "utf8"));
    for (const [pattern, label] of banned) if (pattern.test(source)) findings.push(`${path}: ${label}`);
  }
  assert.deepEqual(findings, []);
});

test("the package declares the subpath and its main entry never reaches the adapter or the SDK", () => {
  const manifest = JSON.parse(readFileSync(join(root, "packages/agent-runtime/package.json"), "utf8"));
  assert.deepEqual(manifest.exports, {
    ".": "./src/index.ts",
    "./strands-coordination": "./src/coordination/strands/index.ts"
  });
  const visited = new Set();
  const queue = [join(root, "packages/agent-runtime/src/index.ts")];
  const reached = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      if (isSdk(specifier) || isZod(specifier)) reached.push(`${relative(root, file)}: ${specifier}`);
      if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier));
    }
  }
  assert.ok(visited.size > 10, `expected a real closure, resolved ${visited.size}`);
  assert.deepEqual(reached, []);
  assert.deepEqual(
    [...visited].filter((file) => relative(root, file).startsWith(STRANDS_DIRECTORY)),
    []
  );
});

test("the adapter's entry names every export explicitly", () => {
  assert.doesNotMatch(readFileSync(join(root, ENTRY), "utf8"), /export\s*\*/u);
});
