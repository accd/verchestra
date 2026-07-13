export const packageName = "@verchestra/agent-runtime" as const;
export {
  InMemoryPassportStore,
  ModelPassportError,
  ModelPassportRegistry,
  type MachinePassportIndex,
  type PassportCandidate,
  type PassportRecord,
  type PassportSignerPort,
  type PassportStorePort
} from "./models/passport-registry.ts";
export {
  BackendContextSerializer,
  ContextSerializationError,
  SemanticEquivalenceOracle,
  type ContextBackendTarget,
  type ContextCapacityEstimatorPort,
  type NeutralSemanticTree,
  type SerializedContext
} from "./context/backend-serializers.ts";
export {
  ContextCompilerError,
  DeterministicContextCompiler,
  type CompiledContextFragment,
  type ContextManifest,
  type ContextManifestSignerPort,
  type ContextOmission
} from "./context/context-compiler.ts";
export {
  ContextSnapshotResolver,
  ContextSourceError,
  FixtureContextSource,
  contextRecipeDigest,
  type ContextClaimInput,
  type ContextFragmentInput,
  type ContextRecipe,
  type ContextSnapshot,
  type ContextSourceKind,
  type ContextSourceObservation,
  type ContextSourcePort,
  type ContextSourcePorts,
  type ContextSourceQuery,
  type ContextSourceSelector,
  type ContextSourceStatus,
  type ResolvedContextFragment,
  type ResolvedContextSource
} from "./context/source-snapshots.ts";
