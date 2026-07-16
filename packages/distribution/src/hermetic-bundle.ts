import { createHash } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+\/-]{0,255}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PLATFORMS = new Set(["win32", "linux", "darwin"]);
const ARCHES = new Set(["x64", "arm64"]);
const KINDS = [
  "node-runtime",
  "core-code",
  "schema",
  "migration",
  "policy",
  "cedar-wasm",
  "sqlite-native",
  "driver",
  "connector",
  "skill",
  "license",
  "sbom",
  "provenance",
  "evaluation",
  "launcher"
] as const;
const KIND_SET = new Set<string>(KINDS);
const EVIDENCE_KINDS = new Set<string>(["license", "sbom", "provenance", "evaluation"]);
const TARGET_KINDS = new Set<string>(["node-runtime", "sqlite-native", "launcher"]);
const REQUIRED_SINGLE_KINDS = KINDS.filter((kind) => kind !== "launcher");
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export type HermeticComponentKind = (typeof KINDS)[number];
export type BundlePlatform = "win32" | "linux" | "darwin";
export type BundleArch = "x64" | "arm64";

export interface HermeticBundleComponent {
  readonly componentId: string;
  readonly kind: HermeticComponentKind;
  readonly releaseId: string;
  readonly platform: BundlePlatform | "any";
  readonly arch: BundleArch | "any";
  readonly logicalPath: string;
  readonly contentDigest: string;
  readonly sizeBytes: number;
  readonly licenseRefs: readonly string[];
  readonly attestationRefs: readonly string[];
  readonly executable: boolean;
}

export interface HermeticDistributionBundle {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly semanticVersion: string;
  readonly createdAt: string;
  readonly target: Readonly<{ platform: BundlePlatform; arch: BundleArch; nodeVersion: string }>;
  readonly runtimeResolver: false;
  readonly components: readonly HermeticBundleComponent[];
  readonly releaseDigest: string;
}

export class HermeticBundleError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HermeticBundleError";
    this.code = code;
  }
}

type RecordValue = Readonly<Record<string, unknown>>;

const fail = (code: string, message: string): never => {
  throw new HermeticBundleError(code, message);
};

const record = (value: unknown, label: string, code = "VES_DISTRIBUTION_INPUT_INVALID"): RecordValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  return value as RecordValue;
};

const exact = (value: RecordValue, keys: readonly string[], label: string, code = "VES_DISTRIBUTION_INPUT_INVALID") => {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(code, `${label} has missing or unknown fields`);
  }
};

const string = (value: unknown, label: string, pattern = SAFE_ID): string => {
  if (typeof value !== "string" || !pattern.test(value)) fail("VES_DISTRIBUTION_INPUT_INVALID", `${label} is invalid`);
  return value as string;
};

const logicalPath = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\\")) {
    fail("VES_DISTRIBUTION_INPUT_INVALID", "logicalPath is invalid");
  }
  const path = value as string;
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path))
    fail("VES_DISTRIBUTION_INPUT_INVALID", "logicalPath is absolute");
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        RESERVED.test(segment) ||
        !/^[A-Za-z0-9._@+\-]+$/u.test(segment)
    )
  ) {
    fail("VES_DISTRIBUTION_INPUT_INVALID", "logicalPath contains an unsafe segment");
  }
  return path;
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
};

const sha = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const refs = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value)) fail("VES_DISTRIBUTION_INPUT_INVALID", `${label} must be an array`);
  const normalized = (value as unknown[]).map((entry) => string(entry, label));
  if (new Set(normalized).size !== normalized.length) fail("VES_DISTRIBUTION_INPUT_INVALID", `${label} is duplicated`);
  return Object.freeze([...normalized].sort());
};

const normalizeTarget = (value: unknown) => {
  const item = record(value, "target");
  exact(item, ["platform", "arch", "nodeVersion"], "target");
  const platform = string(item["platform"], "target.platform");
  const arch = string(item["arch"], "target.arch");
  const nodeVersion = string(item["nodeVersion"], "target.nodeVersion", NODE_VERSION);
  if (!PLATFORMS.has(platform) || !ARCHES.has(arch)) fail("VES_DISTRIBUTION_INPUT_INVALID", "target is unsupported");
  return Object.freeze({ platform: platform as BundlePlatform, arch: arch as BundleArch, nodeVersion });
};

