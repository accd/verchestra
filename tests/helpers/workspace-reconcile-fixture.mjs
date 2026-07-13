import { createHash } from "node:crypto";

export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

const projectAliases = Object.freeze({
  orders: "project_018f0b6d-7b1a-7abc-8def-0123456789ab",
  billing: "project_018f0b6d-7b1a-7abc-8def-1123456789ab",
  a: "project_018f0b6d-7b1a-7abc-8def-2123456789ab",
  b: "project_018f0b6d-7b1a-7abc-8def-3123456789ab",
  "orders-api": "project_018f0b6d-7b1a-7abc-8def-4123456789ab",
  "orders-worker": "project_018f0b6d-7b1a-7abc-8def-5123456789ab",
  commerce: "project_018f0b6d-7b1a-7abc-8def-6123456789ab",
  ledger: "project_018f0b6d-7b1a-7abc-8def-7123456789ab",
  "orders-v2": "project_018f0b6d-7b1a-7abc-8def-8123456789ab",
  tampered: "project_018f0b6d-7b1a-7abc-8def-9123456789ab",
  api: "project_018f0b6d-7b1a-7abc-8def-a123456789ab",
  web: "project_018f0b6d-7b1a-7abc-8def-b123456789ab",
  missing: "project_018f0b6d-7b1a-7abc-8def-c123456789ab"
});

export const id = (alias) => projectAliases[alias] ?? alias;
export const opId = (kind, alias) => `${kind}:${id(alias)}`;

export const digest = {
  sha256(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
};

export const generations = (overrides = {}) => ({
  release: "release-1",
  config: "config-1",
  skills: "skills-1",
  data: "data-1",
  integrations: "integrations-1",
  ...overrides
});

export const project = (projectId, logicalPath, overrides = {}) => ({
  projectId: id(projectId),
  logicalPath,
  state: "active",
  predecessorProjectIds: [],
  ...overrides,
  predecessorProjectIds: (overrides.predecessorProjectIds ?? []).map(id)
});

export const projection = (overrides = {}) => ({
  projectionId: "projection-orders-jira",
  projectId: id("orders"),
  connectorId: "jira",
  canonicalDigest: "sha256:canonical",
  observedRemoteDigest: "sha256:canonical",
  observedRemoteVersion: "7",
  ...overrides,
  ...(overrides.projectId === undefined ? {} : { projectId: id(overrides.projectId) })
});

export const canonical = (overrides = {}) => ({
  schemaVersion: 1,
  minimumCliVersion: "1.0.0",
  workspaceId,
  generations: generations(),
  projects: [project("orders", "services/orders")],
  projections: [],
  ingestionManifests: [],
  ...overrides
});

export class MemorySyncStore {
  state;
  loads = 0;
  writes = 0;

  async load(requestedWorkspaceId) {
    this.loads += 1;
    void requestedWorkspaceId;
    return this.state;
  }

  async save(state) {
    const changed = JSON.stringify(this.state) !== JSON.stringify(state);
    if (changed) {
      this.state = state;
      this.writes += 1;
    }
    return { changed };
  }
}

export const input = (configuration = canonical(), overrides = {}) => ({
  installedCliVersion: "1.0.0",
  configuration,
  directions: {},
  uncertainEffects: [],
  ...overrides
});

export function createService(WorkspaceReconcileService, store = new MemorySyncStore()) {
  return {
    store,
    service: new WorkspaceReconcileService({ store, digest })
  };
}
