import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DatabaseProbeError,
  normalizeDatabaseAccessPolicy,
  normalizeDatabaseRegistration,
  type DatabaseAccessPolicy,
  type DatabaseRegistration,
  type DatabaseRegistrationStorePort
} from "@verchestra/data-probe";
import { canonicalizeJsonV2, codeUnitCompare } from "@verchestra/domain";
import type { DsseEnvelope, EvidenceSigner, JsonValue, TrustRoot } from "@verchestra/evidence";

import { openRecord, sealRecord } from "../extension/extension-seal.ts";
import { databaseError } from "./database-errors.ts";

// invariant: the identifier rule normalizeDatabaseRegistration applies to a
// database id, so a name that is no registration's id names no file here.
export const DATABASE_ID = /^[a-z][a-z0-9._-]{0,126}[a-z0-9]$/u;
const SCHEMA = "database-registration";
const SUFFIX = ".json";
const MAXIMUM_RECORD_BYTES = 1024 * 1024;
const DOCUMENT_KEYS = "policy,registeredAt,registration";
const ABSENT = Symbol("absent");

// invariant: door 1. What a registration file signs: the normalized
// registration with its digest, the normalized access policy whose policyRef
// is the database id, and the instant it was registered.
export interface DatabaseRegistrationDocument {
  readonly registration: DatabaseRegistration;
  readonly policy: DatabaseAccessPolicy;
  readonly registeredAt: string;
}

// invariant: one entry of `.verchestra/databases/`, named by its file name
// without `.json`; it carries a document only when it verifies and
// re-validates.
export interface DatabaseRegistrationEntry {
  readonly databaseId: string;
  readonly document?: DatabaseRegistrationDocument;
}

export type DatabaseRegistrationEvaluation =
  | { readonly state: "absent" | "invalid" }
  | { readonly state: "valid"; readonly document: DatabaseRegistrationDocument };

export interface DatabaseRegistrationFilesOptions {
  readonly repositoryRoot: string;
  readonly workspaceId: string;
  readonly trust: () => Promise<TrustRoot | undefined>;
}

type Row = Readonly<Record<string, unknown>>;
interface Body {
  readonly registration: Row;
  readonly policy: unknown;
  readonly registeredAt: string;
}

const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const errorCode = (error: unknown): unknown => (error as { readonly code?: unknown } | null)?.code;
const canonical = (value: unknown): string => canonicalizeJsonV2(value);

const bindingFor = (databaseId: string, digest: string) => ({
  bindingId: `database-registration:${databaseId}`,
  sourceStateDigest: digest
});

// invariant: door 1. A registration is sealed as the record of its own
// database id, over the digest of its registration.
export function sealRegistration(
  signer: EvidenceSigner,
  document: DatabaseRegistrationDocument
): Promise<DsseEnvelope> {
  const { databaseId, registrationDigest } = document.registration;
  return sealRecord(signer, SCHEMA, document as unknown as JsonValue, bindingFor(databaseId, registrationDigest));
}

function conflict(): never {
  throw new DatabaseProbeError(
    "VES_DATABASE_REGISTRATION_CONFLICT",
    "Database registration identity already has different content"
  );
}

