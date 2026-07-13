import { IsoInstant, LogicalPath, StableId, type Clock, type UuidSource } from "@verchestra/domain";

import type { ContentDigestPort } from "../sync/workspace-reconcile.ts";

export class CoordinationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoordinationError";
    this.code = code;
  }
}

export interface ChangeTarget {
  readonly projectId: string;
  readonly path?: string;
}

export interface NormalizedChangeScope {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly targets: readonly ChangeTarget[];
  readonly scopeDigest: string;
}

export interface RunOwner {
  readonly runId: string;
  readonly actorId: string;
}

export interface LocalLeaseRef {
  readonly leaseId: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
}

export interface WorkClaim {
  readonly schemaVersion: 1;
  readonly claimId: string;
  readonly workspaceId: string;
  readonly scope: NormalizedChangeScope;
  readonly scopeDigest: string;
  readonly owner: RunOwner;
  readonly enforcement: "enforced" | "advisory";
  readonly fencingToken: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface LocalLeasePort {
  acquire(input: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
    readonly expectedFencingToken?: number;
  }): { readonly fencingToken: number };
  release(workspaceId: string, ownerId: string): boolean;
}

export interface RemoteClaimPort {
  acquire(input: {
    readonly scope: NormalizedChangeScope;
    readonly owner: RunOwner;
    readonly enforcement: "enforced" | "advisory";
    readonly now: string;
    readonly expiresAt: string;
  }): Promise<
    | { readonly status: "acquired"; readonly claim: WorkClaim }
    | { readonly status: "conflict"; readonly claim: WorkClaim }
  >;
  heartbeat(
    reference: { readonly claimId: string; readonly fencingToken: number },
    expiresAt: string,
    now: string
  ): Promise<{ readonly status: "renewed"; readonly claim: WorkClaim } | { readonly status: "stale" }>;
  release(reference: { readonly claimId: string; readonly fencingToken: number }, reason: string): Promise<boolean>;
  current(reference: { readonly claimId: string; readonly fencingToken: number }): Promise<WorkClaim | undefined>;
}

export interface ClaimSignaturePort {
  verify(claim: WorkClaim): Promise<boolean>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareTargets(left: ChangeTarget, right: ChangeTarget): number {
  return left.projectId.localeCompare(right.projectId) || (left.path ?? "").localeCompare(right.path ?? "");
}

export function normalizeChangeScope(
  input: { readonly workspaceId: string; readonly targets: readonly ChangeTarget[] },
  digest: ContentDigestPort
): NormalizedChangeScope {
  StableId.parse(input.workspaceId, "workspace");
  if (input.targets.length === 0) throw new CoordinationError("VES_CLAIM_SCOPE_INVALID", "Scope is empty");
  const parsed = input.targets.map((target) => {
    StableId.parse(target.projectId, "project");
    return Object.freeze({
      projectId: target.projectId,
      ...(target.path === undefined ? {} : { path: LogicalPath.parse(target.path).value })
    });
  });
  const targets = parsed
    .sort(compareTargets)
    .filter(
      (target, index, all) =>
        index === 0 || target.projectId !== all[index - 1]?.projectId || target.path !== all[index - 1]?.path
    )
    .filter(
      (target, _index, all) =>
        !all.some(
          (candidate) =>
            candidate !== target &&
            candidate.projectId === target.projectId &&
            (candidate.path === undefined ||
              (target.path !== undefined && LogicalPath.parse(target.path).isWithin(LogicalPath.parse(candidate.path))))
        )
    );
  const material = Object.freeze({
    schemaVersion: 1 as const,
    workspaceId: input.workspaceId,
    targets: Object.freeze(targets)
  });
  return Object.freeze({ ...material, scopeDigest: digest.sha256(canonicalJson(material)) });
}

function targetOverlap(left: ChangeTarget, right: ChangeTarget): boolean {
  if (left.projectId !== right.projectId) return false;
  if (left.path === undefined || right.path === undefined) return true;
  const leftPath = LogicalPath.parse(left.path);
  const rightPath = LogicalPath.parse(right.path);
  return leftPath.isWithin(rightPath) || rightPath.isWithin(leftPath);
}

export function changeScopesOverlap(left: NormalizedChangeScope, right: NormalizedChangeScope): boolean {
  return (
    left.workspaceId === right.workspaceId && left.targets.some((a) => right.targets.some((b) => targetOverlap(a, b)))
  );
}

function validTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 24 * 60 * 60 * 1_000)
    throw new CoordinationError("VES_CLAIM_TTL_INVALID", "Claim TTL is outside safe bounds");
}

function ref(claim: WorkClaim) {
  return Object.freeze({ claimId: claim.claimId, fencingToken: claim.fencingToken });
}

