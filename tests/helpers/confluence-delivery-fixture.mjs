import { createHash } from "node:crypto";

import { EffectBroker, InMemoryEffectRepository } from "../../packages/effects/src/index.ts";
import {
  ConfluenceDeliveryEffectAdapter,
  buildConfluenceDeliveryPlan,
  createConfluenceDeliveryIntent
} from "../../packages/connectors/src/index.ts";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const workspaceId = "workspace_018f0000-0000-7000-8000-000000001001";

export const deliveryInput = (overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  runId: "run_018f0000-0000-7000-8000-000000001002",
  correlationId: "feature:verchestra-1.0",
  spaceKey: "DELIVERY",
  pageId: "page:verchestra",
  destinationId: "confluence:delivery",
  title: "Verchestra delivery",
  package: { packageRef: "execution-package:001", packageDigest: sha("package") },
  handoff: { handoffRef: "handoff:001", handoffDigest: sha("handoff") },
  owner: "team:ai-platform",
  status: "EXECUTION_READY",
  currentTaskIds: ["T64"],
  pendingTaskIds: ["T65", "T66"],
  approvalRef: "approval:handoff:001",
  capabilityRef: "grant:handoff-publication:001",
  classification: "internal",
  lastReconciledVersion: 0,
  lastReconciledSectionDigest: null,
  generatedAt: "2026-07-16T10:00:00.000Z",
  ...overrides
});

export class MockConfluenceDeliveryTransport {
  constructor() {
    this.pages = new Map();
    this.calls = [];
    this.rate = { remaining: 100, retryAfterMs: 0 };
    this.createCalls = 0;
    this.updateCalls = 0;
    this.failAfterCreate = false;
    this.failAfterUpdate = false;
  }

  async getDeliveryPage({ spaceKey, pageId }) {
    this.calls.push("get");
    return { page: this.pages.get(`${spaceKey}:${pageId}`), rate: this.rate };
  }

  async createDeliveryPage(request) {
    this.calls.push("create");
    this.createCalls += 1;
    const key = `${request.spaceKey}:${request.pageId}`;
    const page = {
      spaceKey: request.spaceKey,
      pageId: request.pageId,
      version: 1,
      title: request.title,
      body: request.body
    };
    this.pages.set(key, page);
    if (this.failAfterCreate) {
      const error = new Error("create acknowledgement lost");
      error.outcomeUnknown = true;
      throw error;
    }
    return { page, rate: this.rate };
  }

  async updateDeliveryPage(request) {
    this.calls.push("update");
    this.updateCalls += 1;
    const key = `${request.spaceKey}:${request.pageId}`;
    const current = this.pages.get(key);
    if (current === undefined || current.version !== request.expectedVersion) {
      return { status: "version-conflict", rate: this.rate };
    }
    const page = { ...current, version: current.version + 1, body: request.body };
    this.pages.set(key, page);
    if (this.failAfterUpdate) {
      const error = new Error("update acknowledgement lost");
      error.outcomeUnknown = true;
      throw error;
    }
    return { status: "updated", page, rate: this.rate };
  }
}

export class MockDeliveryAuthority {
  constructor() {
    this.allowed = true;
    this.calls = [];
  }

  async verify(input) {
    this.calls.push(input);
    return {
      allowed:
        this.allowed && input.action === "handoff-publication" && input.approvalRef.startsWith("approval:handoff:")
    };
  }
}

export class MockDeliveryEgress {
  constructor() {
    this.allowed = true;
    this.code = "VES_EGRESS_ALLOWED";
    this.calls = [];
  }

  async authorize(input) {
    this.calls.push(input);
    return { allowed: this.allowed, code: this.code };
  }
}

export function deliveryFixture(overrides = {}) {
  const transport = overrides.transport ?? new MockConfluenceDeliveryTransport();
  const authority = overrides.authority ?? new MockDeliveryAuthority();
  const egress = overrides.egress ?? new MockDeliveryEgress();
  const adapter = new ConfluenceDeliveryEffectAdapter({ transport, authority, egress });
  const repository = new InMemoryEffectRepository();
  const times = ["2026-07-16T10:00:00.000Z", "2026-07-16T10:00:01.000Z", "2026-07-16T10:00:02.000Z"];
  const broker = new EffectBroker({ repository, adapter, now: () => times.shift() ?? "2026-07-16T10:00:03.000Z" });
  return { transport, authority, egress, adapter, repository, broker };
}

export async function deliverOnce(input = deliveryInput(), overrides = {}) {
  const fixture = deliveryFixture(overrides);
  const plan = buildConfluenceDeliveryPlan(input);
  fixture.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:confluence:delivery:001",
    createdAt: input.generatedAt
  });
  await fixture.broker.plan(intent);
  const receipt = await fixture.broker.execute(intent.idempotencyKey);
  return { ...fixture, plan, intent, receipt };
}