const normalizeComponent = (
  value: unknown,
  releaseId: string,
  target: { readonly platform: BundlePlatform; readonly arch: BundleArch }
): HermeticBundleComponent => {
  const item = record(value, "component");
  exact(
    item,
    [
      "componentId",
      "kind",
      "releaseId",
      "platform",
      "arch",
      "logicalPath",
      "contentDigest",
      "sizeBytes",
      "licenseRefs",
      "attestationRefs",
      "executable"
    ],
    "component"
  );
  const componentReleaseId = string(item["releaseId"], "component.releaseId");
  if (componentReleaseId !== releaseId) fail("VES_DISTRIBUTION_RELEASE_MIXED", "component belongs to another release");
  const kind = string(item["kind"], "component.kind");
  if (!KIND_SET.has(kind)) fail("VES_DISTRIBUTION_INPUT_INVALID", "component kind is unsupported");
  const platform = string(item["platform"], "component.platform");
  const arch = string(item["arch"], "component.arch");
  if (platform !== "any" && !PLATFORMS.has(platform))
    fail("VES_DISTRIBUTION_INPUT_INVALID", "component platform is invalid");
  if (arch !== "any" && !ARCHES.has(arch)) fail("VES_DISTRIBUTION_INPUT_INVALID", "component arch is invalid");
  if (TARGET_KINDS.has(kind)) {
    if (platform !== target.platform || arch !== target.arch)
      fail("VES_DISTRIBUTION_PLATFORM_MISMATCH", "target component does not match bundle platform");
  } else if (platform !== "any" || arch !== "any") {
    fail("VES_DISTRIBUTION_PLATFORM_MISMATCH", "portable component has target-specific identity");
  }
  const contentDigest = item["contentDigest"];
  if (typeof contentDigest !== "string" || !DIGEST.test(contentDigest))
    fail("VES_DISTRIBUTION_INPUT_INVALID", "component digest is invalid");
  if (!Number.isSafeInteger(item["sizeBytes"]) || (item["sizeBytes"] as number) <= 0)
    fail("VES_DISTRIBUTION_INPUT_INVALID", "component size is invalid");
  if (typeof item["executable"] !== "boolean") fail("VES_DISTRIBUTION_INPUT_INVALID", "executable is invalid");
  const mustExecute = kind === "node-runtime" || kind === "launcher";
  if (item["executable"] !== mustExecute)
    fail("VES_DISTRIBUTION_INPUT_INVALID", "executable classification is invalid");
  return Object.freeze({
    componentId: string(item["componentId"], "component.componentId"),
    kind: kind as HermeticComponentKind,
    releaseId: componentReleaseId,
    platform: platform as BundlePlatform | "any",
    arch: arch as BundleArch | "any",
    logicalPath: logicalPath(item["logicalPath"]),
    contentDigest: contentDigest as string,
    sizeBytes: item["sizeBytes"] as number,
    licenseRefs: refs(item["licenseRefs"], "licenseRefs"),
    attestationRefs: refs(item["attestationRefs"], "attestationRefs"),
    executable: mustExecute
  });
};

const validateClosure = (components: readonly HermeticBundleComponent[]): void => {
  const ids = new Map(components.map((entry) => [entry.componentId, entry]));
  if (
    ids.size !== components.length ||
    new Set(components.map((entry) => entry.logicalPath)).size !== components.length
  ) {
    fail("VES_DISTRIBUTION_DUPLICATE_COMPONENT", "component identity or path is duplicated");
  }
  for (const kind of REQUIRED_SINGLE_KINDS) {
    if (!components.some((entry) => entry.kind === kind))
      fail("VES_DISTRIBUTION_CLOSURE_INCOMPLETE", `release is missing ${kind}`);
  }
  const launchers = components.filter((entry) => entry.kind === "launcher");
  if (
    launchers.length !== 2 ||
    !launchers.some((entry) => entry.componentId === "launcher:vestra") ||
    !launchers.some((entry) => entry.componentId === "launcher:verchestra")
  ) {
    fail("VES_DISTRIBUTION_CLOSURE_INCOMPLETE", "both canonical launchers are required");
  }
  for (const component of components) {
    if (EVIDENCE_KINDS.has(component.kind)) continue;
    if (component.licenseRefs.length === 0 || component.licenseRefs.some((ref) => ids.get(ref)?.kind !== "license")) {
      fail("VES_DISTRIBUTION_LICENSE_MISSING", `${component.componentId} has no closed license evidence`);
    }
    const attestedKinds = new Set(component.attestationRefs.map((ref) => ids.get(ref)?.kind));
    if (
      component.attestationRefs.length === 0 ||
      component.attestationRefs.some((ref) => !["provenance", "evaluation"].includes(ids.get(ref)?.kind ?? "")) ||
      !attestedKinds.has("provenance") ||
      !attestedKinds.has("evaluation")
    ) {
      fail("VES_DISTRIBUTION_ATTESTATION_MISSING", `${component.componentId} lacks provenance or evaluation evidence`);
    }
  }
};

