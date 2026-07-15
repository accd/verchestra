import { Digest, LogicalPath, StableId } from "@verchestra/domain";
import type {
  DesiredArtifact,
  EffectivePlacement,
  LogicalArtifactAddress,
  PlacementProject,
  PlacementSnapshot,
  PlannedWrite,
  ProjectArtifactClass,
  ResolvedArtifact,
  WritePlan
} from "@verchestra/application";

export type {
  DesiredArtifact,
  EffectivePlacement,
  LogicalArtifactAddress,
  PlacementProject,
  PlacementSnapshot,
  PlannedWrite,
  ProjectArtifactClass,
  ProjectPlacement,
  ResolvedArtifact,
  WorkspacePlacementMode,
  WritePlan
} from "@verchestra/application";

import { buildInventoryFingerprint, WorkspaceScanError } from "../scanner/scanner-primitives.ts";

function placementError(code: string, message: string, options?: ErrorOptions): WorkspaceScanError {
  return new WorkspaceScanError(code, message, options);
}

function validateOwner(value: string): void {
  try {
    Digest.parse(value);
  } catch (error) {
    throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Git owner ID is invalid", { cause: error });
  }
}

function validateProject(candidate: PlacementProject): void {
  try {
    StableId.parse(candidate.projectId, "project");
    if (candidate.sourceLogicalPath !== ".") LogicalPath.parse(candidate.sourceLogicalPath);
  } catch (error) {
    throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Project identity or source path is invalid", {
      cause: error
    });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate.slug)) {
    throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Project slug is invalid");
  }
  if (
    !new Set(["inherit", "colocated", "centralized"]).has(candidate.placement) ||
    !new Set(["control", "nested", "submodule", "worktree", "placeholder"]).has(candidate.gitRelation) ||
    typeof candidate.ignoredByControl !== "boolean" ||
    typeof candidate.nestedWriteAuthorized !== "boolean"
  ) {
    throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Project placement vocabulary is invalid");
  }
  if (candidate.gitOwnerId !== null) validateOwner(candidate.gitOwnerId);
}

function validateSnapshot(snapshot: PlacementSnapshot): void {
  validateOwner(snapshot.controlOwnerId);
  if (
    snapshot.schemaVersion !== 1 ||
    !new Set(["colocated", "centralized", "mixed", "external-control"]).has(snapshot.placementMode) ||
    !new Set(["colocated", "centralized"]).has(snapshot.defaultProjectPlacement) ||
    !new Set(["colocated", "centralized"]).has(snapshot.nestedGitDefault)
  ) {
    throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Placement snapshot vocabulary is invalid");
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const candidate of snapshot.projects) {
    validateProject(candidate);
    if (ids.has(candidate.projectId) || slugs.has(candidate.slug)) {
      throw placementError("VES_PLACEMENT_SNAPSHOT_INVALID", "Project IDs and slugs must be unique");
    }
    ids.add(candidate.projectId);
    slugs.add(candidate.slug);
  }
}

function isIndependent(candidate: PlacementProject): boolean {
  return new Set(["nested", "submodule", "worktree"]).has(candidate.gitRelation);
}

export function effectivePlacement(candidate: PlacementProject, snapshot: PlacementSnapshot): EffectivePlacement {
  validateSnapshot(snapshot);
  validateProject(candidate);
  if (snapshot.placementMode === "centralized" || snapshot.placementMode === "external-control") {
    return "centralized";
  }
  if (candidate.placement === "centralized") return "centralized";
  if (candidate.placement === "colocated") {
    if (candidate.gitOwnerId === null) {
      throw placementError("VES_PLACEMENT_OWNER_REQUIRED", "Colocated placement requires an active Git owner");
    }
    if (
      isIndependent(candidate) &&
      snapshot.requireExplicitNestedRepositoryWrites &&
      candidate.nestedWriteAuthorized !== true
    ) {
      throw placementError(
        "VES_PLACEMENT_NESTED_AUTH_REQUIRED",
        "Nested repository colocated placement requires explicit authorization"
      );
    }
    if (candidate.ignoredByControl && candidate.gitOwnerId === snapshot.controlOwnerId) {
      throw placementError("VES_PLACEMENT_IGNORED_TARGET", "Colocated target is ignored by its Git owner");
    }
    return "colocated";
  }
  if (candidate.gitOwnerId === null || candidate.ignoredByControl) return "centralized";
  if (isIndependent(candidate)) {
    if (snapshot.requireExplicitNestedRepositoryWrites) return "centralized";
    return snapshot.nestedGitDefault;
  }
  return snapshot.defaultProjectPlacement;
}

function projectRelativePath(artifactClass: ProjectArtifactClass, logicalName: string): string {
  switch (artifactClass) {
    case "project-manifest":
      return ".verchestra/project.yaml";
    case "spec":
      return `.specs/${logicalName}`;
    case "gate":
      return `.verchestra/gates/${logicalName}`;
    case "data":
      return `.verchestra/data/${logicalName}`;
    case "evaluation":
      return `.verchestra/evals/${logicalName}`;
    case "reversa":
      return `.verchestra/reversa/${logicalName}`;
    case "evidence":
      return `.verchestra/evidence/${logicalName}`;
    case "context":
      return `.verchestra/context/${logicalName}`;
    case "agent-instructions":
      return "AGENTS.md";
  }
}

