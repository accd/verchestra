import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { codeUnitCompare } from "@verchestra/domain";
import type { EvidenceSigner, JsonValue, TrustRoot } from "@verchestra/evidence";

import { extensionError } from "./extension-errors.ts";
import { openRecord, sealRecord } from "./extension-seal.ts";

// invariant: an approval reference names a file, so it is lowercase (one name
// per case-insensitive file system) and has no dot (so `<ref>.revoked.json`
// can never be another reference's approval).
export const APPROVAL_REF = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const MAXIMUM_RECORD_BYTES = 1024 * 1024;
const APPROVAL_KEYS = Object.freeze([
  "approvalRef",
  "approvedAt",
  "componentDigest",
  "expiresAt",
  "extensionId",
  "launch",
  "launchDigest",
  "lockDigest"
]);

export interface ExtensionLaunch {
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

// invariant: door 3. What a human approved for one workspace probe worker on
// this machine: the locked extension, its entry's digest, and the exact launch
// probeLaunchDigest measured, until it expires or is revoked.
export interface ExtensionApproval {
  readonly approvalRef: string;
  readonly extensionId: string;
  readonly lockDigest: string;
  readonly componentDigest: string;
  readonly launchDigest: string;
  readonly launch: ExtensionLaunch;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export type ExtensionApprovalState = "active" | "expired" | "revoked" | "invalid";

export interface ExtensionApprovalListing {
  readonly approvalRef: string;
  readonly extensionId: string | null;
  readonly componentDigest: string | null;
  readonly launchDigest: string | null;
  readonly expiresAt: string | null;
  readonly state: ExtensionApprovalState;
}

type Evaluation =
  | { readonly state: "absent" }
  | { readonly state: "invalid" }
  | { readonly state: "active" | "expired" | "revoked"; readonly approval: ExtensionApproval };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLaunch(value: unknown): value is ExtensionLaunch {
  if (!isRecord(value) || !isText(value["executable"])) return false;
  const args = value["args"];
  const environment = value["environment"];
  return (
    Array.isArray(args) &&
    args.every((argument) => typeof argument === "string") &&
    isRecord(environment) &&
    Object.values(environment).every((entry) => typeof entry === "string")
  );
}

// why: the content is checked after its signature verified, so a record this
// store never wrote, even one signed by the Workspace key, is not taken on its
// shape alone.
function approvalOf(content: unknown, approvalRef: string): ExtensionApproval | undefined {
  if (!isRecord(content) || Object.keys(content).sort(codeUnitCompare).join(",") !== APPROVAL_KEYS.join(","))
    return undefined;
  const texts = APPROVAL_KEYS.filter((key) => key !== "launch").every((key) => isText(content[key]));
  if (!texts || content["approvalRef"] !== approvalRef || !isLaunch(content["launch"])) return undefined;
  return content as unknown as ExtensionApproval;
}

function listingOf(approvalRef: string, evaluation: Exclude<Evaluation, { readonly state: "absent" }>) {
  const approval = "approval" in evaluation ? evaluation.approval : undefined;
  return Object.freeze({
    approvalRef,
    extensionId: approval?.extensionId ?? null,
    componentDigest: approval?.componentDigest ?? null,
    launchDigest: approval?.launchDigest ?? null,
    expiresAt: approval?.expiresAt ?? null,
    state: evaluation.state
  });
}

function present(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code !== "ENOENT";
}

// invariant: door 3. One approval file per approval reference, written once
// and never replaced or deleted; a revocation is a second file beside it. The
// lookup answers only an approval that verifies against the pinned anchor,
// has not expired, and has no revocation beside it: a revocation that does not
// verify still blocks it (fails closed).
export class ExtensionApprovalStore {
  readonly #directory: string;
  readonly #trust: () => Promise<TrustRoot | undefined>;
  readonly #now: () => Date;

  constructor(options: {
    readonly directory: string;
    readonly trust: () => Promise<TrustRoot | undefined>;
    readonly now?: () => Date;
  }) {
    this.#directory = options.directory;
    this.#trust = options.trust;
    this.#now = options.now ?? (() => new Date());
  }

  #path(approvalRef: string, suffix = ""): string {
    if (!APPROVAL_REF.test(approvalRef))
      throw extensionError("VES_EXTENSION_APPROVAL_NOT_FOUND", {}, "Approval reference is malformed");
    return join(this.#directory, `${approvalRef}${suffix}.json`);
  }

  // invariant: the directory is real; a link in its place is refused, never
  // followed, and it is created only by a write.
  async #directoryPresent(create: boolean): Promise<boolean> {
    const metadata = await lstat(this.#directory).catch((error: unknown) => {
      if (present(error)) throw error;
      return undefined;
    });
    if (metadata !== undefined && !metadata.isDirectory())
      throw extensionError(
        "VES_EXTENSION_FAILED",
        { reason: "VES_STATE_ROOT_ESCAPE" },
        "Approvals are not a directory"
      );
    if (metadata !== undefined) return true;
    if (create) await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    return create;
  }