const normalizeInput = (value: unknown) => {
  const input = record(value, "bundle input");
  exact(
    input,
    ["schemaVersion", "releaseId", "semanticVersion", "createdAt", "target", "runtimeResolver", "components"],
    "bundle input"
  );
  if (input["schemaVersion"] !== 1) fail("VES_DISTRIBUTION_INPUT_INVALID", "schemaVersion must be 1");
  if (input["runtimeResolver"] !== false)
    fail("VES_DISTRIBUTION_INPUT_INVALID", "runtime dependency resolution is forbidden");
  const releaseId = string(input["releaseId"], "releaseId");
  const semanticVersion = string(input["semanticVersion"], "semanticVersion", SEMVER);
  const createdAt = string(input["createdAt"], "createdAt", INSTANT);
  if (!Number.isFinite(Date.parse(createdAt))) fail("VES_DISTRIBUTION_INPUT_INVALID", "createdAt is invalid");
  const target = normalizeTarget(input["target"]);
  if (!Array.isArray(input["components"]) || input["components"].length === 0)
    fail("VES_DISTRIBUTION_CLOSURE_INCOMPLETE", "components are required");
  const components = Object.freeze(
    (input["components"] as unknown[])
      .map((entry) => normalizeComponent(entry, releaseId, target))
      .sort((left, right) => left.componentId.localeCompare(right.componentId))
  );
  validateClosure(components);
  return Object.freeze({
    schemaVersion: 1 as const,
    releaseId,
    semanticVersion,
    createdAt,
    target,
    runtimeResolver: false as const,
    components
  });
};

export function buildHermeticDistributionBundle(value: unknown): HermeticDistributionBundle {
  const manifest = normalizeInput(value);
  return Object.freeze({ ...manifest, releaseDigest: sha(canonical(manifest)) });
}

export function verifyHermeticDistributionBundle(value: unknown): HermeticDistributionBundle {
  const bundle = record(value, "bundle", "VES_DISTRIBUTION_BUNDLE_INVALID");
  exact(
    bundle,
    [
      "schemaVersion",
      "releaseId",
      "semanticVersion",
      "createdAt",
      "target",
      "runtimeResolver",
      "components",
      "releaseDigest"
    ],
    "bundle",
    "VES_DISTRIBUTION_BUNDLE_INVALID"
  );
  if (typeof bundle["releaseDigest"] !== "string" || !DIGEST.test(bundle["releaseDigest"]))
    fail("VES_DISTRIBUTION_BUNDLE_INVALID", "releaseDigest is invalid");
  let rebuilt: HermeticDistributionBundle;
  try {
    rebuilt = buildHermeticDistributionBundle({
      schemaVersion: bundle["schemaVersion"],
      releaseId: bundle["releaseId"],
      semanticVersion: bundle["semanticVersion"],
      createdAt: bundle["createdAt"],
      target: bundle["target"],
      runtimeResolver: bundle["runtimeResolver"],
      components: bundle["components"]
    });
  } catch (error) {
    throw new HermeticBundleError("VES_DISTRIBUTION_BUNDLE_INVALID", "bundle semantic closure is invalid", {
      cause: error
    });
  }
  if (rebuilt.releaseDigest !== bundle["releaseDigest"])
    fail("VES_DISTRIBUTION_BUNDLE_INVALID", "release digest does not match semantic closure");
  return rebuilt;
}
