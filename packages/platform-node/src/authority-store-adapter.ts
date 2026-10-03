import type { ApprovalRecord, AuthorityStorePort, CapabilityGrant } from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";

import { runtimeError } from "./runtime-store/runtime-sqlite.ts";
import type { RuntimeStore, StoredAuthorityRecord } from "./runtime-store/runtime-store.ts";

// Durable authority records are stored as the exact text this produces, and
// `RuntimeStore` derives `record_digest` from that same text. Encoding with
// the qualified contract (canonicalizeJsonV2, RFC 8785 JCS) instead of bare
// JSON.stringify means the stored bytes for a given Approval or Capability
// Grant are a function of its content, not of the member order the calling
// service happened to build it with (issue #58, AD-018).
//
// Persistence note (checked, not assumed): this does NOT invalidate any row
// written by an older build. `#loadAuthorityRecord` re-derives the digest from
// the *stored* text and compares it to the *stored* digest, so a V1-encoded
// row stays self-consistent and keeps loading. Nothing outside the table
// re-derives this digest, and `bindingDigest` -- the value authority decisions
// actually compare -- is produced by the application service, which already
// uses the same canonical contract (packages/application/src/authority/
// authority.ts) and whose pre-#259 rows migration
// `009_authority_binding_digest_reencoding` already discards.
//
// One cross-version behavior does change and is recorded deliberately: saving
// a logically identical record whose row was written by an older build now
// takes `#saveAuthorityRecord`'s digest-conflict branch (VES_RUNTIME_CONSTRAINT)
// instead of returning `created: false`. Both outcomes are already failures at
// the caller (`ApprovalRecorder` turns `created: false` into
// VES_APPROVAL_CONFLICT), so this fails closed with a different code rather
// than accepting anything it previously rejected.
function encodeAuthorityRecord(record: ApprovalRecord | CapabilityGrant): string {
  return canonicalizeJsonV2(record);
}

function filedUnder<T extends ApprovalRecord | CapabilityGrant>(
  value: unknown,
  member: "approvalId" | "grantId",
  id: string
): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Reflect.get(value, member) === id;
}

// invariant: the inverse of encodeAuthorityRecord. The store has already
// matched the text to the digest it recorded when this adapter saved it, so
// what remains to refuse is text that is not JSON, or a record filed under an
// identity other than the one it was read by.
function decodeAuthorityRecord<T extends ApprovalRecord | CapabilityGrant>(
  stored: StoredAuthorityRecord,
  member: "approvalId" | "grantId",
  id: string
): T {
  let record: unknown;
  try {
    record = JSON.parse(stored.recordJson);
  } catch {
    throw runtimeError("VES_RUNTIME_CORRUPT", "Authority record JSON is invalid");
  }
  if (!filedUnder<T>(record, member, id))
    throw runtimeError("VES_RUNTIME_CORRUPT", "Authority record is filed under another identity");
  return {
    ...record,
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
      recordJson: encodeAuthorityRecord(record),
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    });
  }

  async loadApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
    const stored = this.#runtime.loadAuthorityApproval(approvalId);
    return stored === undefined ? undefined : decodeAuthorityRecord<ApprovalRecord>(stored, "approvalId", approvalId);
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
      recordJson: encodeAuthorityRecord(record),
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    });
  }

  async loadGrant(grantId: string): Promise<CapabilityGrant | undefined> {
    const stored = this.#runtime.loadAuthorityGrant(grantId);
    return stored === undefined ? undefined : decodeAuthorityRecord<CapabilityGrant>(stored, "grantId", grantId);
  }

  async revokeGrant(grantId: string, revokedAt: string, reason: string): Promise<boolean> {
    return this.#runtime.revokeAuthorityGrant(grantId, revokedAt, reason);
  }
}
