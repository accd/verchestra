import { mkdirSync } from "node:fs";
import { link, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { GeneralEncrypt, calculateJwkThumbprint, exportJWK, generalDecrypt, type GeneralJWE } from "jose";

import {
  ArtifactSealer,
  dsseEnvelopeOf,
  sealedArtifactFromEnvelope,
  sealedProjectionMatches
} from "../integrity/artifact-sealer.ts";
import { canonicalizeJson, sha256Digest } from "../integrity/canonical.ts";
import type { JsonValue, SealedArtifact, TrustRoot } from "../integrity/types.ts";

interface Row extends Record<string, unknown> {
  readonly approvalBindingDigest?: unknown;
  readonly bytes?: unknown;
  readonly claimDigest?: unknown;
  readonly createdAt?: unknown;
  readonly digest?: unknown;
  readonly excludedClasses?: unknown;
  readonly expiresAt?: unknown;
  readonly includedClasses?: unknown;
  readonly keyThumbprint?: unknown;
  readonly kind?: unknown;
  readonly logicalSecretBindings?: unknown;
  readonly memoryStateDigest?: unknown;
  readonly objectId?: unknown;
  readonly objects?: unknown;
  readonly planId?: unknown;
  readonly policyDigest?: unknown;
  readonly publicKey?: unknown;
  readonly recipientId?: unknown;
  readonly recipients?: unknown;
  readonly releaseDigest?: unknown;
  readonly required?: unknown;
  readonly runtimeStateDigest?: unknown;
  readonly schemaVersion?: unknown;
  readonly size?: unknown;
  readonly snapshotBarrierId?: unknown;
  readonly sourceStateDigest?: unknown;
  readonly uncertainEffectIds?: unknown;
  readonly workspaceId?: unknown;
}
type Digest = `sha256:${string}`;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const MANDATORY_EXCLUSIONS = Object.freeze([
  "credential-values",
  "machine-authentication",
  "provider-sessions",
  "secret-values",
  "vector-indexes"
] as const);
const PROHIBITED_FIELDS = new Set([
  "credential",
  "credentials",
  "secret",
  "secretValue",
  "providerToken",
  "sessionId",
  "transcript",
  "environmentValue",
  "row",
  "localPath",
  "absolutePath",
  "password",
  "token"
]);

export type RecoveryBundleErrorCode =
  | "VES_RECOVERY_INVALID"
  | "VES_RECOVERY_CLOSURE_INVALID"
  | "VES_RECOVERY_SIGNATURE_INVALID"
  | "VES_RECOVERY_RECIPIENT_DENIED"
  | "VES_RECOVERY_DECRYPT_FAILED"
  | "VES_RECOVERY_EXPIRED"
  | "VES_RECOVERY_NOT_YET_VALID"
  | "VES_RECOVERY_WORKSPACE_MISMATCH"
  | "VES_RECOVERY_SNAPSHOT_MOVED"
  | "VES_RECOVERY_SECRET_REBIND_REQUIRED"
  | "VES_RECOVERY_AUTHORITY_STALE"
  | "VES_RECOVERY_RECONCILIATION_REQUIRED"
  | "VES_RECOVERY_STORAGE_INVALID"
  | "VES_RECOVERY_STORAGE_CONFLICT"
  | "VES_RECOVERY_STORAGE_INTEGRITY";

export class RecoveryBundleError extends Error {
  readonly code: RecoveryBundleErrorCode;

  constructor(code: RecoveryBundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RecoveryBundleError";
    this.code = code;
  }
}

function fail(code: RecoveryBundleErrorCode, message: string, options?: ErrorOptions): never {
  throw new RecoveryBundleError(code, message, options);
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoProhibitedFields(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_FIELDS.has(key)) fail("VES_RECOVERY_INVALID", `Recovery input contains prohibited field ${key}`);
    assertNoProhibitedFields(entry, seen);
  }
}

function exactRow(value: unknown, label: string, allowed: readonly string[]): Row {
  if (!isRow(value)) fail("VES_RECOVERY_INVALID", `${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) fail("VES_RECOVERY_INVALID", `${label} contains unknown fields: ${extras.join(", ")}`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("VES_RECOVERY_INVALID", `${label} is invalid`);
  return value;
}

function thumbprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    fail("VES_RECOVERY_INVALID", `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_RECOVERY_INVALID", `${label} is invalid`);
  return value as Digest;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail("VES_RECOVERY_INVALID", `${label} must be a canonical instant`);
  return value;
}

function sortedUnique(values: unknown, label: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0))
    fail("VES_RECOVERY_INVALID", `${label} is invalid`);
  const normalized = values.map((value, index) => text(value, `${label}[${index}]`)).sort();
  if (new Set(normalized).size !== normalized.length) fail("VES_RECOVERY_INVALID", `${label} contains duplicates`);
  return Object.freeze(normalized);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeBase64url(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1)
    fail("VES_RECOVERY_CLOSURE_INVALID", "archive object bytes are invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value)
    fail("VES_RECOVERY_CLOSURE_INVALID", "archive object bytes are not canonical base64url");
  return new Uint8Array(decoded);
}

