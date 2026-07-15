import { createHash } from "node:crypto";

import { InMemoryEffectRepository, EffectBroker } from "../../packages/effects/src/index.ts";
import {
  JiraClaimConnector,
  JiraManagedReadConnector,
  JiraProjectionEffectAdapter,
  buildJiraProjectionPlan,
  createJiraProjectionIntent
} from "../../packages/connectors/src/index.ts";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-512345678901";

export const projectionInput = (overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  projectKey: "VES",
  correlationId: "feature:verchestra-1.0",
  package: { packageRef: "execution-package:001", packageDigest: sha("package") },
  owner: { ownerRef: "owner:team-ai", ownerDigest: sha("owner") },
  state: "EXECUTION_READY",
  currentTaskIds: ["T61"],
  pendingTaskIds: ["T62", "T63"],
  approvalStatus: "required",
  workClaim: { claimRef: "claim:001", claimDigest: sha("claim"), status: "active" },
  lastReconciledVersion: 0,
  canonicalRevisionDigest: sha("git-revision"),
  ...overrides
});

export class MockJiraTransport {
  constructor() {
    this.issues = new Map();
    this.claims = new Map();
    this.calls = [];
    this.rate = { remaining: 100, retryAfterMs: 0 };
    this.createCalls = 0;
    this.updateCalls = 0;
    this.failAfterCreate = false;
    this.failAfterUpdate = false;
    this.pageSize = 2;
  }

  async getManaged({ projectKey, correlationId }) {
    this.calls.push("get-managed");
    return { issue: this.issues.get(`${projectKey}:${correlationId}`), rate: this.rate };
  }

  async createManaged(request) {
    this.calls.push("create-managed");
    this.createCalls += 1;
    const mapKey = `${request.projectKey}:${request.correlationId}`;
    if (this.issues.has(mapKey)) throw new Error("duplicate correlation");
    const issue = {
      issueId: `issue:${request.correlationId}`,
      issueKey: `${request.projectKey}-${this.issues.size + 1}`,
      projectKey: request.projectKey,
      version: 1,
      correlationId: request.correlationId,
      marker: request.marker,
      managed: request.managed,
      managedDigest: request.marker.projectionDigest
    };
    this.issues.set(mapKey, issue);
    if (this.failAfterCreate) {
      const error = new Error("create acknowledgement lost");
      error.outcomeUnknown = true;
      throw error;
    }
    return { issue, rate: this.rate };
  }

  async updateManaged(request) {
    this.calls.push("update-managed");
    this.updateCalls += 1;
    const mapKey = `${request.projectKey}:${request.correlationId}`;
    const current = this.issues.get(mapKey);
    if (current === undefined || current.version !== request.expectedVersion)
      return { status: "version-conflict", rate: this.rate };
    const issue = {
      ...current,
      version: current.version + 1,
      marker: request.marker,
      managed: request.managed,
      managedDigest: request.marker.projectionDigest
    };
    this.issues.set(mapKey, issue);
    if (this.failAfterUpdate) {
      const error = new Error("update acknowledgement lost");
      error.outcomeUnknown = true;
      throw error;
    }
    return { status: "updated", issue, rate: this.rate };
  }

  async listManaged({ projectKey, cursor, pageSize }) {
    this.calls.push(`list:${cursor ?? "start"}`);
    const all = [...this.issues.values()].filter((issue) => issue.projectKey === projectKey);
    const offset = cursor === undefined ? 0 : Number(cursor);
    const size = Math.min(pageSize, this.pageSize);
    const issues = all.slice(offset, offset + size);
    const nextCursor = offset + size < all.length ? String(offset + size) : undefined;
    return { issues, nextCursor, rate: this.rate };
  }

  async readClaim({ correlationId }) {
    this.calls.push("claim:read");
    return { claim: this.claims.get(correlationId), rate: this.rate };
  }

  async compareAndSwapClaim(request) {
    this.calls.push("claim:cas");
    const current = this.claims.get(request.correlationId);
    const version = current?.version ?? 0;
    if (version !== request.expectedVersion) return { status: "conflict", claim: current, rate: this.rate };
    const claim = { ...request.claim, version: version + 1 };
    this.claims.set(request.correlationId, claim);
    return { status: "updated", claim, rate: this.rate };
  }
}

export function projectionFixture(overrides = {}) {
  const transport = overrides.transport ?? new MockJiraTransport();
  const adapter = new JiraProjectionEffectAdapter({ transport });
  const repository = new InMemoryEffectRepository();
  const times = ["2026-07-15T10:00:00.000Z", "2026-07-15T10:00:01.000Z", "2026-07-15T10:00:02.000Z"];
  const broker = new EffectBroker({ repository, adapter, now: () => times.shift() ?? "2026-07-15T10:00:03.000Z" });
  return { transport, adapter, repository, broker };
}

export async function projectOnce(input = projectionInput(), overrides = {}) {
  const fixture = projectionFixture(overrides);
  const plan = buildJiraProjectionPlan(input);
  fixture.adapter.register(plan);
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:projection:001",
    grantRef: "grant:jira:managed:001",
    createdAt: "2026-07-15T10:00:00.000Z"
  });
  await fixture.broker.plan(intent);
  const receipt = await fixture.broker.execute(intent.idempotencyKey);
  return { ...fixture, plan, intent, receipt };
}

export const readConnector = (transport) => new JiraManagedReadConnector({ transport });
export const claimConnector = (transport) => new JiraClaimConnector({ transport });
