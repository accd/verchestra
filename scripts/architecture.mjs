import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_PACKAGES = Object.freeze([
  "apps/vestra-cli",
  "apps/vestra-launcher",
  "packages/contracts",
  "packages/domain",
  "packages/application",
  "packages/workspace",
  "packages/agent-runtime",
  "packages/data-probe",
  "packages/memory",
  "packages/effects",
  "packages/evidence",
  "packages/policy",
  "packages/platform-node",
  "packages/drivers",
  "packages/connectors",
  "packages/extension-host",
  "packages/distribution",
  "packages/self-test"
]);

// Workspaces that exist under apps/ or packages/ but are outside the product
// package graph: no inward dependency direction applies and scanWorkspace never
// reads their sources. Declaring them keeps the completeness check exhaustive,
// so a genuinely undeclared directory still fails.
export const NON_PRODUCT_WORKSPACES = Object.freeze(["apps/site"]);

const CORE = new Set(["contracts", "domain", "application"]);
const ADAPTERS = new Set(
  EXPECTED_PACKAGES.filter((path) => path.startsWith("packages/"))
    .map((path) => path.split("/")[1])
    .filter((name) => !CORE.has(name))
);

// The inward direction as data rather than a branch ladder: each origin names
// the exact set it may import, and the code raised when it reaches past that
// set. apps/vestra-launcher is the public composition root, and its whole
// contract is that the published tarball reaches nothing but Node built-ins and
// its own compiled siblings - so its permitted set is empty and it is a product
// package rather than a NON_PRODUCT_WORKSPACE, precisely so scanWorkspace reads
// its sources and enforces that.
const PERMITTED_TARGETS = new Map([
  ["contracts", new Set()],
  ["domain", new Set(["contracts"])],
  ["application", new Set(["contracts", "domain"])],
  ["vestra-launcher", new Set()]
]);
const ADAPTER_TARGETS = new Set(["contracts", "domain", "application"]);
const DENIAL_CODES = new Map([
  ["contracts", "VES_ARCH_INWARD_RULE"],
  ["domain", "VES_ARCH_INWARD_RULE"],
  ["application", "VES_ARCH_CONCRETE_ADAPTER_IMPORT"],
  ["vestra-launcher", "VES_ARCH_PUBLIC_LAUNCHER_ISOLATED"]
]);

export function validateDependencyEdge(from, to) {
  if (from === to || from === "vestra-cli") return { allowed: true };
  const permitted = ADAPTERS.has(from) ? ADAPTER_TARGETS : PERMITTED_TARGETS.get(from);
  if (permitted === undefined) return { allowed: false, code: "VES_ARCH_PACKAGE_UNKNOWN" };
  if (permitted.has(to)) return { allowed: true };
  return { allowed: false, code: ADAPTERS.has(from) ? "VES_ARCH_ADAPTER_COUPLING" : DENIAL_CODES.get(from) };
}

export function inspectSource(packageName, source) {
  const findings = [];
  const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
  for (const dependency of imports) {
    if (dependency.startsWith("@verchestra/")) {
      const edge = validateDependencyEdge(packageName, dependency.slice("@verchestra/".length));
      if (!edge.allowed) findings.push({ code: edge.code, detail: dependency });
    } else if (dependency.startsWith("node:")) {
      if (packageName === "domain") findings.push({ code: "VES_ARCH_DOMAIN_NODE_IMPORT", detail: dependency });
    } else if (packageName === "contracts" && dependency.startsWith("ajv")) {
      continue;
    } else if (
      !dependency.startsWith(".") &&
      // vestra-launcher joins the inward core here: a third-party import in the
      // public launcher would become a runtime dependency of a published
      // tarball, which the artifact contract forbids.
      new Set(["contracts", "domain", "application", "vestra-launcher"]).has(packageName)
    ) {
      findings.push({ code: "VES_ARCH_THIRD_PARTY_IMPORT", detail: dependency });
    }
  }
  if (packageName === "domain" && /\bprocess\.env\b/.test(source)) {
    findings.push({ code: "VES_ARCH_DOMAIN_ENV_ACCESS", detail: "process.env" });
  }
  return findings;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

export async function scanWorkspace(rootUrl) {
  const root = rootUrl instanceof URL ? rootUrl : new URL(`file:///${String(rootUrl).replaceAll("\\", "/")}/`);
  const findings = [];
  for (const packagePath of EXPECTED_PACKAGES) {
    const packageName = packagePath.split("/").at(-1);
    const directory = fileURLToPath(new URL(`${packagePath}/src/`, root));
    for (const file of await sourceFiles(directory)) {
      for (const finding of inspectSource(packageName, await readFile(file, "utf8")))
        findings.push({ file, ...finding });
    }
  }
  return findings;
}