export class WorkClaimService {
  readonly #local: LocalLeasePort;
  readonly #remote: RemoteClaimPort | undefined;
  readonly #signatures: ClaimSignaturePort;
  readonly #clock: Clock;
  readonly #uuid: UuidSource;

  constructor(dependencies: {
    readonly local: LocalLeasePort;
    readonly remote?: RemoteClaimPort;
    readonly signatures: ClaimSignaturePort;
    readonly clock: Clock;
    readonly uuid: UuidSource;
  }) {
    this.#local = dependencies.local;
    this.#remote = dependencies.remote;
    this.#signatures = dependencies.signatures;
    this.#clock = dependencies.clock;
    this.#uuid = dependencies.uuid;
  }

  async acquire(input: {
    readonly mode: "personal" | "team";
    readonly enforcement: "enforced" | "advisory";
    readonly scope: NormalizedChangeScope;
    readonly owner: RunOwner;
    readonly ttlMs: number;
  }): Promise<Readonly<Record<string, unknown>>> {
    validTtl(input.ttlMs);
    StableId.parse(input.owner.runId, "run");
    const now = this.#clock.now();
    const expiresAt = now.addMilliseconds(input.ttlMs).value;
    const leaseId = StableId.create("lease", this.#uuid).value;
    let localResult: { readonly fencingToken: number };
    try {
      localResult = this.#local.acquire({
        leaseId,
        workspaceId: input.scope.workspaceId,
        ownerId: input.owner.runId,
        now: now.value,
        expiresAt
      });
    } catch {
      throw new CoordinationError("VES_LOCAL_LEASE_CONFLICT", "Another local writer owns the Workspace");
    }
    const lease: LocalLeaseRef = Object.freeze({
      leaseId,
      workspaceId: input.scope.workspaceId,
      ownerId: input.owner.runId,
      fencingToken: localResult.fencingToken,
      expiresAt
    });
    if (input.mode === "personal") return Object.freeze({ status: "acquired-local", lease, expiresAt });
    if (this.#remote === undefined)
      return this.#remoteUnavailable(input, lease, "Remote coordination is not configured");
    try {
      const result = await this.#remote.acquire({
        scope: input.scope,
        owner: Object.freeze({ ...input.owner }),
        enforcement: input.enforcement,
        now: now.value,
        expiresAt
      });
      if (result.status === "conflict") {
        if (!(await this.#validClaim(result.claim)) || IsoInstant.parse(result.claim.expiresAt).compare(now) <= 0) {
          this.#local.release(input.scope.workspaceId, input.owner.runId);
          throw new CoordinationError("VES_CLAIM_SIGNATURE_INVALID", "Conflicting Work Claim is invalid");
        }
        if (input.enforcement === "advisory")
          return Object.freeze({ status: "advisory-conflict", conflictingClaim: result.claim, lease, expiresAt });
        this.#local.release(input.scope.workspaceId, input.owner.runId);
        throw new CoordinationError("VES_CLAIM_CONFLICT", "An enforced overlapping Work Claim exists");
      }
      if (!(await this.#claimMatches(result.claim, input, now.value, expiresAt))) {
        this.#local.release(input.scope.workspaceId, input.owner.runId);
        throw new CoordinationError("VES_CLAIM_SIGNATURE_INVALID", "Remote Work Claim is invalid");
      }
      return Object.freeze({ status: "acquired", claim: result.claim, lease, expiresAt });
    } catch (error) {
      if (error instanceof CoordinationError) throw error;
      return this.#remoteUnavailable(input, lease, "Remote coordination failed");
    }
  }

