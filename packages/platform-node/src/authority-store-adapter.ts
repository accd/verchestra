import type { ApprovalRecord, AuthorityStorePort, CapabilityGrant } from "@verchestra/application";

import type { RuntimeStore } from "./runtime-store/runtime-store.ts";

interface StoredAuthorityRecord<T> {
  readonly record: T;
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

function withRevocation<T extends object>(stored: StoredAuthorityRecord<T>): T {
  return {
    ...stored.record,
    ...(stored.revokedAt === undefined ? {} : { revokedAt: stored.revokedAt }),
    ...(stored.revocationReason === undefined ? {} : { revocationReason: stored.revocationReason })
  };
}

export class RuntimeAuthorityStore implements AuthorityStorePort {
  readonly #runtime: RuntimeStore;

  constructor(runtime: RuntimeStore) {
    this.#runtime = runtime;
  }

  async saveApproval(record: ApprovalRecord): Promise<{ readonly created: boolean }> {
    return this.#runtime.saveAuthorityApproval({
      approvalId: record.approvalId,
      workspaceId: record.binding.workspaceId,
      runId: record.binding.runId,
      action: record.action,
      recordJson: JSON.stringify(record),
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    });
  }

  async loadApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    const stored = this.#runtime.loadAuthorityApproval(approvalId) as StoredAuthorityRecord<ApprovalRecord> | undefined;
    return stored === undefined ? undefined : withRevocation(stored);
  }

  async revokeApproval(approvalId: string, revokedAt: string, reason: string): Promise<boolean> {
    return this.#runtime.revokeAuthorityApproval(approvalId, revokedAt, reason);
  }

  async saveGrant(record: CapabilityGrant): Promise<{ readonly created: boolean }> {
    return this.#runtime.saveAuthorityGrant({
      grantId: record.grantId,
      workspaceId: record.workspaceId,
      runId: record.runId,
      action: record.action.id,
      recordJson: JSON.stringify(record),
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    });
  }

  async loadGrant(grantId: string): Promise<CapabilityGrant | undefined> {
    const stored = this.#runtime.loadAuthorityGrant(grantId) as StoredAuthorityRecord<CapabilityGrant> | undefined;
    return stored === undefined ? undefined : withRevocation(stored);
  }

  async revokeGrant(grantId: string, revokedAt: string, reason: string): Promise<boolean> {
    return this.#runtime.revokeAuthorityGrant(grantId, revokedAt, reason);
  }
}