export interface RecoveryObjectInput {
  readonly objectId: string;
  readonly kind: string;
  readonly bytes: Uint8Array;
}

export interface RecoveryObjectRef {
  readonly objectId: string;
  readonly kind: string;
  readonly digest: Digest;
  readonly size: number;
  readonly required: true;
}

export interface RecoveryRecipientInput {
  readonly recipientId: string;
  readonly publicKey: CryptoKey;
}

export interface RecoveryRecipientRef {
  readonly recipientId: string;
  readonly keyThumbprint: string;
}

export interface RecoveryBundleManifest {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly workspaceId: string;
  readonly snapshotBarrierId: string;
  readonly runtimeStateDigest: Digest;
  readonly memoryStateDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly policyDigest: Digest;
  readonly approvalBindingDigest: Digest;
  readonly claimDigest: Digest;
  readonly releaseDigest: Digest;
  readonly includedClasses: readonly string[];
  readonly excludedClasses: readonly string[];
  readonly logicalSecretBindings: readonly string[];
  readonly uncertainEffectIds: readonly string[];
  readonly objects: readonly RecoveryObjectRef[];
  readonly recipients: readonly RecoveryRecipientRef[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface RecoveryBundlePlan {
  readonly planId: string;
  readonly manifest: RecoveryBundleManifest;
}

export type SignedRecoveryBundle = SealedArtifact<JsonValue> & {
  readonly payload: {
    readonly manifest: RecoveryBundleManifest;
    readonly jwe: GeneralJWE;
  };
};

const PLAN_FIELDS = Object.freeze([
  "schemaVersion",
  "planId",
  "workspaceId",
  "snapshotBarrierId",
  "runtimeStateDigest",
  "memoryStateDigest",
  "sourceStateDigest",
  "policyDigest",
  "approvalBindingDigest",
  "claimDigest",
  "releaseDigest",
  "includedClasses",
  "excludedClasses",
  "logicalSecretBindings",
  "uncertainEffectIds",
  "objects",
  "recipients",
  "createdAt",
  "expiresAt"
]);

function normalizeObjectInputs(value: unknown): readonly RecoveryObjectInput[] {
  if (!Array.isArray(value) || value.length === 0) fail("VES_RECOVERY_INVALID", "objects are required");
  const objects = value.map((entry, index) => {
    const row = exactRow(entry, `objects[${index}]`, ["objectId", "kind", "bytes"]);
    if (!(row.bytes instanceof Uint8Array)) fail("VES_RECOVERY_INVALID", `objects[${index}].bytes is invalid`);
    return Object.freeze({
      objectId: text(row.objectId, `objects[${index}].objectId`),
      kind: text(row.kind, `objects[${index}].kind`),
      bytes: new Uint8Array(row.bytes)
    });
  });
  objects.sort((left, right) => left.objectId.localeCompare(right.objectId));
  if (new Set(objects.map((entry) => entry.objectId)).size !== objects.length)
    fail("VES_RECOVERY_INVALID", "object IDs must be unique");
  return Object.freeze(objects);
}

function objectRefs(objects: readonly RecoveryObjectInput[]): readonly RecoveryObjectRef[] {
  return Object.freeze(
    objects.map((entry) =>
      Object.freeze({
        objectId: entry.objectId,
        kind: entry.kind,
        digest: `sha256:${sha256Bytes(entry.bytes)}` as Digest,
        size: entry.bytes.byteLength,
        required: true as const
      })
    )
  );
}

async function normalizeRecipientInputs(
  value: unknown
): Promise<readonly (RecoveryRecipientInput & RecoveryRecipientRef)[]> {
  if (!Array.isArray(value) || value.length === 0) fail("VES_RECOVERY_INVALID", "recipients are required");
  const normalized = await Promise.all(
    value.map(async (entry, index) => {
      const row = exactRow(entry, `recipients[${index}]`, ["recipientId", "publicKey"]);
      if (!(row.publicKey instanceof CryptoKey) || row.publicKey.type !== "public")
        fail("VES_RECOVERY_INVALID", `recipients[${index}].publicKey is invalid`);
      const publicKey = row.publicKey;
      const keyThumbprint = await calculateJwkThumbprint(await exportJWK(publicKey), "sha256");
      return Object.freeze({
        recipientId: text(row.recipientId, `recipients[${index}].recipientId`),
        publicKey,
        keyThumbprint
      });
    })
  );
  normalized.sort((left, right) => left.recipientId.localeCompare(right.recipientId));
  if (new Set(normalized.map((entry) => entry.recipientId)).size !== normalized.length)
    fail("VES_RECOVERY_INVALID", "recipient IDs must be unique");
  if (new Set(normalized.map((entry) => entry.keyThumbprint)).size !== normalized.length)
    fail("VES_RECOVERY_INVALID", "recipient keys must be unique");
  return Object.freeze(normalized);
}

function manifestMaterial(manifest: Omit<RecoveryBundleManifest, "planId">): JsonValue {
  return manifest as unknown as JsonValue;
}

function bindingFor(manifest: RecoveryBundleManifest) {
  return Object.freeze({
    schema: Object.freeze({ name: "recovery-bundle", version: 1 }),
    purpose: "recovery-bundle",
    bindingId: `${manifest.workspaceId}:${manifest.planId}`,
    sourceStateDigest: manifest.sourceStateDigest.slice("sha256:".length)
  });
}

function assertClosure(
  refs: readonly RecoveryObjectRef[],
  objectsInput: unknown,
  code: RecoveryBundleErrorCode = "VES_RECOVERY_CLOSURE_INVALID"
): readonly RecoveryObjectInput[] {
  let objects: readonly RecoveryObjectInput[];
  try {
    objects = normalizeObjectInputs(objectsInput);
  } catch (error) {
    if (error instanceof RecoveryBundleError) fail(code, "Recovery object closure is malformed", { cause: error });
    throw error;
  }
  if (refs.length !== objects.length) fail(code, "Recovery object closure is incomplete");
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    const object = objects[index];
    if (
      ref === undefined ||
      object === undefined ||
      ref.objectId !== object.objectId ||
      ref.kind !== object.kind ||
      ref.size !== object.bytes.byteLength ||
      ref.digest !== `sha256:${sha256Bytes(object.bytes)}`
    )
      fail(code, "Recovery object closure does not match its manifest");
  }
  return objects;
}

function validateManifestShape(value: unknown): RecoveryBundleManifest {
  const row = exactRow(value, "manifest", PLAN_FIELDS);
  if (row.schemaVersion !== 1) fail("VES_RECOVERY_INVALID", "manifest schema version is invalid");
  const includedClasses = sortedUnique(row.includedClasses, "includedClasses");
  const excludedClasses = sortedUnique(row.excludedClasses, "excludedClasses");
  for (const required of MANDATORY_EXCLUSIONS) {
    if (!excludedClasses.includes(required)) fail("VES_RECOVERY_INVALID", `mandatory exclusion ${required} is missing`);
  }
  if (includedClasses.some((entry) => excludedClasses.includes(entry)))
    fail("VES_RECOVERY_INVALID", "inclusion and exclusion decisions overlap");
  if (!Array.isArray(row.objects) || row.objects.length === 0)
    fail("VES_RECOVERY_INVALID", "manifest objects are invalid");
  const objects = row.objects.map((entry, index) => {
    const object = exactRow(entry, `manifest.objects[${index}]`, ["objectId", "kind", "digest", "size", "required"]);
    if (!Number.isSafeInteger(object.size) || (object.size as number) < 0 || object.required !== true)
      fail("VES_RECOVERY_INVALID", `manifest.objects[${index}] is invalid`);
    return Object.freeze({
      objectId: text(object.objectId, `manifest.objects[${index}].objectId`),
      kind: text(object.kind, `manifest.objects[${index}].kind`),
      digest: digest(object.digest, `manifest.objects[${index}].digest`),
      size: object.size as number,
      required: true as const
    });
  });
  objects.sort((left, right) => left.objectId.localeCompare(right.objectId));
  if (new Set(objects.map((entry) => entry.objectId)).size !== objects.length)
    fail("VES_RECOVERY_INVALID", "manifest object IDs are duplicated");
  if (!Array.isArray(row.recipients) || row.recipients.length === 0)
    fail("VES_RECOVERY_INVALID", "manifest recipients are invalid");
  const recipients = row.recipients.map((entry, index) => {
    const recipient = exactRow(entry, `manifest.recipients[${index}]`, ["recipientId", "keyThumbprint"]);
    return Object.freeze({
      recipientId: text(recipient.recipientId, `manifest.recipients[${index}].recipientId`),
      keyThumbprint: thumbprint(recipient.keyThumbprint, `manifest.recipients[${index}].keyThumbprint`)
    });
  });
  recipients.sort((left, right) => left.recipientId.localeCompare(right.recipientId));
  if (new Set(recipients.map((entry) => entry.recipientId)).size !== recipients.length)
    fail("VES_RECOVERY_INVALID", "manifest recipient IDs are duplicated");
  const createdAt = instant(row.createdAt, "createdAt");
  const expiresAt = instant(row.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(createdAt))
    fail("VES_RECOVERY_INVALID", "bundle expiry must follow creation");
  const withoutPlan = {
    schemaVersion: 1 as const,
    workspaceId: text(row.workspaceId, "workspaceId"),
    snapshotBarrierId: text(row.snapshotBarrierId, "snapshotBarrierId"),
    runtimeStateDigest: digest(row.runtimeStateDigest, "runtimeStateDigest"),
    memoryStateDigest: digest(row.memoryStateDigest, "memoryStateDigest"),
    sourceStateDigest: digest(row.sourceStateDigest, "sourceStateDigest"),
    policyDigest: digest(row.policyDigest, "policyDigest"),
    approvalBindingDigest: digest(row.approvalBindingDigest, "approvalBindingDigest"),
    claimDigest: digest(row.claimDigest, "claimDigest"),
    releaseDigest: digest(row.releaseDigest, "releaseDigest"),
    includedClasses,
    excludedClasses,
    logicalSecretBindings: sortedUnique(row.logicalSecretBindings, "logicalSecretBindings", true),
    uncertainEffectIds: sortedUnique(row.uncertainEffectIds, "uncertainEffectIds", true),
    objects: Object.freeze(objects),
    recipients: Object.freeze(recipients),
    createdAt,
    expiresAt
  };
  const planId = text(row.planId, "planId");
  if (sha256Digest(manifestMaterial(withoutPlan)) !== planId)
    fail("VES_RECOVERY_INVALID", "manifest plan identity is invalid");
  return deepFreeze({ ...withoutPlan, planId });
}

export class RecoveryBundleBuilder {
  readonly #sealer: ArtifactSealer;

