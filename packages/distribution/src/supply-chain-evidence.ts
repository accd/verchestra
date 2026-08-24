import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { BundleArch, BundlePlatform, HermeticBundleComponent } from "./hermetic-bundle.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const KINDS = ["license", "sbom", "provenance", "evaluation"] as const;
const PATHS = Object.freeze({
  license: "evidence/licenses.json",
  sbom: "evidence/sbom.cdx.json",
  provenance: "evidence/provenance.intoto.jsonl",
  evaluation: "evidence/evaluation.json"
});

export type SupplyChainEvidenceKind = (typeof KINDS)[number];

export interface SupplyChainEvaluation {
  readonly profile: string;
  readonly result: "pass" | "fail" | "blocked";
  readonly assertionCount: number;
  readonly skipped: number;
  readonly todo: number;
  readonly survivingMutants: number;
}

export interface SupplyChainEvidenceInput {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly semanticVersion: string;
  readonly revision: string;
  readonly target: Readonly<{ platform: BundlePlatform; arch: BundleArch; nodeVersion: string }>;
  /** Components already collected from the isolated build, excluding generated evidence. */
  readonly components: readonly HermeticBundleComponent[];
  readonly evaluations: readonly SupplyChainEvaluation[];
}

export interface SupplyChainEvidenceDocument {
  readonly schemaVersion: 1;
  readonly kind: SupplyChainEvidenceKind;
  readonly logicalPath: string;
  readonly contentDigest: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

export class SupplyChainEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SupplyChainEvidenceError";
    this.code = code;
  }
}

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new SupplyChainEvidenceError(code, message, cause === undefined ? undefined : { cause });
};

const codeUnitCompare = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const digestBytes = (bytes: Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const digestHex = (digest: string): string => {
  if (!DIGEST.test(digest)) fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "component digest is invalid");
  return digest.slice("sha256:".length);
};

const validCounter = (value: unknown, positive: boolean): boolean => {
  if (!Number.isSafeInteger(value)) return false;
  return positive ? (value as number) > 0 : (value as number) >= 0;
};

const validateEvaluation = (evaluation: SupplyChainEvaluation, index: number): void => {
  const validProfile = typeof evaluation.profile === "string" && evaluation.profile.length > 0;
  const validResult = ["pass", "fail", "blocked"].includes(evaluation.result);
  const validCounts =
    validCounter(evaluation.assertionCount, true) &&
    validCounter(evaluation.skipped, false) &&
    validCounter(evaluation.todo, false) &&
    validCounter(evaluation.survivingMutants, false);
  if (!validProfile || !validResult || !validCounts)
    fail("VES_DISTRIBUTION_EVIDENCE_EVALUATION_INVALID", `evaluation ${index} is invalid`);
};

const validateIdentity = (input: SupplyChainEvidenceInput): void => {
  if (input.schemaVersion !== 1 || !SAFE_ID.test(input.releaseId) || !SEMVER.test(input.semanticVersion))
    fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "release identity is invalid");
  if (!REVISION.test(input.revision))
    fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "revision must be a lowercase commit SHA");
};

const validateComponents = (components: readonly HermeticBundleComponent[]): void => {
  const ids = new Set<string>();
  for (const [index, component] of components.entries()) {
    if (ids.has(component.componentId))
      fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "component identity is duplicated");
    if (["sbom", "provenance", "evaluation"].includes(component.kind))
      fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "generated evidence cannot be an input component");
    if (!DIGEST.test(component.contentDigest) || !validCounter(component.sizeBytes, true))
      fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", `component ${index} content identity is invalid`);
    ids.add(component.componentId);
  }
};

const validateEvaluations = (evaluations: readonly SupplyChainEvaluation[]): void => {
  const profiles = new Set<string>();
  for (const [index, evaluation] of evaluations.entries()) {
    validateEvaluation(evaluation, index);
    if (profiles.has(evaluation.profile)) fail("VES_DISTRIBUTION_EVIDENCE_EVALUATION_INVALID", "profile is duplicated");
    profiles.add(evaluation.profile);
  }
};

const validateInput = (input: SupplyChainEvidenceInput): void => {
  if (input === null || typeof input !== "object")
    fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "evidence input must be an object");
  validateIdentity(input);
  if (!Array.isArray(input.components) || input.components.length === 0)
    fail("VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID", "components are required");
  if (!Array.isArray(input.evaluations) || input.evaluations.length === 0)
    fail("VES_DISTRIBUTION_EVIDENCE_EVALUATION_INVALID", "at least one evaluation profile is required");
  validateComponents(input.components);
  validateEvaluations(input.evaluations);
};

const sortedComponents = (components: readonly HermeticBundleComponent[]) =>
  [...components].sort((left, right) => codeUnitCompare(left.componentId, right.componentId));

const sortedEvaluations = (evaluations: readonly SupplyChainEvaluation[]) =>
  [...evaluations].sort((left, right) => codeUnitCompare(left.profile, right.profile));

const licensePayload = (input: SupplyChainEvidenceInput, components: readonly HermeticBundleComponent[]) => ({
  schemaVersion: 1,
  releaseId: input.releaseId,
  revision: input.revision,
  licenses: components
    .filter((component) => component.kind === "license")
    .map((component) => ({
      componentId: component.componentId,
      logicalPath: component.logicalPath,
      contentDigest: component.contentDigest,
      sizeBytes: component.sizeBytes
    })),
  componentReferences: components.map((component) => ({
    componentId: component.componentId,
    licenseRefs: component.licenseRefs
  }))
});