function centralizedRelativePath(
  candidate: PlacementProject,
  artifactClass: ProjectArtifactClass,
  logicalName: string
): string {
  const prefix = `.verchestra/projects/${candidate.slug}`;
  switch (artifactClass) {
    case "project-manifest":
      return `${prefix}/project.yaml`;
    case "spec":
      return `${prefix}/specs/${logicalName}`;
    case "gate":
      return `${prefix}/gates/${logicalName}`;
    case "data":
      return `${prefix}/data/${logicalName}`;
    case "evaluation":
      return `${prefix}/evals/${logicalName}`;
    case "reversa":
      return `${prefix}/reversa/${logicalName}`;
    case "evidence":
      return `${prefix}/evidence/${logicalName}`;
    case "context":
      return `${prefix}/context/${logicalName}`;
    case "agent-instructions":
      return `${prefix}/context/AGENTS.md`;
  }
}

function validateLogicalName(value: string): string {
  try {
    return LogicalPath.parse(value).value;
  } catch (error) {
    throw placementError("VES_PLACEMENT_ADDRESS_INVALID", "Artifact logical name is invalid", { cause: error });
  }
}

export function resolveArtifact(address: LogicalArtifactAddress, snapshot: PlacementSnapshot): ResolvedArtifact {
  validateSnapshot(snapshot);
  validateLogicalName(address.logicalName);
  if (address.scope === "workspace") {
    if (address.artifactClass !== "workspace-manifest") {
      throw placementError("VES_PLACEMENT_ADDRESS_INVALID", "Workspace artifact class is invalid");
    }
    return Object.freeze({
      placement: "control",
      gitOwnerId: snapshot.controlOwnerId,
      logicalPath: ".verchestra/workspace.yaml"
    });
  }
  if (
    !new Set([
      "project-manifest",
      "spec",
      "gate",
      "data",
      "evaluation",
      "reversa",
      "evidence",
      "context",
      "agent-instructions"
    ]).has(address.artifactClass)
  ) {
    throw placementError("VES_PLACEMENT_ADDRESS_INVALID", "Project artifact class is invalid");
  }
  const candidate = snapshot.projects.find((project) => project.projectId === address.projectId);
  if (candidate === undefined) throw placementError("VES_PLACEMENT_PROJECT_NOT_FOUND", "Project is not registered");
  const placement = effectivePlacement(candidate, snapshot);
  if (placement === "centralized") {
    return Object.freeze({
      placement,
      gitOwnerId: snapshot.controlOwnerId,
      logicalPath: centralizedRelativePath(candidate, address.artifactClass, address.logicalName),
      projectId: candidate.projectId
    });
  }
  if (candidate.gitOwnerId === null)
    throw placementError("VES_PLACEMENT_OWNER_REQUIRED", "Project has no active Git owner");
  const relativePath = projectRelativePath(address.artifactClass, address.logicalName);
  const logicalPath =
    candidate.gitOwnerId === snapshot.controlOwnerId && candidate.sourceLogicalPath !== "."
      ? `${candidate.sourceLogicalPath}/${relativePath}`
      : relativePath;
  return Object.freeze({
    placement,
    gitOwnerId: candidate.gitOwnerId,
    logicalPath,
    projectId: candidate.projectId
  });
}

export function createWritePlan(desired: readonly DesiredArtifact[], snapshot: PlacementSnapshot): WritePlan {
  validateSnapshot(snapshot);
  const byTarget = new Map<string, PlannedWrite>();
  for (const item of desired) {
    try {
      Digest.parse(item.contentDigest);
    } catch (error) {
      throw placementError("VES_PLACEMENT_ADDRESS_INVALID", "Desired artifact digest is invalid", { cause: error });
    }
    if (item.generatorVersion.trim().length === 0 || item.lifecyclePolicy.trim().length === 0) {
      throw placementError("VES_PLACEMENT_ADDRESS_INVALID", "Desired artifact metadata is invalid");
    }
    const resolved = resolveArtifact(item.address, snapshot);
    const write = Object.freeze({
      ...resolved,
      contentDigest: item.contentDigest,
      generatorVersion: item.generatorVersion,
      lifecyclePolicy: item.lifecyclePolicy
    });
    const key = `${write.gitOwnerId}\0${write.logicalPath}`;
    const existing = byTarget.get(key);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(write)) {
      throw placementError(
        "VES_PLACEMENT_TARGET_COLLISION",
        "Two desired artifacts resolve to one incompatible target"
      );
    }
    byTarget.set(key, write);
  }
  const writes = Object.freeze(
    [...byTarget.values()].sort(
      (left, right) =>
        left.gitOwnerId.localeCompare(right.gitOwnerId) || left.logicalPath.localeCompare(right.logicalPath)
    )
  );
  const ownerIds = Object.freeze([...new Set(writes.map((write) => write.gitOwnerId))].sort());
  const portable = Object.freeze({ schemaVersion: 1 as const, ownerIds, writes });
  return Object.freeze({ ...portable, planId: buildInventoryFingerprint(portable) });
}
