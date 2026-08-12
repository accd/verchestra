import { LogicalPath, StableId, canonicalizeJsonV2 } from "@verchestra/domain";

import { SyncError } from "./sync-errors.ts";

export interface ContentDigestPort {
  sha256(value: string): string;
}

export interface GenerationSnapshot {
  readonly release: string;
  readonly config: string;
  readonly skills: string;
  readonly data: string;
  readonly integrations: string;
}

export interface ProjectRegistration {
  readonly projectId: string;
  readonly logicalPath: string;
  readonly state: "active" | "retired";
  readonly predecessorProjectIds: readonly string[];
}

export interface ProjectionMapping {
  readonly projectionId: string;
  readonly projectId: string;
  readonly connectorId: string;
  readonly canonicalDigest: string;
  readonly observedRemoteDigest: string;
  readonly observedRemoteVersion?: string;
}

export interface IngestionManifestRef {
  readonly manifestId: string;
  readonly sourceDigest: string;
}

export interface CanonicalSyncConfiguration {
  readonly schemaVersion: number;
  readonly minimumCliVersion: string;
  readonly workspaceId: string;
  readonly generations: GenerationSnapshot;
  readonly projects: readonly ProjectRegistration[];
  readonly projections: readonly ProjectionMapping[];
  readonly ingestionManifests: readonly IngestionManifestRef[];
}

export interface PersistedSyncState {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly generations: GenerationSnapshot;
  readonly projects: readonly ProjectRegistration[];
  readonly projections: readonly ProjectionMapping[];
  readonly ingestionManifests: readonly IngestionManifestRef[];
  readonly stateDigest: string;
}

export interface SyncStateStorePort {
  load(workspaceId: string): Promise<PersistedSyncState | undefined>;
  save(state: PersistedSyncState): Promise<{ readonly changed: boolean }>;
}

export interface UncertainEffect {
  readonly effectId: string;
  readonly connectorId: string;
  readonly correlationMarker: string;
  readonly inputDigest: string;
}

export type ReconciliationDirection = "accept" | "canonical-to-remote" | "remote-to-canonical";

export interface WorkspaceReconcileInput {
  readonly installedCliVersion: string;
  readonly configuration: CanonicalSyncConfiguration;
  readonly directions: Readonly<Record<string, ReconciliationDirection>>;
  readonly uncertainEffects: readonly UncertainEffect[];
}

export interface ReconcileOperation {
  readonly operationId: string;
  readonly kind: "added" | "moved" | "missing" | "split" | "merged" | "retired" | "projection-drift";
  readonly projectIds: readonly string[];
  readonly fromPaths: readonly string[];
  readonly toPaths: readonly string[];
  readonly destructive: boolean;
  readonly directionRequired: boolean;
}

export type PlannedEffect =
  | {
      readonly kind: "upsert-projection" | "import-remote-projection";
      readonly projectionId: string;
      readonly connectorId: string;
      readonly canonicalDigest: string;
      readonly observedRemoteDigest: string;
      readonly expectedRemoteVersion?: string;
    }
  | ({ readonly kind: "reconcile-effect"; readonly retryProhibited: true } & UncertainEffect);

export interface LocalRebuildRequirement {
  readonly requirementId: string;
  readonly source: "canonical-sources-and-ingestion-manifests";
  readonly changedGenerations: readonly string[];
  readonly manifestIds: readonly string[];
  readonly projectIds: readonly string[];
}

export interface WorkspaceReconcileResult {
  readonly status: "reconciled" | "direction-required";
  readonly operations: readonly ReconcileOperation[];
  readonly unresolvedDirections: readonly string[];
  readonly effects: readonly PlannedEffect[];
  readonly localRebuildRequirements: readonly LocalRebuildRequirement[];
  readonly stateDigest: string;
  readonly planDigest: string;
  readonly stateChanged: boolean;
}

const SUPPORTED_SCHEMA_VERSION = 1;
const GENERATION_KEYS = ["release", "config", "skills", "data", "integrations"] as const;

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Code-unit comparison, not localeCompare: every sorted ID here (project,
// projection, manifest, operation, effect) is a StableId `kind_uuid` value
// (packages/domain/src/primitives/stable-id.ts), constrained to lowercase
// ASCII letters, digits, and hyphens -- a character set for which code-unit
// and locale-aware collation cannot diverge. Sort order also feeds the
// persisted state and plan digests directly (AD-015, issue #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function normalizeConfiguration(configuration: CanonicalSyncConfiguration): Omit<PersistedSyncState, "stateDigest"> {
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: configuration.workspaceId,
    generations: Object.freeze({ ...configuration.generations }),
    projects: Object.freeze(
      configuration.projects
        .map((entry) => Object.freeze({ ...entry, predecessorProjectIds: sortedUnique(entry.predecessorProjectIds) }))
        .sort((left, right) => codeUnitCompare(left.projectId, right.projectId))
    ),
    projections: Object.freeze(
      configuration.projections
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) => codeUnitCompare(left.projectionId, right.projectionId))
    ),
    ingestionManifests: Object.freeze(
      configuration.ingestionManifests
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) => codeUnitCompare(left.manifestId, right.manifestId))
    )
  });
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    throw new SyncError("VES_SYNC_INPUT_INVALID", `${label} is invalid`);
  }
}