  constructor(options: { readonly sealer: ArtifactSealer }) {
    this.#sealer = options.sealer;
  }

  async plan(input: unknown): Promise<RecoveryBundlePlan> {
    assertNoProhibitedFields(input);
    const row = exactRow(input, "recovery plan", PLAN_FIELDS);
    if (row.schemaVersion !== 1) fail("VES_RECOVERY_INVALID", "recovery schema version is invalid");
    const objects = normalizeObjectInputs(row.objects);
    const recipients = await normalizeRecipientInputs(row.recipients);
    const includedClasses = sortedUnique(row.includedClasses, "includedClasses");
    const excludedClasses = sortedUnique(row.excludedClasses, "excludedClasses");
    for (const required of MANDATORY_EXCLUSIONS) {
      if (!excludedClasses.includes(required))
        fail("VES_RECOVERY_INVALID", `mandatory exclusion ${required} is missing`);
    }
    if (includedClasses.some((entry) => excludedClasses.includes(entry)))
      fail("VES_RECOVERY_INVALID", "inclusion and exclusion decisions overlap");
    const createdAt = instant(row.createdAt, "createdAt");
    const expiresAt = instant(row.expiresAt, "expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(createdAt))
      fail("VES_RECOVERY_INVALID", "bundle expiry must follow creation");
    const material = deepFreeze({
      schemaVersion: 1 as const,
      workspaceId: text(row.workspaceId, "workspaceId"),
      snapshotBarrierId: text(row.snapshotBarrierId, "snapshotBarrierId"),
      runtimeStateDigest: digest(row.runtimeStateDigest, "runtimeStateDigest"),
      memoryStateDigest: digest(row.memoryStateDigest, "memoryStateDigest"),
      sourceStateDigest: digest(row.sourceStateDigest, "sourceStateDigest"),
      policyDigest: digest(row.policyDigest, "policyDigest"),
      approvalBindingDigest: digest(row.approvalBindingDigest, "approvalBindingDigest"),
      claimDigest: digest(row.claimDigest, "claimDigest"),
      releaseDigest: digest(row.releaseDigest, "releaseDigest"),
      includedClasses,
      excludedClasses,
      logicalSecretBindings: sortedUnique(row.logicalSecretBindings, "logicalSecretBindings", true),
      uncertainEffectIds: sortedUnique(row.uncertainEffectIds, "uncertainEffectIds", true),
      objects: objectRefs(objects),
      recipients: Object.freeze(
        recipients.map(({ recipientId, keyThumbprint }) => Object.freeze({ recipientId, keyThumbprint }))
      ),
      createdAt,
      expiresAt
    });
    const planId = sha256Digest(manifestMaterial(material));
    const manifest = deepFreeze({ ...material, planId });
    return deepFreeze({ planId, manifest });
  }

  async build(
    planInput: RecoveryBundlePlan,
    objectsInput: readonly RecoveryObjectInput[],
    recipientsInput: readonly RecoveryRecipientInput[]
  ): Promise<SignedRecoveryBundle> {
    if (!isRow(planInput) || !isRow(planInput.manifest) || planInput.planId !== planInput.manifest.planId)
      fail("VES_RECOVERY_INVALID", "recovery plan is malformed");
    const manifest = validateManifestShape(planInput.manifest);
    const objects = assertClosure(manifest.objects, objectsInput);
    const recipients = await normalizeRecipientInputs(recipientsInput);
    const expectedRecipients = manifest.recipients;
    if (
      recipients.length !== expectedRecipients.length ||
      recipients.some(
        (entry, index) =>
          entry.recipientId !== expectedRecipients[index]?.recipientId ||
          entry.keyThumbprint !== expectedRecipients[index]?.keyThumbprint
      )
    )
      fail("VES_RECOVERY_CLOSURE_INVALID", "recipient closure does not match its manifest");
    const archive = {
      schemaVersion: 1,
      planId: manifest.planId,
      objects: objects.map((entry) => ({
        objectId: entry.objectId,
        kind: entry.kind,
        bytes: Buffer.from(entry.bytes).toString("base64url")
      }))
    };
    const encryptor = new GeneralEncrypt(Buffer.from(canonicalizeJson(archive), "utf8")).setProtectedHeader({
      enc: "A256GCM",
      typ: "application/verchestra-recovery+json",
      v: 1,
      plan: manifest.planId
    });
    for (const recipient of recipients) {
      encryptor
        .addRecipient(recipient.publicKey)
        .setUnprotectedHeader({ alg: "ECDH-ES+A256KW", kid: recipient.recipientId });
    }
    const jwe = await encryptor.encrypt();
    const payload = { manifest, jwe };
    return deepFreeze(
      (await this.#sealer.seal(payload as unknown as JsonValue, bindingFor(manifest), {
        issuedAt: manifest.createdAt
      })) as SignedRecoveryBundle
    );
  }