  async #read(path: string): Promise<unknown> {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (present(error)) throw error;
      return undefined;
    }
    if (!metadata.isFile() || metadata.size > MAXIMUM_RECORD_BYTES) return null;
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  // invariant: a record is created whole and exclusively: a private temporary
  // file is linked to its final name, which fails when that name exists, so
  // two writers for one reference leave exactly one record.
  async #writeOnce(path: string, envelope: unknown): Promise<boolean> {
    const temporary = join(this.#directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600, flag: "wx", flush: true });
    try {
      await link(temporary, path);
      return true;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "EEXIST") return false;
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async exists(approvalRef: string): Promise<boolean> {
    const path = this.#path(approvalRef);
    return (await this.#directoryPresent(false)) && (await this.#read(path)) !== undefined;
  }

  async record(approval: ExtensionApproval, signer: EvidenceSigner): Promise<void> {
    const path = this.#path(approval.approvalRef);
    await this.#directoryPresent(true);
    const envelope = await sealRecord(signer, "extension-approval", approval as unknown as JsonValue, {
      bindingId: approval.approvalRef,
      sourceStateDigest: approval.launchDigest
    });
    if (!(await this.#writeOnce(path, envelope)))
      throw extensionError("VES_EXTENSION_APPROVAL_EXISTS", {}, "An approval is already on record");
  }

  // invariant: only an approval on record and not yet revoked can be revoked;
  // a refusal reads no credential and writes nothing.
  async assertRevocable(approvalRef: string): Promise<unknown> {
    const path = this.#path(approvalRef);
    const stored = (await this.#directoryPresent(false)) ? await this.#read(path) : undefined;
    if (stored === undefined)
      throw extensionError("VES_EXTENSION_APPROVAL_NOT_FOUND", {}, "No approval is on record for this reference");
    if ((await this.#read(this.#path(approvalRef, ".revoked"))) !== undefined)
      throw extensionError("VES_EXTENSION_APPROVAL_REVOKED", {}, "The approval is already revoked");
    return stored;
  }

  async revoke(
    approvalRef: string,
    signer: EvidenceSigner
  ): Promise<{ readonly approvalRef: string; readonly revokedAt: string }> {
    const stored = await this.assertRevocable(approvalRef);
    const revocationPath = this.#path(approvalRef, ".revoked");
    const approval = await this.#verifiedApproval(approvalRef, stored);
    if (approval === undefined)
      throw extensionError("VES_EXTENSION_FAILED", { reason: "VES_EXTENSION_APPROVAL_INVALID" }, "Approval is invalid");
    const revocation = { approvalRef, revokedAt: this.#now().toISOString() };
    const envelope = await sealRecord(signer, "extension-approval-revocation", revocation, {
      bindingId: approvalRef,
      sourceStateDigest: approval.artifactId
    });
    if (!(await this.#writeOnce(revocationPath, envelope)))
      throw extensionError("VES_EXTENSION_APPROVAL_REVOKED", {}, "The approval is already revoked");
    return Object.freeze(revocation);
  }

  async #verifiedApproval(approvalRef: string, stored: unknown) {
    const trust = await this.#trust();
    const artifact = await openRecord(trust, "extension-approval", stored, (content) => {
      const approval = approvalOf(content, approvalRef);
      return approval === undefined ? undefined : { bindingId: approvalRef, sourceStateDigest: approval.launchDigest };
    });
    if (artifact === undefined) return undefined;
    return {
      approval: approvalOf(artifact.payload, approvalRef) as ExtensionApproval,
      artifactId: artifact.artifactId
    };
  }

  async #revoked(approvalRef: string, approvalArtifactId: string): Promise<boolean | undefined> {
    const stored = await this.#read(this.#path(approvalRef, ".revoked"));
    if (stored === undefined) return false;
    const artifact = await openRecord(await this.#trust(), "extension-approval-revocation", stored, (content) =>
      isRecord(content) && content["approvalRef"] === approvalRef
        ? { bindingId: approvalRef, sourceStateDigest: approvalArtifactId }
        : undefined
    );
    return artifact === undefined ? undefined : true;
  }

  async #evaluate(approvalRef: string): Promise<Evaluation> {
    const stored = (await this.#directoryPresent(false)) ? await this.#read(this.#path(approvalRef)) : undefined;
    if (stored === undefined) return { state: "absent" };
    const verified = await this.#verifiedApproval(approvalRef, stored);
    if (verified === undefined) return { state: "invalid" };
    const revoked = await this.#revoked(approvalRef, verified.artifactId);
    if (revoked === undefined) return { state: "invalid" };
    if (revoked) return { state: "revoked", approval: verified.approval };
    const expiresAt = Date.parse(verified.approval.expiresAt);
    if (!Number.isFinite(expiresAt)) return { state: "invalid" };
    return { state: expiresAt > this.#now().getTime() ? "active" : "expired", approval: verified.approval };
  }

  // invariant: the approval port admission consults (WorkspaceProbeWorkerApprovals).
  async lookup(approvalRef: string): Promise<ExtensionApproval | undefined> {
    if (!APPROVAL_REF.test(approvalRef)) return undefined;
    const evaluation = await this.#evaluate(approvalRef);
    return evaluation.state === "active" ? evaluation.approval : undefined;
  }

  // invariant: every approval file, in code-unit order of its reference; an
  // approval that does not verify is listed `invalid` with nothing read from it.
  async list(): Promise<readonly ExtensionApprovalListing[]> {
    if (!(await this.#directoryPresent(false))) return Object.freeze([]);
    const references = (await readdir(this.#directory))
      .map((name) => /^([a-z0-9][a-z0-9_-]{0,127})\.json$/u.exec(name)?.[1])
      .filter((reference): reference is string => reference !== undefined)
      .sort(codeUnitCompare);
    const listing: ExtensionApprovalListing[] = [];
    for (const approvalRef of references) {
      const evaluation = await this.#evaluate(approvalRef);
      if (evaluation.state !== "absent") listing.push(listingOf(approvalRef, evaluation));
    }
    return Object.freeze(listing);
  }
}