function assertCompatible(input: WorkspaceReconcileInput): void {
  const { configuration } = input;
  if (configuration.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new SyncError("VES_SYNC_CONFIG_INCOMPATIBLE", "Canonical sync schema requires a newer release", {
      minimumCompatibleRelease: "2.0.0"
    });
  }
  if (compareVersions(input.installedCliVersion, configuration.minimumCliVersion) < 0) {
    throw new SyncError("VES_SYNC_CONFIG_INCOMPATIBLE", "Installed CLI is older than canonical configuration", {
      minimumCompatibleRelease: configuration.minimumCliVersion
    });
  }
}

function assertValid(configuration: CanonicalSyncConfiguration): void {
  try {
    StableId.parse(configuration.workspaceId, "workspace");
  } catch (error) {
    throw new SyncError("VES_SYNC_INPUT_INVALID", "Workspace identity is invalid", {}, { cause: error });
  }
  const projectIds = new Set<string>();
  const paths = new Set<string>();
  for (const key of GENERATION_KEYS) assertNonEmpty(configuration.generations[key], `${key} generation`);
  for (const entry of configuration.projects) {
    try {
      StableId.parse(entry.projectId, "project");
      if (entry.logicalPath !== ".") LogicalPath.parse(entry.logicalPath);
      for (const predecessor of entry.predecessorProjectIds) StableId.parse(predecessor, "project");
    } catch (error) {
      throw new SyncError(
        "VES_SYNC_INPUT_INVALID",
        "Project identity, path, or lineage is invalid",
        {},
        {
          cause: error
        }
      );
    }
    if (
      projectIds.has(entry.projectId) ||
      paths.has(entry.logicalPath) ||
      entry.predecessorProjectIds.includes(entry.projectId)
    ) {
      throw new SyncError("VES_SYNC_INPUT_INVALID", "Project registry contains ambiguous identity or lineage");
    }
    projectIds.add(entry.projectId);
    paths.add(entry.logicalPath);
  }
  const projectionIds = new Set<string>();
  for (const entry of configuration.projections) {
    assertNonEmpty(entry.projectionId, "Projection ID");
    assertNonEmpty(entry.connectorId, "Connector ID");
    assertNonEmpty(entry.canonicalDigest, "Projection canonical digest");
    assertNonEmpty(entry.observedRemoteDigest, "Projection remote digest");
    if (projectionIds.has(entry.projectionId) || !projectIds.has(entry.projectId)) {
      throw new SyncError("VES_SYNC_INPUT_INVALID", "Projection mapping is ambiguous or references an unknown Project");
    }
    projectionIds.add(entry.projectionId);
  }
  const manifestIds = configuration.ingestionManifests.map((entry) => entry.manifestId);
  for (const entry of configuration.ingestionManifests) {
    assertNonEmpty(entry.manifestId, "Ingestion manifest ID");
    assertNonEmpty(entry.sourceDigest, "Ingestion manifest source digest");
  }
  if (new Set(manifestIds).size !== manifestIds.length) {
    throw new SyncError("VES_SYNC_INPUT_INVALID", "Ingestion manifest IDs must be unique");
  }
}

function assertRecoveryInputs(effects: readonly UncertainEffect[]): void {
  const effectIds = new Set<string>();
  for (const entry of effects) {
    assertNonEmpty(entry.effectId, "Uncertain effect ID");
    assertNonEmpty(entry.connectorId, "Uncertain effect Connector ID");
    assertNonEmpty(entry.correlationMarker, "Uncertain effect correlation marker");
    assertNonEmpty(entry.inputDigest, "Uncertain effect input digest");
    if (effectIds.has(entry.effectId)) {
      throw new SyncError("VES_SYNC_INPUT_INVALID", "Uncertain effect IDs must be unique");
    }
    effectIds.add(entry.effectId);
  }
}