  async inspect(
    bundle: SignedRecoveryBundle,
    trust: TrustRoot,
    expected: { readonly workspaceId: string; readonly now: string }
  ): Promise<{
    readonly planId: string;
    readonly workspaceId: string;
    readonly objectCount: number;
    readonly includedClasses: readonly string[];
    readonly excludedClasses: readonly string[];
    readonly recipients: readonly RecoveryRecipientRef[];
    readonly createdAt: string;
    readonly expiresAt: string;
  }> {
    const manifest = await this.#verifyEnvelope(bundle, trust, expected);
    return deepFreeze({
      planId: manifest.planId,
      workspaceId: manifest.workspaceId,
      objectCount: manifest.objects.length,
      includedClasses: manifest.includedClasses,
      excludedClasses: manifest.excludedClasses,
      recipients: manifest.recipients,
      createdAt: manifest.createdAt,
      expiresAt: manifest.expiresAt
    });
  }

  async open(
    bundle: SignedRecoveryBundle,
    trust: TrustRoot,
    receiver: { readonly recipientId: string; readonly privateKey: CryptoKey },
    expected: { readonly workspaceId: string; readonly now: string }
  ): Promise<{ readonly manifest: RecoveryBundleManifest; readonly objects: readonly RecoveryObjectInput[] }> {
    const manifest = await this.#verifyEnvelope(bundle, trust, expected);
    const recipientIndex = manifest.recipients.findIndex((entry) => entry.recipientId === receiver.recipientId);
    if (recipientIndex < 0) fail("VES_RECOVERY_RECIPIENT_DENIED", "receiver is not an authorized recipient");
    if (!(receiver.privateKey instanceof CryptoKey) || receiver.privateKey.type !== "private")
      fail("VES_RECOVERY_RECIPIENT_DENIED", "receiver key is invalid");
    const encryptedRecipient = bundle.payload.jwe.recipients[recipientIndex];
    if (encryptedRecipient?.header?.kid !== receiver.recipientId)
      fail("VES_RECOVERY_CLOSURE_INVALID", "encrypted recipient order does not match its manifest");
    let plaintext: Uint8Array;
    try {
      const selected: GeneralJWE = {
        ciphertext: bundle.payload.jwe.ciphertext,
        recipients: [encryptedRecipient],
        ...(bundle.payload.jwe.protected === undefined ? {} : { protected: bundle.payload.jwe.protected }),
        ...(bundle.payload.jwe.iv === undefined ? {} : { iv: bundle.payload.jwe.iv }),
        ...(bundle.payload.jwe.tag === undefined ? {} : { tag: bundle.payload.jwe.tag })
      };
      const decrypted = await generalDecrypt(selected, receiver.privateKey, {
        keyManagementAlgorithms: ["ECDH-ES+A256KW"],
        contentEncryptionAlgorithms: ["A256GCM"]
      });
      const protectedHeader = decrypted.protectedHeader;
      if (
        protectedHeader?.typ !== "application/verchestra-recovery+json" ||
        protectedHeader["v"] !== 1 ||
        protectedHeader["plan"] !== manifest.planId
      )
        fail("VES_RECOVERY_CLOSURE_INVALID", "protected encryption binding is invalid");
      plaintext = decrypted.plaintext;
    } catch (error) {
      if (error instanceof RecoveryBundleError) throw error;
      fail("VES_RECOVERY_DECRYPT_FAILED", "recovery bundle decryption failed", { cause: error });
    }
    let archive: Row;
    try {
      archive = JSON.parse(Buffer.from(plaintext).toString("utf8")) as Row;
    } catch (error) {
      fail("VES_RECOVERY_CLOSURE_INVALID", "decrypted recovery archive is malformed", { cause: error });
    }
    const archiveRow = exactRow(archive, "recovery archive", ["schemaVersion", "planId", "objects"]);
    if (archiveRow.schemaVersion !== 1 || archiveRow.planId !== manifest.planId || !Array.isArray(archiveRow.objects))
      fail("VES_RECOVERY_CLOSURE_INVALID", "decrypted recovery archive binding is invalid");
    const objects = archiveRow.objects.map((entry, index) => {
      const object = exactRow(entry, `archive.objects[${index}]`, ["objectId", "kind", "bytes"]);
      return {
        objectId: text(object.objectId, `archive.objects[${index}].objectId`),
        kind: text(object.kind, `archive.objects[${index}].kind`),
        bytes: decodeBase64url(object.bytes)
      };
    });
    return deepFreeze({ manifest, objects: assertClosure(manifest.objects, objects) });
  }