  async #remoteUnavailable(
    input: {
      readonly enforcement: "enforced" | "advisory";
      readonly scope: NormalizedChangeScope;
      readonly owner: RunOwner;
    },
    lease: LocalLeaseRef,
    message: string
  ): Promise<Readonly<Record<string, unknown>>> {
    if (input.enforcement === "advisory") return Object.freeze({ status: "advisory-unavailable", lease });
    this.#local.release(input.scope.workspaceId, input.owner.runId);
    throw new CoordinationError("VES_CLAIM_CONNECTOR_UNAVAILABLE", message);
  }

  async #claimMatches(
    claim: WorkClaim,
    input: { readonly scope: NormalizedChangeScope; readonly owner: RunOwner; readonly enforcement: string },
    issuedAt: string,
    expiresAt: string
  ): Promise<boolean> {
    return (
      (await this.#validClaim(claim)) &&
      claim.workspaceId === input.scope.workspaceId &&
      canonicalJson(claim.scope) === canonicalJson(input.scope) &&
      claim.scopeDigest === input.scope.scopeDigest &&
      claim.owner.runId === input.owner.runId &&
      claim.owner.actorId === input.owner.actorId &&
      claim.enforcement === input.enforcement &&
      claim.issuedAt === issuedAt &&
      claim.expiresAt === expiresAt &&
      Number.isSafeInteger(claim.fencingToken) &&
      claim.fencingToken > 0
    );
  }

  async #validClaim(claim: WorkClaim): Promise<boolean> {
    try {
      StableId.parse(claim.claimId, "claim");
      StableId.parse(claim.workspaceId, "workspace");
      StableId.parse(claim.owner.runId, "run");
      IsoInstant.parse(claim.issuedAt);
      IsoInstant.parse(claim.expiresAt);
      return (
        Number.isSafeInteger(claim.fencingToken) && claim.fencingToken > 0 && (await this.#signatures.verify(claim))
      );
    } catch {
      return false;
    }
  }

  heartbeatLocal(lease: LocalLeaseRef, ttlMs: number): LocalLeaseRef {
    validTtl(ttlMs);
    const now = this.#clock.now();
    const expiresAt = now.addMilliseconds(ttlMs).value;
    const leaseId = StableId.create("lease", this.#uuid).value;
    let result: { readonly fencingToken: number };
    try {
      result = this.#local.acquire({
        leaseId,
        workspaceId: lease.workspaceId,
        ownerId: lease.ownerId,
        now: now.value,
        expiresAt,
        expectedFencingToken: lease.fencingToken
      });
    } catch {
      throw new CoordinationError("VES_LOCAL_LEASE_CONFLICT", "Local lease is no longer owned by this run");
    }
    if (result.fencingToken !== lease.fencingToken)
      throw new CoordinationError("VES_LOCAL_LEASE_STALE", "Local lease fencing token changed");
    return Object.freeze({ ...lease, leaseId, expiresAt });
  }

  releaseLocal(lease: LocalLeaseRef): boolean {
    try {
      return this.#local.release(lease.workspaceId, lease.ownerId);
    } catch {
      throw new CoordinationError("VES_LOCAL_LEASE_STALE", "Local lease is no longer owned by this run");
    }
  }

  async heartbeat(claim: WorkClaim, ttlMs: number, lease: LocalLeaseRef): Promise<WorkClaim> {
    validTtl(ttlMs);
    if (this.#remote === undefined)
      throw new CoordinationError("VES_CLAIM_CONNECTOR_UNAVAILABLE", "Remote coordination is unavailable");
    const now = this.#clock.now();
    const expiresAt = now.addMilliseconds(ttlMs).value;
    this.heartbeatLocal(lease, ttlMs);
    let result;
    try {
      result = await this.#remote.heartbeat(ref(claim), expiresAt, now.value);
    } catch {
      throw new CoordinationError("VES_CLAIM_CONNECTOR_UNAVAILABLE", "Work Claim heartbeat failed");
    }
    if (result.status === "stale") throw new CoordinationError("VES_CLAIM_STALE", "Work Claim fencing is stale");
    if (
      result.claim.claimId !== claim.claimId ||
      result.claim.fencingToken !== claim.fencingToken ||
      result.claim.expiresAt !== expiresAt ||
      canonicalJson({ ...result.claim, expiresAt: claim.expiresAt, signature: claim.signature }) !==
        canonicalJson(claim) ||
      !(await this.#validClaim(result.claim))
    )
      throw new CoordinationError("VES_CLAIM_SIGNATURE_INVALID", "Renewed Work Claim is invalid");
    return result.claim;
  }

  async release(claim: WorkClaim, reason: string): Promise<boolean> {
    if (this.#remote === undefined)
      throw new CoordinationError("VES_CLAIM_RELEASE_UNCERTAIN", "Remote claim release cannot be confirmed");
    let released: boolean;
    try {
      released = await this.#remote.release(ref(claim), reason);
    } catch {
      throw new CoordinationError("VES_CLAIM_RELEASE_UNCERTAIN", "Remote claim release outcome is unknown");
    }
    if (!released) return false;
    this.#local.release(claim.workspaceId, claim.owner.runId);
    return true;
  }

  async verifyCurrent(claim: WorkClaim): Promise<boolean> {
    if (this.#remote === undefined) return false;
    try {
      const current = await this.#remote.current(ref(claim));
      return (
        current !== undefined &&
        current.claimId === claim.claimId &&
        current.fencingToken === claim.fencingToken &&
        canonicalJson({ ...current, expiresAt: claim.expiresAt, signature: claim.signature }) ===
          canonicalJson(claim) &&
        IsoInstant.parse(current.expiresAt).compare(this.#clock.now()) > 0 &&
        (await this.#signatures.verify(current))
      );
    } catch {
      return false;
    }
  }
}
