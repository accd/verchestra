export type ProjectPlacement = "inherit" | "colocated" | "centralized";
export type EffectivePlacement = "colocated" | "centralized";
export type WorkspacePlacementMode = "colocated" | "centralized" | "mixed" | "external-control";

export interface PlacementProject {
  readonly projectId: string;
  readonly slug: string;
  readonly sourceLogicalPath: string;
  readonly gitOwnerId: string | null;
  readonly gitRelation: "control" | "nested" | "submodule" | "worktree" | "placeholder";
  readonly ignoredByControl: boolean;
  readonly placement: ProjectPlacement;
  readonly nestedWriteAuthorized: boolean;
}

export interface PlacementSnapshot {
  readonly schemaVersion: 1;
  readonly controlOwnerId: string;
  readonly placementMode: WorkspacePlacementMode;
  readonly defaultProjectPlacement: Exclude<ProjectPlacement, "inherit">;
  readonly nestedGitDefault: Exclude<ProjectPlacement, "inherit">;
  readonly requireExplicitNestedRepositoryWrites: boolean;
  readonly projects: readonly PlacementProject[];
}

export type ProjectArtifactClass =
  | "project-manifest"
  | "spec"
  | "gate"
  | "data"
  | "evaluation"
  | "reversa"
  | "evidence"
  | "context"
  | "agent-instructions";

export type LogicalArtifactAddress =
  | Readonly<{
      scope: "workspace";
      artifactClass: "workspace-manifest";
      logicalName: string;
    }>
  | Readonly<{
      scope: "project";
      projectId: string;
      artifactClass: ProjectArtifactClass;
      logicalName: string;
    }>;

export interface ResolvedArtifact {
  readonly placement: "control" | EffectivePlacement;
  readonly gitOwnerId: string;
  readonly logicalPath: string;
  readonly projectId?: string;
}

export interface DesiredArtifact {
  readonly address: LogicalArtifactAddress;
  readonly contentDigest: string;
  readonly generatorVersion: string;
  readonly lifecyclePolicy: string;
}

export interface PlannedWrite extends ResolvedArtifact {
  readonly contentDigest: string;
  readonly generatorVersion: string;
  readonly lifecyclePolicy: string;
}

export interface WritePlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly ownerIds: readonly string[];
  readonly writes: readonly PlannedWrite[];
}

export interface ArtifactPlanningPort {
  readonly createWritePlan: (desired: readonly DesiredArtifact[], snapshot: PlacementSnapshot) => WritePlan;
}