  async #verifyEnvelope(
    bundle: SignedRecoveryBundle,
    trust: TrustRoot,
    expected: { readonly workspaceId: string; readonly now: string }
  ): Promise<RecoveryBundleManifest> {
    if (
      !isRow(bundle) ||
      !isRow(bundle.schema) ||
      !isRow(bundle.payload) ||
      !isRow(bundle.payload.manifest) ||
      !isRow(bundle.payload.jwe)
    )
      fail("VES_RECOVERY_INVALID", "recovery bundle envelope is malformed");
    const verification = await this.#sealer.verify(bundle, trust, {
      schema: bundle.schema,
      purpose: bundle.purpose,
      bindingId: bundle.bindingId,
      sourceStateDigest: bundle.sourceStateDigest,
      now: new Date(instant(expected.now, "now"))
    });
    if (!verification.ok)
      fail("VES_RECOVERY_SIGNATURE_INVALID", `recovery bundle signature failed: ${verification.code}`);
    const manifest = validateManifestShape(bundle.payload.manifest);
    const binding = bindingFor(manifest);
    if (
      bundle.schema.name !== binding.schema.name ||
      bundle.schema.version !== binding.schema.version ||
      bundle.purpose !== binding.purpose ||
      bundle.bindingId !== binding.bindingId ||
      bundle.sourceStateDigest !== binding.sourceStateDigest
    )
      fail("VES_RECOVERY_SIGNATURE_INVALID", "signed recovery binding is invalid");
    if (manifest.workspaceId !== expected.workspaceId)
      fail("VES_RECOVERY_WORKSPACE_MISMATCH", "recovery bundle belongs to another Workspace");
    if (Date.parse(expected.now) < Date.parse(manifest.createdAt))
      fail("VES_RECOVERY_NOT_YET_VALID", "recovery bundle is not yet valid");
    if (Date.parse(expected.now) >= Date.parse(manifest.expiresAt))
      fail("VES_RECOVERY_EXPIRED", "recovery bundle expired");
    if (bundle.issuedAt !== manifest.createdAt)
      fail("VES_RECOVERY_SIGNATURE_INVALID", "bundle issue time is not manifest-bound");
    if (bundle.payload.jwe.recipients.length !== manifest.recipients.length)
      fail("VES_RECOVERY_CLOSURE_INVALID", "encrypted recipient closure is incomplete");
    return manifest;
  }
}

