import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_PACKAGES = Object.freeze([
  "apps/vestra-cli",
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
  "packages/distribution"
]);

const CORE = new Set(["contracts", "domain", "application"]);
const ADAPTERS = new Set(
  EXPECTED_PACKAGES.filter((path) => path.startsWith("packages/"))
    .map((path) => path.split("/")[1])
    .filter((name) => !CORE.has(name))
);

export function validateDependencyEdge(from, to) {
  if (from === to) return { allowed: true };
  if (from === "vestra-cli") return { allowed: true };
  if (from === "contracts") return { allowed: false, code: "VES_ARCH_INWARD_RULE" };
  if (from === "domain")
    return to === "contracts" ? { allowed: true } : { allowed: false, code: "VES_ARCH_INWARD_RULE" };
  if (from === "application") {
    return new Set(["contracts", "domain"]).has(to)
      ? { allowed: true }
      : { allowed: false, code: "VES_ARCH_CONCRETE_ADAPTER_IMPORT" };
  }
  if (ADAPTERS.has(from)) {
    return new Set(["contracts", "domain", "application"]).has(to)
      ? { allowed: true }
      : { allowed: false, code: "VES_ARCH_ADAPTER_COUPLING" };
  }
  return { allowed: false, code: "VES_ARCH_PACKAGE_UNKNOWN" };
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
    } else if (!dependency.startsWith(".") && new Set(["contracts", "domain", "application"]).has(packageName)) {
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
