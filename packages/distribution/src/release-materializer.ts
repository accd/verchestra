import {
  collectHermeticArtifactInputsFromFiles,
  type ArtifactInputSource,
  type CollectedArtifactInput,
  type FileBackedBundleInput
} from "./artifact-inputs.ts";
import {
  buildHermeticDistributionBundle,
  type BundleArch,
  type BundlePlatform,
  type HermeticBundleComponent,
  type HermeticDistributionBundle
} from "./hermetic-bundle.ts";
import {
  buildSupplyChainEvidence,
  type SupplyChainEvidenceDocument,
  type SupplyChainEvaluation
} from "./supply-chain-evidence.ts";

const GENERATED_KINDS = new Set(["sbom", "provenance", "evaluation"]);
const GENERATED_COMPONENT_IDS = Object.freeze({
  license: "license:closure",
  sbom: "sbom:cyclonedx",
  provenance: "provenance:build",
  evaluation: "evaluation:release"
});

export interface HermeticReleaseMaterializationInput extends FileBackedBundleInput {
  readonly revision: string;
  readonly evaluations: readonly SupplyChainEvaluation[];
}

export interface MaterializedReleaseComponentBytes {
  readonly logicalPath: string;
  readonly bytes: Uint8Array;
}

export interface HermeticReleaseMaterialization {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly revision: string;
  readonly target: Readonly<{ platform: BundlePlatform; arch: BundleArch; nodeVersion: string }>;
  readonly bundle: HermeticDistributionBundle;
  readonly sourceArtifacts: readonly CollectedArtifactInput[];
  readonly evidence: readonly SupplyChainEvidenceDocument[];
  readonly componentBytes: readonly MaterializedReleaseComponentBytes[];
}

export class HermeticReleaseMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HermeticReleaseMaterializationError";
    this.code = code;
  }
}

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new HermeticReleaseMaterializationError(code, message, cause === undefined ? undefined : { cause });
};

const codeUnitCompare = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const generatedComponent = (document: SupplyChainEvidenceDocument, releaseId: string): HermeticBundleComponent =>
  Object.freeze({
    componentId: GENERATED_COMPONENT_IDS[document.kind],
    kind: document.kind,
    releaseId,
    platform: "any",
    arch: "any",
    logicalPath: document.logicalPath,
    contentDigest: document.contentDigest,
    sizeBytes: document.sizeBytes,
    licenseRefs: Object.freeze([]),
    attestationRefs: Object.freeze([]),
    executable: false
  });

const validateSources = (sources: readonly ArtifactInputSource[]): void => {
  for (const [index, source] of sources.entries()) {
    if (GENERATED_KINDS.has(source.kind))
      fail(
        "VES_DISTRIBUTION_MATERIALIZATION_GENERATED_INPUT",
        `source ${index} is generated evidence and must be produced by the materializer`
      );
  }
};

const sourceComponentBytes = (
  artifacts: readonly CollectedArtifactInput[]
): readonly MaterializedReleaseComponentBytes[] =>
  artifacts
    .map(({ component, bytes }) => Object.freeze({ logicalPath: component.logicalPath, bytes: new Uint8Array(bytes) }))
    .sort((left, right) => codeUnitCompare(left.logicalPath, right.logicalPath));

/**
 * Materialize the complete bundle closure from one isolated build root. The
 * source bytes are read once, the four evidence documents are generated from
 * those observed identities, and only then is the strict bundle verifier run.
 */
export async function materializeHermeticReleaseFromFiles(
  input: HermeticReleaseMaterializationInput
): Promise<HermeticReleaseMaterialization> {
  if (input === null || typeof input !== "object")
    fail("VES_DISTRIBUTION_MATERIALIZATION_INPUT_INVALID", "materialization input must be an object");
  if (typeof input.revision !== "string" || !/^[0-9a-f]{40}$/u.test(input.revision))
    fail("VES_DISTRIBUTION_MATERIALIZATION_INPUT_INVALID", "revision must be a lowercase commit SHA");
  if (!Array.isArray(input.evaluations) || input.evaluations.length === 0)
    fail("VES_DISTRIBUTION_MATERIALIZATION_EVALUATION_INVALID", "evaluations are required");
  validateSources(input.sources);
  const sourceArtifacts = await collectHermeticArtifactInputsFromFiles(input);
  const sourceComponents = sourceArtifacts.map(({ component }) => component);
  const evidence = buildSupplyChainEvidence({
    schemaVersion: 1,
    releaseId: input.releaseId,
    semanticVersion: input.semanticVersion,
    revision: input.revision,
    target: input.target,
    components: sourceComponents,
    evaluations: input.evaluations
  });
  const evidenceComponents = evidence.map((document) => generatedComponent(document, input.releaseId));
  const componentIds = new Set(sourceComponents.map((component) => component.componentId));
  for (const component of evidenceComponents) {
    if (componentIds.has(component.componentId))
      fail("VES_DISTRIBUTION_MATERIALIZATION_DUPLICATE", `generated component ${component.componentId} is duplicated`);
  }
  const bundle = buildHermeticDistributionBundle({
    schemaVersion: input.schemaVersion,
    releaseId: input.releaseId,
    semanticVersion: input.semanticVersion,
    createdAt: input.createdAt,
    target: input.target,
    runtimeResolver: input.runtimeResolver,
    components: [...sourceComponents, ...evidenceComponents]
  });
  const componentBytes = Object.freeze(
    [
      ...sourceComponentBytes(sourceArtifacts),
      ...evidence.map((document) =>
        Object.freeze({ logicalPath: document.logicalPath, bytes: new Uint8Array(document.bytes) })
      )
    ].sort((left, right) => codeUnitCompare(left.logicalPath, right.logicalPath))
  );
  const orderedSourceArtifacts = Object.freeze(
    [...sourceArtifacts].sort((left, right) => codeUnitCompare(left.component.componentId, right.component.componentId))
  );
  return Object.freeze({
    schemaVersion: 1,
    releaseId: input.releaseId,
    revision: input.revision,
    target: input.target,
    bundle,
    sourceArtifacts: orderedSourceArtifacts,
    evidence,
    componentBytes
  });
}