export interface SnapshotSource<T = unknown> {
  readonly sourceId: string;
  stateDigest(): Promise<string> | string;
  snapshot(): Promise<T> | T;
}

export class ConsistentSnapshotCoordinator {
  readonly #barrier: { run<T>(workspaceId: string, work: () => Promise<T>): Promise<T> };

  constructor(options: { readonly barrier: { run<T>(workspaceId: string, work: () => Promise<T>): Promise<T> } }) {
    this.#barrier = options.barrier;
  }

  async capture<T>(workspaceId: string, sourcesInput: readonly SnapshotSource<T>[]) {
    const sources = [...sourcesInput].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    if (sources.length === 0 || new Set(sources.map((entry) => entry.sourceId)).size !== sources.length)
      fail("VES_RECOVERY_INVALID", "snapshot sources are invalid");
    return this.#barrier.run(workspaceId, async () => {
      const before = await Promise.all(sources.map(async (source) => source.stateDigest()));
      const snapshots = [] as T[];
      for (const source of sources) snapshots.push(await source.snapshot());
      const after = await Promise.all(sources.map(async (source) => source.stateDigest()));
      if (before.some((entry, index) => entry !== after[index]))
        fail("VES_RECOVERY_SNAPSHOT_MOVED", "source state moved during the snapshot barrier");
      return deepFreeze(
        sources.map((source, index) => ({
          sourceId: source.sourceId,
          beforeDigest: before[index] as string,
          afterDigest: after[index] as string,
          snapshot: snapshots[index] as T
        }))
      );
    });
  }
}

