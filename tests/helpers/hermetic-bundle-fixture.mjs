import { createHash } from "node:crypto";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const releaseId = "release:verchestra:1.0.0:win32-x64";

const evidence = new Set(["license", "sbom", "provenance", "evaluation"]);

export function component(kind, id, overrides = {}) {
  const targetSpecific = new Set(["node-runtime", "sqlite-native", "launcher"]).has(kind);
  return {
    componentId: id,
    kind,
    releaseId,
    platform: targetSpecific ? "win32" : "any",
    arch: targetSpecific ? "x64" : "any",
    logicalPath: kind === "launcher" ? `bin/${id.split(":").at(-1)}.cmd` : `components/${id.replaceAll(":", "-")}`,
    contentDigest: sha(id),
    sizeBytes: 100 + id.length,
    licenseRefs: evidence.has(kind) ? [] : ["license:product"],
    attestationRefs: evidence.has(kind) ? [] : ["provenance:build", "evaluation:release"],
    executable: kind === "node-runtime" || kind === "launcher",
    ...overrides
  };
}

export const components = () => [
  component("node-runtime", "runtime:node"),
  component("core-code", "core:verchestra"),
  component("schema", "schemas:contracts"),
  component("migration", "migrations:runtime"),
  component("policy", "policy:cedar"),
  component("cedar-wasm", "wasm:cedar"),
  component("sqlite-native", "native:sqlite"),
  component("driver", "driver:claude"),
  component("connector", "connector:jira"),
  component("skill", "skill:tlc"),
  component("license", "license:product", { logicalPath: "licenses/product.txt" }),
  component("sbom", "sbom:cyclonedx", { logicalPath: "evidence/sbom.cdx.json" }),
  component("provenance", "provenance:build", { logicalPath: "evidence/provenance.intoto.jsonl" }),
  component("evaluation", "evaluation:release", { logicalPath: "evidence/evaluation.json" }),
  component("launcher", "launcher:vestra", { logicalPath: "bin/vestra.cmd" }),
  component("launcher", "launcher:verchestra", { logicalPath: "bin/verchestra.cmd" })
];

export const bundleInput = (overrides = {}) => ({
  schemaVersion: 1,
  releaseId,
  semanticVersion: "1.0.0",
  createdAt: "2026-07-16T15:00:00.000Z",
  target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
  runtimeResolver: false,
  components: components(),
  ...overrides
});