function operation(
  operationId: string,
  kind: ReconcileOperation["kind"],
  projectIds: readonly string[],
  fromPaths: readonly string[],
  toPaths: readonly string[],
  destructive: boolean
): ReconcileOperation {
  return Object.freeze({
    operationId,
    kind,
    projectIds: sortedUnique(projectIds),
    fromPaths: sortedUnique(fromPaths),
    toPaths: sortedUnique(toPaths),
    destructive,
    directionRequired: destructive || kind === "projection-drift"
  });
}

function topologyOperations(
  previous: PersistedSyncState | undefined,
  current: Omit<PersistedSyncState, "stateDigest">
): readonly ReconcileOperation[] {
  const prior = new Map((previous?.projects ?? []).map((entry) => [entry.projectId, entry]));
  const next = new Map(current.projects.map((entry) => [entry.projectId, entry]));
  const operations: ReconcileOperation[] = [];
  const lineageGroups = new Map<string, ProjectRegistration[]>();
  for (const entry of current.projects) {
    for (const predecessor of entry.predecessorProjectIds) {
      const group = lineageGroups.get(predecessor) ?? [];
      group.push(entry);
      lineageGroups.set(predecessor, group);
    }
  }
  const consumedPredecessors = new Set<string>();
  for (const [predecessor, successors] of lineageGroups) {
    if (successors.length >= 2 && prior.has(predecessor)) {
      operations.push(
        operation(
          `split:${predecessor}`,
          "split",
          [predecessor, ...successors.map((entry) => entry.projectId)],
          [prior.get(predecessor)?.logicalPath ?? ""],
          successors.map((entry) => entry.logicalPath),
          true
        )
      );
      consumedPredecessors.add(predecessor);
    }
  }
  for (const entry of current.projects) {
    const known = prior.get(entry.projectId);
    if (known !== undefined) {
      if (known.logicalPath !== entry.logicalPath) {
        operations.push(
          operation(
            `move:${entry.projectId}`,
            "moved",
            [entry.projectId],
            [known.logicalPath],
            [entry.logicalPath],
            true
          )
        );
      }
      if (known.state !== "retired" && entry.state === "retired") {
        operations.push(
          operation(
            `retire:${entry.projectId}`,
            "retired",
            [entry.projectId],
            [known.logicalPath],
            [entry.logicalPath],
            true
          )
        );
      }
      continue;
    }
    if (entry.predecessorProjectIds.length >= 2 && entry.predecessorProjectIds.every((id) => prior.has(id))) {
      operations.push(
        operation(
          `merge:${entry.projectId}`,
          "merged",
          [...entry.predecessorProjectIds, entry.projectId],
          entry.predecessorProjectIds.map((id) => prior.get(id)?.logicalPath ?? ""),
          [entry.logicalPath],
          true
        )
      );
      entry.predecessorProjectIds.forEach((id) => consumedPredecessors.add(id));
    } else if (![...lineageGroups.values()].some((group) => group.length >= 2 && group.includes(entry))) {
      operations.push(operation(`add:${entry.projectId}`, "added", [entry.projectId], [], [entry.logicalPath], false));
    }
  }
  for (const entry of prior.values()) {
    if (!next.has(entry.projectId) && !consumedPredecessors.has(entry.projectId)) {
      operations.push(
        operation(`missing:${entry.projectId}`, "missing", [entry.projectId], [entry.logicalPath], [], true)
      );
    }
  }
  return operations.sort((left, right) => codeUnitCompare(left.operationId, right.operationId));
}

function projectionOperations(
  previous: PersistedSyncState | undefined,
  current: Omit<PersistedSyncState, "stateDigest">
): readonly ReconcileOperation[] {
  const prior = new Map((previous?.projections ?? []).map((entry) => [entry.projectionId, entry]));
  return current.projections
    .filter((entry) => {
      const baseline = prior.get(entry.projectionId);
      return baseline !== undefined && entry.observedRemoteDigest !== baseline.observedRemoteDigest;
    })
    .map((entry) =>
      operation(`projection-drift:${entry.projectionId}`, "projection-drift", [entry.projectId], [], [], false)
    );
}

function changedGenerations(
  previous: PersistedSyncState | undefined,
  current: Omit<PersistedSyncState, "stateDigest">
): readonly string[] {
  if (previous === undefined) return [...GENERATION_KEYS];
  return GENERATION_KEYS.filter((key) => previous.generations[key] !== current.generations[key]);
}