type AuthorityResult = Readonly<Record<"policy" | "source" | "approvals" | "claims", string>>;

interface RecoveryStagingPort {
  stage(objects: readonly RecoveryObjectInput[]): Promise<unknown>;
  validate(handle: unknown): Promise<void>;
  activate(handle: unknown): Promise<void>;
  discard(handle: unknown): Promise<void>;
}

interface RecoveryAuthorityPort {
  reevaluate(manifest: RecoveryBundleManifest): Promise<AuthorityResult>;
}

interface RecoverySecretsPort {
  isBound(name: string): Promise<boolean>;
}

interface RecoveryEffectsPort {
  reconcile(effectId: string): Promise<string>;
}

export class RecoveryRestoreCoordinator {
  readonly #builder: RecoveryBundleBuilder;
  readonly #staging: RecoveryStagingPort;
  readonly #authority: RecoveryAuthorityPort;
  readonly #secrets: RecoverySecretsPort;
  readonly #effects: RecoveryEffectsPort;

  constructor(options: {
    readonly builder: RecoveryBundleBuilder;
    readonly staging: RecoveryStagingPort;
    readonly authority: RecoveryAuthorityPort;
    readonly secrets: RecoverySecretsPort;
    readonly effects: RecoveryEffectsPort;
  }) {
    this.#builder = options.builder;
    this.#staging = options.staging;
    this.#authority = options.authority;
    this.#secrets = options.secrets;
    this.#effects = options.effects;
  }

