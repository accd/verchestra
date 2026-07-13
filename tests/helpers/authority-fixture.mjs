import { ArtifactSealer, NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { FixedClock, IsoInstant } from "../../packages/domain/src/index.ts";
import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

const hex = (character) => `sha256:${character.repeat(64)}`;

export const now = "2026-07-13T12:00:00.000Z";
export const later = "2026-07-13T13:00:00.000Z";

export function review(overrides = {}) {
  return {
    packageDigest: hex("1"),
    sourceStateDigest: hex("2"),
    scope: ["project:api"],
    protectedPaths: ["infra/production"],
    tasks: ["task-1", "task-2"],
    dataAccess: ["database:catalog/read-only"],
    capabilities: ["filesystem.write:project-api"],
    selectedPassports: ["passport:implementer"],
    destinations: ["local-worktree"],
    budgets: ["repair-cycles:2", "cost-usd:5"],
    claims: ["claim:project-api"],
    gates: ["unit", "security"],
    risks: ["protected-path-nearby"],
    assumptions: ["schema-current"],
    completionCriteria: ["all-gates-pass"],
    evidenceRefs: ["evidence:spec", "evidence:design"],
    ...overrides
  };
}

export function intent(overrides = {}) {
  return {
    action: "execution",
    workspaceId: "workspace_018f0000-0000-7000-8000-000000000001",
    runId: "run_018f0000-0000-7000-8000-000000000002",
    policyDigest: hex("3"),
    contextRecipeDigest: hex("4"),
    semanticObligationsDigest: hex("5"),
    contextManifestDigest: hex("6"),
    expiresAt: later,
    review: review(),
    ...overrides
  };
}

export class MemoryAuthorityStore {
  approvals = new Map();
  grants = new Map();

  async saveApproval(record) {
    if (this.approvals.has(record.approvalId)) return { created: false };
    this.approvals.set(record.approvalId, structuredClone(record));
    return { created: true };
  }

  async loadApproval(id) {
    return structuredClone(this.approvals.get(id));
  }

  async revokeApproval(id, revokedAt, reason) {
    const current = this.approvals.get(id);
    if (!current || current.revokedAt) return false;
    this.approvals.set(id, { ...current, revokedAt, revocationReason: reason });
    return true;
  }

  async saveGrant(record) {
    if (this.grants.has(record.grantId)) return { created: false };
    this.grants.set(record.grantId, structuredClone(record));
    return { created: true };
  }

  async loadGrant(id) {
    return structuredClone(this.grants.get(id));
  }

  async revokeGrant(id, revokedAt, reason) {
    const current = this.grants.get(id);
    if (!current || current.revokedAt) return false;
    this.grants.set(id, { ...current, revokedAt, revocationReason: reason });
    return true;
  }
}

export function authorityFixture() {
  const clock = new FixedClock(IsoInstant.parse(now));
  const signer = NodeEd25519Signer.generate({ keyId: "human-reviewer-key", purposes: ["approval"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date(clock.now().value) });
  const trust = createTrustRoot({ trustRootId: "reviewers", version: 1, keys: [signer.publicKeyRef] });
  const artifacts = {
    async seal(payload) {
      return sealer.seal(payload, {
        schema: { name: "approval-grant", version: 1 },
        purpose: "approval",
        bindingId: payload.approvalId,
        sourceStateDigest: payload.binding.sourceStateDigest.slice(7)
      });
    },
    async verify(artifact) {
      return sealer.verify(artifact, trust, {
        schema: { name: "approval-grant", version: 1 },
        purpose: "approval",
        bindingId: artifact.payload.approvalId,
        sourceStateDigest: artifact.payload.binding.sourceStateDigest.slice(7),
        now: new Date(clock.now().value)
      });
    }
  };
  let sequence = 0;
  const uuid = () => `018f0000-0000-7000-8000-${String(++sequence).padStart(12, "0")}`;
  return { artifacts, clock, digest: new NodeContentDigest(), store: new MemoryAuthorityStore(), uuid };
}

export function grantRequest(approval, overrides = {}) {
  return {
    principal: { type: "Vestra::Principal", id: "implementer" },
    action: { type: "Vestra::Action", id: "filesystem.write" },
    resource: { type: "Vestra::Resource", id: "project-api" },
    workspaceId: approval.binding.workspaceId,
    runId: approval.binding.runId,
    constraints: ["path-prefix:project-api/", "max-bytes:1000000"],
    capability: "filesystem.write:project-api",
    expiresAt: later,
    approvalRef: { approvalId: approval.approvalId, bindingDigest: approval.bindingDigest },
    currentApprovalBinding: approval.binding,
    policyDecision: {
      decision: "allow",
      policyViewDigest: approval.binding.policyDigest,
      evidenceDigest: hex("7")
    },
    ...overrides
  };
}