function rebuildRequirements(
  previous: PersistedSyncState | undefined,
  current: Omit<PersistedSyncState, "stateDigest">,
  topology: readonly ReconcileOperation[],
  digest: ContentDigestPort
): readonly LocalRebuildRequirement[] {
  const changed = changedGenerations(previous, current);
  const manifestsChanged =
    canonicalizeJsonV2(previous?.ingestionManifests ?? []) !== canonicalizeJsonV2(current.ingestionManifests);
  if (changed.length === 0 && !manifestsChanged && topology.length === 0) return [];
  const material = canonicalizeJsonV2({ changed, manifests: current.ingestionManifests, projects: current.projects });
  return [
    Object.freeze({
      requirementId: `rebuild:${digest.sha256(material).slice(7, 23)}`,
      source: "canonical-sources-and-ingestion-manifests",
      changedGenerations: Object.freeze(changed),
      manifestIds: Object.freeze(current.ingestionManifests.map((entry) => entry.manifestId)),
      projectIds: Object.freeze(current.projects.map((entry) => entry.projectId))
    })
  ];
}

export class WorkspaceReconcileService {
  readonly #store: SyncStateStorePort;
  readonly #digest: ContentDigestPort;

  constructor(options: { readonly store: SyncStateStorePort; readonly digest: ContentDigestPort }) {
    this.#store = options.store;
    this.#digest = options.digest;
  }

  async execute(input: WorkspaceReconcileInput): Promise<WorkspaceReconcileResult> {
    assertCompatible(input);
    assertValid(input.configuration);
    assertRecoveryInputs(input.uncertainEffects);
    const current = normalizeConfiguration(input.configuration);
    const previous = await this.#store.load(input.configuration.workspaceId);
    if (previous !== undefined && previous.workspaceId !== input.configuration.workspaceId) {
      throw new SyncError("VES_SYNC_STATE_INVALID", "Stored sync state belongs to another Workspace");
    }
    if (previous !== undefined) {
      const { stateDigest: recordedDigest, ...stateMaterial } = previous;
      if (this.#digest.sha256(canonicalizeJsonV2(stateMaterial)) !== recordedDigest) {
        throw new SyncError("VES_SYNC_STATE_INVALID", "Stored sync state digest does not match its content");
      }
    }
    const topology = topologyOperations(previous, current);
    const projections = projectionOperations(previous, current);
    const operations = Object.freeze(
      [...topology, ...projections].sort((a, b) => codeUnitCompare(a.operationId, b.operationId))
    );
    const unresolvedDirections = Object.freeze(
      operations
        .filter((entry) => {
          if (!entry.directionRequired) return false;
          const direction = input.directions[entry.operationId];
          return entry.kind === "projection-drift"
            ? direction !== "canonical-to-remote" && direction !== "remote-to-canonical"
            : direction !== "accept";
        })
        .map((entry) => entry.operationId)
    );
    const effects: PlannedEffect[] = [];
    for (const entry of current.projections) {
      const direction = input.directions[`projection-drift:${entry.projectionId}`];
      if (direction === "canonical-to-remote" || direction === "remote-to-canonical") {
        effects.push(
          Object.freeze({
            kind: direction === "canonical-to-remote" ? "upsert-projection" : "import-remote-projection",
            projectionId: entry.projectionId,
            connectorId: entry.connectorId,
            canonicalDigest: entry.canonicalDigest,
            observedRemoteDigest: entry.observedRemoteDigest,
            ...(entry.observedRemoteVersion === undefined ? {} : { expectedRemoteVersion: entry.observedRemoteVersion })
          })
        );
      }
    }
    effects.push(
      ...input.uncertainEffects
        .map((entry) => Object.freeze({ kind: "reconcile-effect" as const, ...entry, retryProhibited: true as const }))
        .sort((left, right) => codeUnitCompare(left.effectId, right.effectId))
    );
    const localRebuildRequirements =
      unresolvedDirections.length === 0 ? rebuildRequirements(previous, current, topology, this.#digest) : [];
    let stateDigest = previous?.stateDigest ?? this.#digest.sha256(canonicalizeJsonV2(current));
    let stateChanged = false;
    if (unresolvedDirections.length === 0) {
      stateDigest = this.#digest.sha256(canonicalizeJsonV2(current));
      const receipt = await this.#store.save(Object.freeze({ ...current, stateDigest }));
      stateChanged = receipt.changed;
    }
    const planMaterial = { operations, unresolvedDirections, effects, localRebuildRequirements, stateDigest };
    return Object.freeze({
      status: unresolvedDirections.length === 0 ? "reconciled" : "direction-required",
      operations,
      unresolvedDirections,
      effects: Object.freeze(effects),
      localRebuildRequirements: Object.freeze(localRebuildRequirements),
      stateDigest,
      planDigest: this.#digest.sha256(canonicalizeJsonV2(planMaterial)),
      stateChanged
    });
  }
}