function notFound(): never {
  throw new DatabaseProbeError("VES_DATABASE_NOT_FOUND", "Database registration was not found");
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function bodyOf(content: unknown): Body | undefined {
  if (!isRow(content) || Object.keys(content).sort(codeUnitCompare).join(",") !== DOCUMENT_KEYS) return undefined;
  const registration = content["registration"];
  const registeredAt = content["registeredAt"];
  return isRow(registration) && isInstant(registeredAt)
    ? { registration, policy: content["policy"], registeredAt }
    : undefined;
}

// why: the body is re-validated after its signature verified, so a record the
// Workspace key signed is still taken only in the exact form `vestra database
// add` writes: normalized, with the registration digest it recomputes.
function normalizedBody(body: Body): DatabaseRegistrationDocument | undefined {
  try {
    const input = Object.fromEntries(Object.entries(body.registration).filter(([key]) => key !== "registrationDigest"));
    const registration = normalizeDatabaseRegistration(input);
    const policy = normalizeDatabaseAccessPolicy(body.policy);
    const exact =
      canonical(registration) === canonical(body.registration) && canonical(policy) === canonical(body.policy);
    return exact ? Object.freeze({ registration, policy, registeredAt: body.registeredAt }) : undefined;
  } catch {
    return undefined;
  }
}

// invariant: AC 10. A registration belongs to its file only when it names this
// Workspace, the file's database id, and a policy of its own.
function belongs(document: DatabaseRegistrationDocument, databaseId: string, workspaceId: string): boolean {
  const { registration, policy } = document;
  return (
    registration.workspaceId === workspaceId &&
    registration.databaseId === databaseId &&
    registration.policyRef === databaseId &&
    policy.policyRef === databaseId
  );
}

function sameRegistration(left: DatabaseRegistrationDocument, right: DatabaseRegistrationDocument): boolean {
  return (
    left.registration.registrationDigest === right.registration.registrationDigest &&
    canonical(left.policy) === canonical(right.policy)
  );
}

// why: an absent path is an answer; any other failure to read it is not.
function lstatOrAbsent(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
}

// invariant: a directory on the registrations' path is real; a link or a file
// in its place is refused, never followed. An absent one answers false.
async function realDirectory(path: string): Promise<boolean> {
  const metadata = await lstatOrAbsent(path);
  if (metadata === undefined) return false;
  if (!metadata.isDirectory())
    throw databaseError("VES_DATABASE_DIRECTORY_INVALID", {}, "A database registration directory is not real");
  return true;
}

// invariant: a registration is read only as a bounded regular file; a link,
// a directory, or text that is not JSON is read as nothing that verifies.
async function storedEnvelope(path: string): Promise<unknown> {
  const metadata = await lstatOrAbsent(path);
  if (metadata === undefined) return ABSENT;
  if (!metadata.isFile() || metadata.size > MAXIMUM_RECORD_BYTES) return null;
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function linked(temporary: string, path: string): Promise<boolean> {
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

// invariant: door 1. `.verchestra/databases/<databaseId>.json` holds one
// Workspace's registration per database id, created exclusively and never
// rewritten; `.verchestra` and `databases` are real directories, and
// `databases` is created only by a write.
export class DatabaseRegistrationFiles {
  readonly #control: string;
  readonly #directory: string;
  readonly #workspaceId: string;
  readonly #trust: () => Promise<TrustRoot | undefined>;

  constructor(options: DatabaseRegistrationFilesOptions) {
    this.#control = join(options.repositoryRoot, ".verchestra");
    this.#directory = join(this.#control, "databases");
    this.#workspaceId = options.workspaceId;
    this.#trust = options.trust;
  }

  #path(databaseId: string): string {
    return join(this.#directory, `${databaseId}${SUFFIX}`);
  }

  async #present(): Promise<boolean> {
    return (await realDirectory(this.#control)) && (await realDirectory(this.#directory));
  }

  async #ensure(): Promise<void> {
    if (await this.#present()) return;
    await mkdir(this.#directory).catch((error: unknown) => {
      if (errorCode(error) !== "EEXIST") throw error;
    });
    // why: a writer racing this one may have created it; what is there now is
    // judged again.
    await realDirectory(this.#directory);
  }

  // why: the binding names the database id the file is named for, so a
  // registration renamed to another id never verifies there.
  async #verified(
    databaseId: string,
    stored: unknown,
    trust: TrustRoot | undefined
  ): Promise<DatabaseRegistrationDocument | undefined> {
    const artifact = await openRecord(trust, SCHEMA, stored, (content) => {
      const registration = isRow(content) ? content["registration"] : undefined;
      const digest = isRow(registration) ? registration["registrationDigest"] : undefined;
      return typeof digest === "string" ? bindingFor(databaseId, digest) : undefined;
    });
    const body = artifact === undefined ? undefined : bodyOf(artifact.payload);
    const document = body === undefined ? undefined : normalizedBody(body);
    return document !== undefined && belongs(document, databaseId, this.#workspaceId) ? document : undefined;
  }

  async evaluate(databaseId: string): Promise<DatabaseRegistrationEvaluation> {
    if (!DATABASE_ID.test(databaseId) || !(await this.#present())) return { state: "absent" };
    const stored = await storedEnvelope(this.#path(databaseId));
    if (stored === ABSENT) return { state: "absent" };
    const document = await this.#verified(databaseId, stored, await this.#trust());
    return document === undefined ? { state: "invalid" } : { state: "valid", document };
  }

  async #entry(name: string, trust: TrustRoot | undefined): Promise<DatabaseRegistrationEntry> {
    const named = name.endsWith(SUFFIX);
    const databaseId = named ? name.slice(0, -SUFFIX.length) : name;
    const document =
      named && DATABASE_ID.test(databaseId)
        ? await this.#verified(databaseId, await storedEnvelope(this.#path(databaseId)), trust)
        : undefined;
    return Object.freeze(document === undefined ? { databaseId } : { databaseId, document });
  }

  // invariant: AC 9 to AC 11. Every entry of the directory, in code-unit order
  // of its database id; an entry that does not verify carries no document.
  async entries(): Promise<readonly DatabaseRegistrationEntry[]> {
    if (!(await this.#present())) return Object.freeze([]);
    const trust = await this.#trust();
    const entries: DatabaseRegistrationEntry[] = [];
    for (const name of await readdir(this.#directory)) entries.push(await this.#entry(name, trust));
    return Object.freeze(entries.sort((left, right) => codeUnitCompare(left.databaseId, right.databaseId)));
  }

  // invariant: AC 6 and AC 7. The record for a document's id answers an add of
  // it: the same registration and policy is no change; anything else, an
  // entry that does not verify included, is a conflict; no record is
  // undefined.
  async existing(document: DatabaseRegistrationDocument): Promise<{ readonly created: false } | undefined> {
    const evaluation = await this.evaluate(document.registration.databaseId);
    if (evaluation.state === "absent") return undefined;
    if (evaluation.state === "valid" && sameRegistration(evaluation.document, document))
      return Object.freeze({ created: false });
    return conflict();
  }

  // invariant: AC 8. A registration is created whole and exclusively: its
  // envelope is written to a temporary file beside the directory, never in
  // it, and linked to its final name, which fails when that name exists; the
  // temporary file is always removed. A writer that loses answers as an add
  // of an existing id does.
  async create(document: DatabaseRegistrationDocument, signer: EvidenceSigner): Promise<{ readonly created: boolean }> {
    await this.#ensure();
    const envelope = await sealRegistration(signer, document);
    const temporary = join(this.#control, `.database-registration-${randomUUID()}.tmp`);
    let created: boolean;
    try {
      await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", flush: true });
      created = await linked(temporary, this.#path(document.registration.databaseId));
    } finally {
      await rm(temporary, { force: true });
    }
    if (created) return Object.freeze({ created: true });
    return (await this.existing(document)) ?? conflict();
  }

  // invariant: AC 12 and AC 13. A registration is removed by deleting its
  // file, whether or not it verifies; a link in its place is removed, never
  // followed.
  async remove(databaseId: string): Promise<void> {
    if (!DATABASE_ID.test(databaseId) || !(await this.#present())) notFound();
    const removed = await unlink(this.#path(databaseId)).then(
      () => true,
      (error: unknown) => {
        if (errorCode(error) === "ENOENT") return false;
        throw error;
      }
    );
    if (!removed) notFound();
  }
}

// invariant: door 2 and AC 14. The registration store slice 2b's planner
// reads: it answers only this Workspace's registrations that verify and
// re-validate, exactly those `vestra database list` reports valid.
export class WorkspaceDatabaseRegistrationStore implements DatabaseRegistrationStorePort {
  readonly #files: DatabaseRegistrationFiles;
  readonly #workspaceId: string;

  constructor(options: DatabaseRegistrationFilesOptions) {
    this.#files = new DatabaseRegistrationFiles(options);
    this.#workspaceId = options.workspaceId;
  }

  // why: the port's save carries no policy, and a Workspace registration is
  // written only with its own policy, by `vestra database add`; so it writes
  // nothing.
  save(): Promise<{ readonly created: boolean }> {
    return Promise.reject(
      new DatabaseProbeError(
        "VES_DATABASE_REGISTRATION_INVALID",
        "A Workspace database registration is written only with its policy, by vestra database add"
      )
    );
  }

  async load(workspaceId: string, databaseId: string): Promise<DatabaseRegistration | undefined> {
    if (workspaceId !== this.#workspaceId) return undefined;
    const evaluation = await this.#files.evaluate(databaseId);
    return evaluation.state === "valid" ? evaluation.document.registration : undefined;
  }

  async list(workspaceId: string): Promise<readonly DatabaseRegistration[]> {
    if (workspaceId !== this.#workspaceId) return Object.freeze([]);
    const entries = await this.#files.entries();
    return Object.freeze(
      entries.flatMap((entry) => (entry.document === undefined ? [] : [entry.document.registration]))
    );
  }
}
