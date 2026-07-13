import { FixedClock, IsoInstant } from "../../packages/domain/src/index.ts";
import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";
import { changeScopesOverlap, normalizeChangeScope } from "../../packages/application/src/index.ts";

export const workspaceId = "workspace_018f0000-0000-7000-8000-000000000001";
export const projectId = "project_018f0000-0000-7000-8000-000000000002";
export const runA = "run_018f0000-0000-7000-8000-000000000003";
export const runB = "run_018f0000-0000-7000-8000-000000000004";

export class MemoryLeasePort {
  active;
  token = 0;
  acquire({ ownerId, expiresAt, now, expectedFencingToken }) {
    if (
      expectedFencingToken !== undefined &&
      (!this.active ||
        this.active.fencingToken !== expectedFencingToken ||
        this.active.ownerId !== ownerId ||
        this.active.expiresAt <= now)
    )
      throw Object.assign(new Error("stale"), { code: "VES_RUNTIME_LEASE_CONFLICT" });
    if (this.active && this.active.ownerId !== ownerId && this.active.expiresAt > now)
      throw Object.assign(new Error("conflict"), { code: "VES_RUNTIME_LEASE_CONFLICT" });
    if (!this.active || this.active.ownerId !== ownerId || this.active.expiresAt <= now) this.token += 1;
    this.active = { ownerId, expiresAt, fencingToken: this.token };
    return { fencingToken: this.token };
  }
  release(_workspaceId, ownerId) {
    if (!this.active) return false;
    if (this.active.ownerId !== ownerId) throw new Error("owner");
    this.active = undefined;
    return true;
  }
}

export class MemoryRemoteClaims {
  claims = [];
  unavailable = false;
  token = 0;

  async acquire(request) {
    if (this.unavailable) throw new Error("offline");
    const active = this.claims.find(
      (claim) => claim.expiresAt > request.now && changeScopesOverlap(claim.scope, request.scope)
    );
    if (active && active.owner.runId !== request.owner.runId) return { status: "conflict", claim: active };
    this.token += 1;
    const claim = {
      schemaVersion: 1,
      claimId: `claim_018f0000-0000-7000-8000-${String(this.token).padStart(12, "0")}`,
      workspaceId: request.scope.workspaceId,
      scope: request.scope,
      scopeDigest: request.scope.scopeDigest,
      owner: request.owner,
      enforcement: request.enforcement,
      fencingToken: this.token,
      issuedAt: request.now,
      expiresAt: request.expiresAt,
      signature: `signed:${this.token}`
    };
    this.claims = this.claims.filter(
      (entry) => entry.expiresAt > request.now && entry.owner.runId !== request.owner.runId
    );
    this.claims.push(claim);
    return { status: "acquired", claim };
  }

  async heartbeat(reference, expiresAt, now) {
    if (this.unavailable) throw new Error("offline");
    const claim = this.claims.find((entry) => entry.claimId === reference.claimId);
    if (!claim || claim.fencingToken !== reference.fencingToken || claim.expiresAt <= now) return { status: "stale" };
    Object.assign(claim, { expiresAt, signature: `signed:${claim.fencingToken}:heartbeat` });
    return { status: "renewed", claim: structuredClone(claim) };
  }

  async release(reference) {
    if (this.unavailable) throw new Error("offline");
    const index = this.claims.findIndex(
      (entry) => entry.claimId === reference.claimId && entry.fencingToken === reference.fencingToken
    );
    if (index < 0) return false;
    this.claims.splice(index, 1);
    return true;
  }

  async current(reference) {
    if (this.unavailable) throw new Error("offline");
    return structuredClone(this.claims.find((entry) => entry.claimId === reference.claimId));
  }
}

export function coordinationFixture() {
  const clock = new FixedClock(IsoInstant.parse("2026-07-13T12:00:00.000Z"));
  const digest = new NodeContentDigest();
  const local = new MemoryLeasePort();
  const remote = new MemoryRemoteClaims();
  const signatures = { verify: async (claim) => claim.signature.startsWith(`signed:${claim.fencingToken}`) };
  const scope = normalizeChangeScope({ workspaceId, targets: [{ projectId, path: "src" }] }, digest);
  let sequence = 100;
  const uuid = () => `018f0000-0000-7000-8000-${String(++sequence).padStart(12, "0")}`;
  return { clock, digest, local, remote, signatures, scope, uuid };
}