const sbomPayload = (input: SupplyChainEvidenceInput, components: readonly HermeticBundleComponent[]) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:verchestra:${input.releaseId}:${input.revision}`,
  version: 1,
  metadata: { component: { name: input.releaseId, version: input.semanticVersion } },
  components: components.map((component) => ({
    "bom-ref": component.componentId,
    type: component.executable ? "application" : "library",
    name: component.componentId,
    version: input.semanticVersion,
    hashes: [{ alg: "SHA-256", content: digestHex(component.contentDigest) }],
    licenses: component.licenseRefs.map((licenseRef) => ({ license: { id: licenseRef } }))
  }))
});

const provenancePayload = (input: SupplyChainEvidenceInput, components: readonly HermeticBundleComponent[]) => ({
  _type: "https://in-toto.io/Statement/v1",
  subject: components.map((component) => ({
    name: component.logicalPath,
    digest: { sha256: digestHex(component.contentDigest) }
  })),
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://verchestra.dev/build/hermetic/v1",
      externalParameters: {
        releaseId: input.releaseId,
        semanticVersion: input.semanticVersion,
        revision: input.revision,
        target: input.target
      }
    },
    runDetails: { builder: { id: "verchestra:isolated-build" } }
  }
});

const evaluationPayload = (input: SupplyChainEvidenceInput) => {
  const profiles = sortedEvaluations(input.evaluations);
  return {
    schemaVersion: 1,
    releaseId: input.releaseId,
    revision: input.revision,
    profiles,
    summary: {
      profileCount: profiles.length,
      failedProfiles: profiles.filter((profile) => profile.result !== "pass").length,
      skippedCases: profiles.reduce((total, profile) => total + profile.skipped, 0),
      todoCases: profiles.reduce((total, profile) => total + profile.todo, 0),
      survivingMutants: profiles.reduce((total, profile) => total + profile.survivingMutants, 0)
    }
  };
};

const document = (kind: SupplyChainEvidenceKind, payload: unknown): SupplyChainEvidenceDocument => {
  const bytes = Buffer.from(canonicalizeJsonV2(payload), "utf8");
  return Object.freeze({
    schemaVersion: 1 as const,
    kind,
    logicalPath: PATHS[kind],
    contentDigest: digestBytes(bytes),
    sizeBytes: bytes.byteLength,
    bytes: new Uint8Array(bytes)
  });
};

/** Build unsigned, deterministic supply-chain documents from collected bytes. */
export function buildSupplyChainEvidence(input: SupplyChainEvidenceInput): readonly SupplyChainEvidenceDocument[] {
  validateInput(input);
  const components = sortedComponents(input.components);
  return Object.freeze([
    document("license", licensePayload(input, components)),
    document("sbom", sbomPayload(input, components)),
    document("provenance", provenancePayload(input, components)),
    document("evaluation", evaluationPayload(input))
  ]);
}

const assertDocumentShape = (item: Record<string, unknown>): void => {
  const kind = item["kind"] as SupplyChainEvidenceKind;
  const valid =
    item["schemaVersion"] === 1 &&
    typeof item["kind"] === "string" &&
    KINDS.includes(kind) &&
    typeof item["logicalPath"] === "string" &&
    typeof item["contentDigest"] === "string" &&
    Number.isSafeInteger(item["sizeBytes"]) &&
    item["bytes"] instanceof Uint8Array;
  if (!valid) fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence document shape is invalid");
};

const assertDocumentIdentity = (
  item: Record<string, unknown>,
  kind: SupplyChainEvidenceKind,
  bytes: Uint8Array
): void => {
  if (
    item["logicalPath"] !== PATHS[kind] ||
    item["contentDigest"] !== digestBytes(bytes) ||
    item["sizeBytes"] !== bytes.byteLength
  )
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence document identity is invalid");
};

const decodeCanonical = (bytes: Uint8Array): void => {
  const text = Buffer.from(bytes).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence bytes are not JSON", error);
  }
  if (canonicalizeJsonV2(parsed) !== text)
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence bytes are not canonical JSON");
};

const parseDocument = (value: unknown): SupplyChainEvidenceDocument => {
  if (value === null || typeof value !== "object")
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence document must be an object");
  const item = value as Record<string, unknown>;
  assertDocumentShape(item);
  const kind = item["kind"] as SupplyChainEvidenceKind;
  const bytes = item["bytes"] as Uint8Array;
  assertDocumentIdentity(item, kind, bytes);
  decodeCanonical(bytes);
  return Object.freeze({
    schemaVersion: 1,
    kind,
    logicalPath: item["logicalPath"] as string,
    contentDigest: item["contentDigest"] as string,
    sizeBytes: item["sizeBytes"] as number,
    bytes: new Uint8Array(bytes)
  });
};

export function verifySupplyChainEvidence(
  documents: readonly SupplyChainEvidenceDocument[]
): readonly SupplyChainEvidenceDocument[] {
  if (!Array.isArray(documents) || documents.length !== KINDS.length)
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "exactly four evidence documents are required");
  const verified = documents.map(parseDocument);
  if (new Set(verified.map((item) => item.kind)).size !== KINDS.length)
    fail("VES_DISTRIBUTION_EVIDENCE_INVALID", "evidence kinds must be unique");
  return Object.freeze([...verified].sort((left, right) => codeUnitCompare(left.kind, right.kind)));
}