  async restore(
    bundle: SignedRecoveryBundle,
    trust: TrustRoot,
    receiver: { readonly recipientId: string; readonly privateKey: CryptoKey },
    expected: { readonly workspaceId: string; readonly now: string }
  ): Promise<{ readonly status: "activated"; readonly reconciledEffects: readonly string[] }> {
    const opened = await this.#builder.open(bundle, trust, receiver, expected);
    let handle: unknown;
    let staged = false;
    try {
      handle = await this.#staging.stage(opened.objects);
      staged = true;
      await this.#staging.validate(handle);
      for (const name of opened.manifest.logicalSecretBindings) {
        if (!(await this.#secrets.isBound(name)))
          fail("VES_RECOVERY_SECRET_REBIND_REQUIRED", `logical secret ${name} is not rebound`);
      }
      const authority = await this.#authority.reevaluate(opened.manifest);
      if (
        [authority.policy, authority.source, authority.approvals, authority.claims].some((value) => value !== "passed")
      )
        fail("VES_RECOVERY_AUTHORITY_STALE", "restored authority bindings are stale");
      const reconciledEffects: string[] = [];
      for (const effectId of opened.manifest.uncertainEffectIds) {
        const outcome = await this.#effects.reconcile(effectId);
        if (!new Set(["applied", "not-applied", "already-applied"]).has(outcome))
          fail("VES_RECOVERY_RECONCILIATION_REQUIRED", `effect ${effectId} requires reconciliation`);
        reconciledEffects.push(effectId);
      }
      await this.#staging.activate(handle);
      return deepFreeze({ status: "activated" as const, reconciledEffects });
    } catch (error) {
      if (staged) {
        try {
          await this.#staging.discard(handle);
        } catch {
          // Activation remains fail-closed; discard failure must not hide the primary failure.
        }
      }
      throw error;
    }
  }
}

async function safeRoot(configured: string): Promise<string> {
  const root = resolve(configured);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) fail("VES_RECOVERY_STORAGE_INVALID", "recovery store root is linked");
  return realpath(root);
}

async function safeTarget(root: string, target: string): Promise<void> {
  if (relative(root, target).startsWith("..")) fail("VES_RECOVERY_STORAGE_INVALID", "recovery target leaves root");
  try {
    if ((await lstat(target)).isSymbolicLink()) fail("VES_RECOVERY_STORAGE_INVALID", "recovery target is linked");
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
  }
}

function assertStoredEnvelope(bundle: SignedRecoveryBundle): void {
  try {
    if (
      !/^[a-f0-9]{64}$/u.test(bundle.artifactId) ||
      sha256Digest(bundle.payload) !== bundle.payloadDigest ||
      !sealedProjectionMatches(bundle)
    )
      fail("VES_RECOVERY_STORAGE_INTEGRITY", "recovery bundle content address is invalid");
  } catch (error) {
    if (error instanceof RecoveryBundleError) throw error;
    fail("VES_RECOVERY_STORAGE_INTEGRITY", "recovery bundle envelope is malformed", { cause: error });
  }
}

export class FileRecoveryBundleStore {
  readonly #root: string;

  constructor(options: { readonly root: string }) {
    this.#root = options.root;
  }

  async put(bundle: SignedRecoveryBundle): Promise<"published" | "already-published"> {
    assertStoredEnvelope(bundle);
    const manifest = validateManifestShape(bundle.payload.manifest);
    const root = await safeRoot(this.#root);
    const target = join(root, `${manifest.planId}.json`);
    await safeTarget(root, target);
    // The persisted object IS the DSSE envelope (#248); flat fields derive on read.
    const bytes = `${canonicalizeJson(dsseEnvelopeOf(bundle) as unknown as JsonValue)}\n`;
    try {
      const existing = await readFile(target, "utf8");
      if (existing !== bytes) fail("VES_RECOVERY_STORAGE_CONFLICT", "recovery plan already has different bytes");
      return "already-published";
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
    }
    const staging = join(root, `.recovery-${randomUUID()}.tmp`);
    try {
      await writeFile(staging, bytes, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
      try {
        await link(staging, target);
      } catch (error) {
        if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
        const existing = await readFile(target, "utf8");
        if (existing !== bytes) fail("VES_RECOVERY_STORAGE_CONFLICT", "recovery plan publication conflicted");
        return "already-published";
      }
      return "published";
    } finally {
      await rm(staging, { force: true });
    }
  }

  async get(planId: string): Promise<SignedRecoveryBundle> {
    if (!/^[a-f0-9]{64}$/u.test(planId)) fail("VES_RECOVERY_STORAGE_INVALID", "recovery plan ID is invalid");
    const root = await safeRoot(this.#root);
    const target = join(root, `${planId}.json`);
    await safeTarget(root, target);
    try {
      const stored = await readFile(target, "utf8");
      const envelope = JSON.parse(stored) as JsonValue;
      if (`${canonicalizeJson(envelope)}\n` !== stored)
        fail("VES_RECOVERY_STORAGE_INTEGRITY", "stored recovery bytes are not canonical");
      const bundle = sealedArtifactFromEnvelope(envelope) as SignedRecoveryBundle;
      assertStoredEnvelope(bundle);
      if (validateManifestShape(bundle.payload.manifest).planId !== planId)
        fail("VES_RECOVERY_STORAGE_INTEGRITY", "stored recovery plan identity is invalid");
      return deepFreeze(bundle);
    } catch (error) {
      if (error instanceof RecoveryBundleError) throw error;
      fail("VES_RECOVERY_STORAGE_INTEGRITY", "stored recovery bundle is unreadable", { cause: error });
    }
  }
}
