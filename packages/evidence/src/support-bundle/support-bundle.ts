import { createHmac } from "node:crypto";

import { GeneralEncrypt, calculateJwkThumbprint, exportJWK, generalDecrypt, type GeneralJWE } from "jose";

import { ArtifactSealer } from "../integrity/artifact-sealer.ts";
import { canonicalizeJson, sha256Digest } from "../integrity/canonical.ts";
import type { JsonValue, SealedArtifact, TrustRoot } from "../integrity/types.ts";

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;
type DiagnosticValue = string | number | boolean | readonly string[];

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,239}$/u;
const CODE = /^[A-Z][A-Z0-9_:.@/-]{0,127}$/u;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/u;
const PATH_PSEUDONYM = /^path:sha256:[a-f0-9]{64}$/u;
const AUTHORITY_INJECTION =
  /(?:ignore.{0,16}policy|grant.{0,16}capabilit|access.{0,16}secret|execute.{0,16}tool|promote.{0,16}authority)/iu;
const SECRET_CONTENT =
  /(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|password\s*[=:]|(?:postgres|mysql|mariadb|sqlserver):\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|SQLite format 3)/iu;
const RAW_PATH = /(?:[A-Za-z]:[\\/]|(?:^|\s)\/(?:home|Users|var|opt|srv|tmp)\/)/u;

type FieldKind = "digest" | "semver" | "enum" | "integer" | "boolean" | "code-list" | "reference-list" | "path";

interface DiagnosticDefinition {
  readonly fieldId: string;
  readonly kind: FieldKind;
  readonly values?: readonly string[];
  readonly maximum?: number;
}

const DEFINITIONS = Object.freeze([
  { fieldId: "bundle.generator_version", kind: "semver" },
  { fieldId: "connector.availability_codes", kind: "code-list" },
  { fieldId: "database.binding_present", kind: "boolean" },
  {
    fieldId: "database.engine",
    kind: "enum",
    values: ["postgres", "mysql", "mariadb", "sqlserver", "sybase", "oracle", "db2", "sqlite"]
  },
  { fieldId: "diagnostic.path", kind: "path" },
  { fieldId: "doctor.check_codes", kind: "code-list" },
  { fieldId: "doctor.duration_ms", kind: "integer", maximum: 86_400_000 },
  { fieldId: "doctor.failure_codes", kind: "code-list" },
  { fieldId: "doctor.verdict", kind: "enum", values: ["PASS", "FAIL", "BLOCKED"] },
  { fieldId: "driver.availability_codes", kind: "code-list" },
  { fieldId: "error.codes", kind: "code-list" },
  { fieldId: "memory.integrity", kind: "enum", values: ["VALID", "INVALID", "UNAVAILABLE"] },
  { fieldId: "policy.view_digest", kind: "digest" },
  { fieldId: "release.digest", kind: "digest" },
  { fieldId: "release.version", kind: "semver" },
  { fieldId: "runtime.arch", kind: "enum", values: ["x64", "arm64"] },
  { fieldId: "runtime.node_version", kind: "semver" },
  { fieldId: "runtime.platform", kind: "enum", values: ["win32", "linux", "darwin"] },
  { fieldId: "self_test.check_count", kind: "integer", maximum: 1_000_000 },
  { fieldId: "self_test.duration_ms", kind: "integer", maximum: 86_400_000 },
  { fieldId: "self_test.evidence_refs", kind: "reference-list" },
  { fieldId: "self_test.failure_codes", kind: "code-list" },
  { fieldId: "self_test.profile", kind: "enum", values: ["smoke", "full", "workspace", "drivers"] },
  { fieldId: "self_test.redaction_count", kind: "integer", maximum: 1_000_000 },
  { fieldId: "self_test.verdict", kind: "enum", values: ["PASS", "FAIL", "BLOCKED"] },
  { fieldId: "state.integrity", kind: "enum", values: ["VALID", "INVALID", "UNAVAILABLE"] },
  { fieldId: "workspace.project_count", kind: "integer", maximum: 100_000 },
  {
    fieldId: "workspace.topology",
    kind: "enum",
    values: ["standalone", "monorepo", "centralized", "mixed", "external-control"]
  }
] satisfies readonly DiagnosticDefinition[]);

export type SupportBundleErrorCode =
  | "VES_SUPPORT_INVALID"
  | "VES_SUPPORT_FIELD_DENIED"
  | "VES_SUPPORT_VALUE_INVALID"
  | "VES_SUPPORT_CONTENT_PROHIBITED"
  | "VES_SUPPORT_INSPECTION_STALE"
  | "VES_SUPPORT_APPROVAL_DENIED"
  | "VES_SUPPORT_EGRESS_DENIED"
  | "VES_SUPPORT_EXPORT_UNAUTHORIZED"
  | "VES_SUPPORT_RECIPIENT_DENIED"
  | "VES_SUPPORT_DECRYPT_FAILED"
  | "VES_SUPPORT_SIGNATURE_INVALID"
  | "VES_SUPPORT_EXPIRED"
  | "VES_SUPPORT_NOT_YET_VALID"
  | "VES_SUPPORT_WORKSPACE_MISMATCH"
  | "VES_SUPPORT_RUN_MISMATCH";

export class SupportBundleError extends Error {
  readonly code: SupportBundleErrorCode;

  constructor(code: SupportBundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SupportBundleError";
    this.code = code;
  }
}

function fail(code: SupportBundleErrorCode, message: string, options?: ErrorOptions): never {
  throw new SupportBundleError(code, message, options);
}

function row(value: unknown, label: string, allowed: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_SUPPORT_INVALID", `${label} must be an object`);
  const result = value as Row;
  const extras = Object.keys(result).filter((key) => !allowed.includes(key));
  if (extras.length > 0) fail("VES_SUPPORT_INVALID", `${label} contains unknown fields`);
  return result;
}

function safe(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("VES_SUPPORT_INVALID", `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_SUPPORT_VALUE_INVALID", `${label} is invalid`);
  return value as Digest;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail("VES_SUPPORT_INVALID", `${label} must be a canonical instant`);
  return value;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value) || ArrayBuffer.isView(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalizeJson(value as unknown as JsonValue)) as T;
}

export class HmacPathPseudonymizer {
  readonly #key: Uint8Array;

  constructor(options: { readonly key: Uint8Array }) {
    if (options.key.byteLength < 32) fail("VES_SUPPORT_INVALID", "path pseudonym key is too short");
    this.#key = new Uint8Array(options.key);
  }

  pseudonymize(workspaceId: string, path: string): string {
    if (!/^(?:[A-Za-z]:[\\/]|\/)/u.test(path) || path.includes("\0"))
      fail("VES_SUPPORT_VALUE_INVALID", "diagnostic path must be absolute");
    const normalized = path.replaceAll("\\", "/").replaceAll(/\/{2,}/gu, "/");
    return `path:sha256:${createHmac("sha256", this.#key).update(`${workspaceId}\0${normalized}`, "utf8").digest("hex")}`;
  }
}

export class ProhibitedContentScanner {
  assertSafe(value: unknown, seen = new Set<object>(), budget = { nodes: 0 }): void {
    budget.nodes += 1;
    if (budget.nodes > 10_000) fail("VES_SUPPORT_CONTENT_PROHIBITED", "diagnostic content exceeds scanner bounds");
    if (typeof value === "string") {
      if (
        value.length > 512 ||
        value.includes("\n") ||
        value.includes("\r") ||
        SECRET_CONTENT.test(value) ||
        AUTHORITY_INJECTION.test(value) ||
        (RAW_PATH.test(value) && !PATH_PSEUDONYM.test(value))
      )
        fail("VES_SUPPORT_CONTENT_PROHIBITED", "diagnostic content matches a prohibited class");
      return;
    }
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 100) fail("VES_SUPPORT_CONTENT_PROHIBITED", "diagnostic array exceeds scanner bounds");
      for (const entry of value) this.assertSafe(entry, seen, budget);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (/(?:source|prompt|context|credential|secret|environment|row|raw|transcript|log|database)/iu.test(key))
        fail("VES_SUPPORT_CONTENT_PROHIBITED", "diagnostic object contains a prohibited field class");
      this.assertSafe(entry, seen, budget);
    }
  }
}

export class SupportCodeRegistry {
  readonly #codes: ReadonlySet<string>;
  readonly digest: Digest;

  constructor(options: { readonly codes: readonly string[] }) {
    const codes = [...options.codes].sort();
    if (
      codes.length === 0 ||
      codes.length > 10_000 ||
      new Set(codes).size !== codes.length ||
      codes.some((code) => !CODE.test(code))
    )
      fail("VES_SUPPORT_INVALID", "stable diagnostic code registry is invalid");
    this.#codes = new Set(codes);
    this.digest = `sha256:${sha256Digest(codes)}`;
    Object.freeze(this);
  }

  has(code: string): boolean {
    return this.#codes.has(code);
  }
}

export class StableErrorDiagnosticAdapter {
  readonly #registry: SupportCodeRegistry;

  constructor(options: { readonly registry: SupportCodeRegistry }) {
    this.#registry = options.registry;
  }

  adapt(error: unknown): readonly { readonly fieldId: "error.codes"; readonly value: readonly string[] }[] {
    const code =
      error !== null && typeof error === "object" && typeof (error as { readonly code?: unknown }).code === "string"
        ? (error as { readonly code: string }).code
        : "VES_UNKNOWN_FAILURE";
    if (!CODE.test(code) || !this.#registry.has(code))
      fail("VES_SUPPORT_VALUE_INVALID", "stable error code is not registered");
    return deepFreeze([{ fieldId: "error.codes" as const, value: [code] }]);
  }
}

function normalizeList(value: unknown, pattern: RegExp): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50)
    fail("VES_SUPPORT_VALUE_INVALID", "diagnostic list is invalid");
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !pattern.test(entry))
      fail("VES_SUPPORT_VALUE_INVALID", "diagnostic list value is invalid");
    return entry;
  });
  normalized.sort();
  if (new Set(normalized).size !== normalized.length)
    fail("VES_SUPPORT_VALUE_INVALID", "diagnostic list contains duplicates");
  return Object.freeze(normalized);
}

function normalizeDiagnosticValue(
  definition: DiagnosticDefinition,
  value: unknown,
  workspaceId: string,
  pseudonymizer: HmacPathPseudonymizer,
  codeRegistry: SupportCodeRegistry
): { readonly value: DiagnosticValue; readonly pseudonymized: boolean } {
  switch (definition.kind) {
    case "digest":
      return { value: digest(value, definition.fieldId), pseudonymized: false };
    case "semver":
      if (typeof value !== "string" || !SEMVER.test(value))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return { value, pseudonymized: false };
    case "enum":
      if (typeof value !== "string" || !definition.values?.includes(value))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return { value, pseudonymized: false };
    case "integer":
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) > (definition.maximum ?? 1_000_000)
      )
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return { value: value as number, pseudonymized: false };
    case "boolean":
      if (typeof value !== "boolean") fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return { value, pseudonymized: false };
    case "code-list": {
      const codes = normalizeList(value, CODE);
      if (codes.some((code) => !codeRegistry.has(code)))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} contains an unregistered code`);
      return { value: codes, pseudonymized: false };
    }
    case "reference-list":
      return { value: normalizeList(value, REFERENCE), pseudonymized: false };
    case "path":
      if (typeof value !== "string") fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return { value: pseudonymizer.pseudonymize(workspaceId, value), pseudonymized: true };
  }
}

function assertNormalizedValue(
  definition: DiagnosticDefinition,
  value: unknown,
  codeRegistry: SupportCodeRegistry
): void {
  switch (definition.kind) {
    case "digest":
      digest(value, definition.fieldId);
      return;
    case "semver":
      if (typeof value !== "string" || !SEMVER.test(value))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return;
    case "enum":
      if (typeof value !== "string" || !definition.values?.includes(value))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return;
    case "integer":
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) > (definition.maximum ?? 1_000_000)
      )
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return;
    case "boolean":
      if (typeof value !== "boolean") fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
      return;
    case "code-list":
      if (normalizeList(value, CODE).some((code) => !codeRegistry.has(code)))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} contains an unregistered code`);
      return;
    case "reference-list":
      normalizeList(value, REFERENCE);
      return;
    case "path":
      if (typeof value !== "string" || !PATH_PSEUDONYM.test(value))
        fail("VES_SUPPORT_VALUE_INVALID", `${definition.fieldId} is invalid`);
  }
}

export interface SupportDiagnostic {
  readonly fieldId: string;
  readonly value: DiagnosticValue;
}

export interface SupportRecipientInput {
  readonly recipientId: string;
  readonly publicKey: CryptoKey;
}

export interface SupportRecipientRef {
  readonly recipientId: string;
  readonly keyThumbprint: string;
}

export interface SupportBundleManifest {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly registryVersion: string;
  readonly registryDigest: Digest;
  readonly codeRegistryDigest: Digest;
  readonly workspaceId: string;
  readonly runId: string;
  readonly releaseDigest: Digest;
  readonly diagnostics: readonly SupportDiagnostic[];
  readonly redactionSummary: { readonly pathsPseudonymized: number; readonly prohibitedFieldsExcluded: 10 };
  readonly recipients: readonly SupportRecipientRef[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SupportBundlePlan {
  readonly planId: string;
  readonly manifest: SupportBundleManifest;
}

export interface SupportBundleInspection {
  readonly planId: string;
  readonly inspectionDigest: Digest;
  readonly workspaceId: string;
  readonly runId: string;
  readonly registryVersion: string;
  readonly registryDigest: Digest;
  readonly codeRegistryDigest: Digest;
  readonly fieldCount: number;
  readonly diagnostics: readonly SupportDiagnostic[];
  readonly redactionSummary: SupportBundleManifest["redactionSummary"];
  readonly recipients: readonly SupportRecipientRef[];
  readonly expiresAt: string;
}

interface SupportBundleSummary {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly registryVersion: string;
  readonly registryDigest: Digest;
  readonly codeRegistryDigest: Digest;
  readonly releaseDigest: Digest;
  readonly fields: readonly { readonly fieldId: string; readonly valueDigest: Digest }[];
  readonly redactionSummary: SupportBundleManifest["redactionSummary"];
  readonly recipients: readonly SupportRecipientRef[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly approvalBindingDigest: Digest;
  readonly egressDecisionDigest: Digest;
  readonly destinationId: string;
}

export type SignedSupportBundle = SealedArtifact<JsonValue> & {
  readonly payload: { readonly summary: SupportBundleSummary; readonly jwe: GeneralJWE };
};

async function normalizeRecipients(value: unknown): Promise<readonly (SupportRecipientInput & SupportRecipientRef)[]> {
  if (!Array.isArray(value) || value.length === 0)
    fail("VES_SUPPORT_INVALID", "Support Bundle recipients are required");
  const normalized = await Promise.all(
    value.map(async (entry, index) => {
      const item = row(entry, `recipients[${index}]`, ["recipientId", "publicKey"]);
      const publicKey = item["publicKey"];
      if (!(publicKey instanceof CryptoKey) || publicKey.type !== "public")
        fail("VES_SUPPORT_INVALID", "Support Bundle recipient key is invalid");
      return {
        recipientId: safe(item["recipientId"], `recipients[${index}].recipientId`),
        publicKey,
        keyThumbprint: await calculateJwkThumbprint(await exportJWK(publicKey), "sha256")
      };
    })
  );
  normalized.sort((left, right) => left.recipientId.localeCompare(right.recipientId));
  if (
    new Set(normalized.map((entry) => entry.recipientId)).size !== normalized.length ||
    new Set(normalized.map((entry) => entry.keyThumbprint)).size !== normalized.length
  )
    fail("VES_SUPPORT_INVALID", "Support Bundle recipients must be unique");
  return Object.freeze(normalized);
}

function registryDigest(): Digest {
  return `sha256:${sha256Digest(DEFINITIONS)}`;
}

function manifestMaterial(manifest: Omit<SupportBundleManifest, "planId">): JsonValue {
  return manifest as unknown as JsonValue;
}

function bindingFor(summary: SupportBundleSummary) {
  return Object.freeze({
    schema: Object.freeze({ name: "support-bundle", version: 1 }),
    purpose: "support-bundle",
    bindingId: `${summary.workspaceId}:${summary.runId}:${summary.planId}:${summary.destinationId}`,
    sourceStateDigest: summary.planId
  });
}

const authorizedTokens = new WeakSet<object>();

interface ExportAuthorization {
  readonly planId: string;
  readonly approvalBindingDigest: Digest;
  readonly egressDecisionDigest: Digest;
  readonly destinationId: string;
}

export class SupportBundleBuilder {
  readonly #sealer: ArtifactSealer;
  readonly #pseudonymizer: HmacPathPseudonymizer;
  readonly #scanner: ProhibitedContentScanner;
  readonly #codeRegistry: SupportCodeRegistry;

  constructor(options: {
    readonly sealer: ArtifactSealer;
    readonly pseudonymizer: HmacPathPseudonymizer;
    readonly scanner?: ProhibitedContentScanner;
    readonly codeRegistry: SupportCodeRegistry;
  }) {
    this.#sealer = options.sealer;
    this.#pseudonymizer = options.pseudonymizer;
    this.#scanner = options.scanner ?? new ProhibitedContentScanner();
    this.#codeRegistry = options.codeRegistry;
  }

  async plan(input: unknown): Promise<SupportBundlePlan> {
    const value = row(input, "Support Bundle input", [
      "schemaVersion",
      "registryVersion",
      "workspaceId",
      "runId",
      "releaseDigest",
      "diagnostics",
      "recipients",
      "createdAt",
      "expiresAt"
    ]);
    if (value["schemaVersion"] !== 1 || value["registryVersion"] !== "1.0.0")
      fail("VES_SUPPORT_INVALID", "Support Bundle schema or registry version is invalid");
    const workspaceId = safe(value["workspaceId"], "workspaceId");
    const runId = safe(value["runId"], "runId");
    const releaseDigest = digest(value["releaseDigest"], "releaseDigest");
    if (!Array.isArray(value["diagnostics"]) || value["diagnostics"].length === 0 || value["diagnostics"].length > 100)
      fail("VES_SUPPORT_INVALID", "Support Bundle diagnostics are invalid");
    let pathsPseudonymized = 0;
    const diagnostics = value["diagnostics"].map((entry, index) => {
      const diagnostic = row(entry, `diagnostics[${index}]`, ["fieldId", "value"]);
      const fieldId = safe(diagnostic["fieldId"], `diagnostics[${index}].fieldId`);
      const definition = DEFINITIONS.find((candidate) => candidate.fieldId === fieldId);
      if (definition === undefined) fail("VES_SUPPORT_FIELD_DENIED", `diagnostic field ${fieldId} is not allowlisted`);
      const normalized = normalizeDiagnosticValue(
        definition,
        diagnostic["value"],
        workspaceId,
        this.#pseudonymizer,
        this.#codeRegistry
      );
      if (normalized.pseudonymized) pathsPseudonymized += 1;
      return Object.freeze({ fieldId, value: normalized.value });
    });
    diagnostics.sort((left, right) => left.fieldId.localeCompare(right.fieldId));
    if (new Set(diagnostics.map((entry) => entry.fieldId)).size !== diagnostics.length)
      fail("VES_SUPPORT_INVALID", "diagnostic fields must be unique");
    const releaseField = diagnostics.find((entry) => entry.fieldId === "release.digest");
    if (releaseField !== undefined && releaseField.value !== releaseDigest)
      fail("VES_SUPPORT_VALUE_INVALID", "release diagnostic does not match the bundle release");
    const recipients = await normalizeRecipients(value["recipients"]);
    const createdAt = instant(value["createdAt"], "createdAt");
    const expiresAt = instant(value["expiresAt"], "expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail("VES_SUPPORT_INVALID", "Support Bundle expiry is invalid");
    const material = deepFreeze({
      schemaVersion: 1 as const,
      registryVersion: "1.0.0",
      registryDigest: registryDigest(),
      codeRegistryDigest: this.#codeRegistry.digest,
      workspaceId,
      runId,
      releaseDigest,
      diagnostics: Object.freeze(diagnostics),
      redactionSummary: Object.freeze({ pathsPseudonymized, prohibitedFieldsExcluded: 10 as const }),
      recipients: Object.freeze(
        recipients.map(({ recipientId, keyThumbprint }) => Object.freeze({ recipientId, keyThumbprint }))
      ),
      createdAt,
      expiresAt
    });
    this.#scanner.assertSafe({ diagnostics: material.diagnostics, redactionSummary: material.redactionSummary });
    const planId = sha256Digest(manifestMaterial(material));
    return deepFreeze({ planId, manifest: { ...material, planId } });
  }

  inspect(plan: SupportBundlePlan): SupportBundleInspection {
    this.#assertPlan(plan);
    const manifest = plan.manifest;
    const inspection = {
      planId: plan.planId,
      workspaceId: manifest.workspaceId,
      runId: manifest.runId,
      registryVersion: manifest.registryVersion,
      registryDigest: manifest.registryDigest,
      codeRegistryDigest: manifest.codeRegistryDigest,
      fieldCount: manifest.diagnostics.length,
      diagnostics: manifest.diagnostics,
      redactionSummary: manifest.redactionSummary,
      recipients: manifest.recipients,
      expiresAt: manifest.expiresAt
    };
    return deepFreeze({ ...inspection, inspectionDigest: `sha256:${sha256Digest(inspection)}` as Digest });
  }

  async authorizedBuild(
    plan: SupportBundlePlan,
    recipientsInput: readonly SupportRecipientInput[],
    authorization: ExportAuthorization
  ): Promise<SignedSupportBundle> {
    if (!authorizedTokens.has(authorization) || authorization.planId !== plan.planId)
      fail("VES_SUPPORT_EXPORT_UNAUTHORIZED", "Support Bundle encryption requires current export authority");
    authorizedTokens.delete(authorization);
    this.#assertPlan(plan);
    const recipients = await normalizeRecipients(recipientsInput);
    if (
      recipients.length !== plan.manifest.recipients.length ||
      recipients.some(
        (entry, index) =>
          entry.recipientId !== plan.manifest.recipients[index]?.recipientId ||
          entry.keyThumbprint !== plan.manifest.recipients[index]?.keyThumbprint
      )
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle recipient closure changed after inspection");
    this.#scanner.assertSafe(plan.manifest);
    const archive = Buffer.from(canonicalizeJson(plan.manifest as unknown as JsonValue), "utf8");
    const encryptor = new GeneralEncrypt(archive).setProtectedHeader({
      enc: "A256GCM",
      typ: "application/verchestra-support+json",
      v: 1,
      plan: plan.planId
    });
    for (const recipient of recipients) {
      encryptor
        .addRecipient(recipient.publicKey)
        .setUnprotectedHeader({ alg: "ECDH-ES+A256KW", kid: recipient.recipientId });
    }
    const summary: SupportBundleSummary = deepFreeze({
      schemaVersion: 1,
      planId: plan.planId,
      workspaceId: plan.manifest.workspaceId,
      runId: plan.manifest.runId,
      registryVersion: plan.manifest.registryVersion,
      registryDigest: plan.manifest.registryDigest,
      codeRegistryDigest: plan.manifest.codeRegistryDigest,
      releaseDigest: plan.manifest.releaseDigest,
      fields: plan.manifest.diagnostics.map((entry) => ({
        fieldId: entry.fieldId,
        valueDigest: `sha256:${sha256Digest(entry.value)}` as Digest
      })),
      redactionSummary: plan.manifest.redactionSummary,
      recipients: plan.manifest.recipients,
      createdAt: plan.manifest.createdAt,
      expiresAt: plan.manifest.expiresAt,
      approvalBindingDigest: authorization.approvalBindingDigest,
      egressDecisionDigest: authorization.egressDecisionDigest,
      destinationId: authorization.destinationId
    });
    const payload = { summary, jwe: await encryptor.encrypt() };
    return deepFreeze(
      (await this.#sealer.seal(payload as unknown as JsonValue, bindingFor(summary), {
        issuedAt: summary.createdAt
      })) as SignedSupportBundle
    );
  }

  async open(
    bundle: SignedSupportBundle,
    trust: TrustRoot,
    receiver: { readonly recipientId: string; readonly privateKey: CryptoKey },
    expected: { readonly workspaceId: string; readonly runId: string; readonly now: string }
  ): Promise<SupportBundleManifest> {
    if (bundle === null || typeof bundle !== "object" || bundle.payload === null || typeof bundle.payload !== "object")
      fail("VES_SUPPORT_INVALID", "Support Bundle envelope is malformed");
    const now = instant(expected.now, "now");
    const verification = await this.#sealer.verify(bundle, trust, {
      schema: bundle.schema,
      purpose: bundle.purpose,
      bindingId: bundle.bindingId,
      sourceStateDigest: bundle.sourceStateDigest,
      now: new Date(now)
    });
    if (!verification.ok)
      fail("VES_SUPPORT_SIGNATURE_INVALID", `Support Bundle signature failed: ${verification.code}`);
    const summary = bundle.payload.summary;
    const binding = bindingFor(summary);
    if (
      bundle.schema.name !== binding.schema.name ||
      bundle.schema.version !== binding.schema.version ||
      bundle.purpose !== binding.purpose ||
      bundle.bindingId !== binding.bindingId ||
      bundle.sourceStateDigest !== binding.sourceStateDigest ||
      bundle.issuedAt !== summary.createdAt
    )
      fail("VES_SUPPORT_SIGNATURE_INVALID", "Support Bundle binding is invalid");
    if (summary.workspaceId !== expected.workspaceId)
      fail("VES_SUPPORT_WORKSPACE_MISMATCH", "Support Bundle belongs to another Workspace");
    if (summary.runId !== expected.runId) fail("VES_SUPPORT_RUN_MISMATCH", "Support Bundle belongs to another run");
    if (Date.parse(now) < Date.parse(summary.createdAt))
      fail("VES_SUPPORT_NOT_YET_VALID", "Support Bundle is not yet valid");
    if (Date.parse(now) >= Date.parse(summary.expiresAt)) fail("VES_SUPPORT_EXPIRED", "Support Bundle expired");
    const recipientIndex = summary.recipients.findIndex((entry) => entry.recipientId === receiver.recipientId);
    if (recipientIndex < 0 || !(receiver.privateKey instanceof CryptoKey) || receiver.privateKey.type !== "private")
      fail("VES_SUPPORT_RECIPIENT_DENIED", "Support Bundle recipient is not authorized");
    const encryptedRecipient = bundle.payload.jwe.recipients[recipientIndex];
    if (encryptedRecipient?.header?.kid !== receiver.recipientId)
      fail("VES_SUPPORT_SIGNATURE_INVALID", "Support Bundle recipient closure is invalid");
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
      if (
        decrypted.protectedHeader?.typ !== "application/verchestra-support+json" ||
        decrypted.protectedHeader["v"] !== 1 ||
        decrypted.protectedHeader["plan"] !== summary.planId
      )
        fail("VES_SUPPORT_DECRYPT_FAILED", "Support Bundle encryption binding is invalid");
      plaintext = decrypted.plaintext;
    } catch (error) {
      if (error instanceof SupportBundleError) throw error;
      fail("VES_SUPPORT_DECRYPT_FAILED", "Support Bundle decryption failed", { cause: error });
    }
    let manifest: SupportBundleManifest;
    try {
      manifest = JSON.parse(Buffer.from(plaintext).toString("utf8")) as SupportBundleManifest;
      this.#assertPlan({ planId: manifest.planId, manifest });
    } catch (error) {
      if (error instanceof SupportBundleError) throw error;
      fail("VES_SUPPORT_DECRYPT_FAILED", "Support Bundle archive is malformed", { cause: error });
    }
    if (
      manifest.planId !== summary.planId ||
      manifest.workspaceId !== summary.workspaceId ||
      manifest.runId !== summary.runId ||
      manifest.registryDigest !== summary.registryDigest ||
      manifest.codeRegistryDigest !== summary.codeRegistryDigest ||
      manifest.releaseDigest !== summary.releaseDigest ||
      canonicalizeJson(
        manifest.diagnostics.map((entry) => ({
          fieldId: entry.fieldId,
          valueDigest: `sha256:${sha256Digest(entry.value)}`
        }))
      ) !== canonicalizeJson(summary.fields)
    )
      fail("VES_SUPPORT_DECRYPT_FAILED", "Support Bundle archive does not match its signed summary");
    this.#scanner.assertSafe(manifest);
    return deepFreeze(cloneJson(manifest));
  }

  #assertPlan(plan: SupportBundlePlan): void {
    if (
      plan === null ||
      typeof plan !== "object" ||
      plan.manifest === null ||
      typeof plan.manifest !== "object" ||
      plan.planId !== plan.manifest.planId
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle plan is malformed");
    const manifest = row(plan.manifest, "Support Bundle manifest", [
      "schemaVersion",
      "planId",
      "registryVersion",
      "registryDigest",
      "codeRegistryDigest",
      "workspaceId",
      "runId",
      "releaseDigest",
      "diagnostics",
      "redactionSummary",
      "recipients",
      "createdAt",
      "expiresAt"
    ]);
    if (
      manifest["schemaVersion"] !== 1 ||
      manifest["registryVersion"] !== "1.0.0" ||
      manifest["registryDigest"] !== registryDigest() ||
      manifest["codeRegistryDigest"] !== this.#codeRegistry.digest ||
      typeof manifest["planId"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(manifest["planId"])
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle manifest identity is invalid");
    safe(manifest["workspaceId"], "workspaceId");
    safe(manifest["runId"], "runId");
    const releaseDigest = digest(manifest["releaseDigest"], "releaseDigest");
    const createdAt = instant(manifest["createdAt"], "createdAt");
    const expiresAt = instant(manifest["expiresAt"], "expiresAt");
    if (Date.parse(expiresAt) <= Date.parse(createdAt)) fail("VES_SUPPORT_INVALID", "Support Bundle expiry is invalid");
    if (
      !Array.isArray(manifest["diagnostics"]) ||
      manifest["diagnostics"].length === 0 ||
      manifest["diagnostics"].length > 100
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle diagnostics are invalid");
    const fieldIds: string[] = [];
    let pathFields = 0;
    for (const [index, entry] of manifest["diagnostics"].entries()) {
      const diagnostic = row(entry, `manifest.diagnostics[${index}]`, ["fieldId", "value"]);
      const fieldId = safe(diagnostic["fieldId"], `manifest.diagnostics[${index}].fieldId`);
      const definition = DEFINITIONS.find((candidate) => candidate.fieldId === fieldId);
      if (definition === undefined) fail("VES_SUPPORT_FIELD_DENIED", `diagnostic field ${fieldId} is not allowlisted`);
      assertNormalizedValue(definition, diagnostic["value"], this.#codeRegistry);
      if (definition.kind === "path") pathFields += 1;
      fieldIds.push(fieldId);
    }
    if (
      new Set(fieldIds).size !== fieldIds.length ||
      canonicalizeJson(fieldIds) !== canonicalizeJson([...fieldIds].sort())
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle diagnostic order is not canonical");
    const releaseField = plan.manifest.diagnostics.find((entry) => entry.fieldId === "release.digest");
    if (releaseField !== undefined && releaseField.value !== releaseDigest)
      fail("VES_SUPPORT_VALUE_INVALID", "release diagnostic does not match the bundle release");
    const redaction = row(manifest["redactionSummary"], "redactionSummary", [
      "pathsPseudonymized",
      "prohibitedFieldsExcluded"
    ]);
    if (redaction["pathsPseudonymized"] !== pathFields || redaction["prohibitedFieldsExcluded"] !== 10)
      fail("VES_SUPPORT_INVALID", "Support Bundle redaction summary is invalid");
    if (!Array.isArray(manifest["recipients"]) || manifest["recipients"].length === 0)
      fail("VES_SUPPORT_INVALID", "Support Bundle recipient manifest is invalid");
    const recipientIds: string[] = [];
    const thumbprints: string[] = [];
    for (const [index, entry] of manifest["recipients"].entries()) {
      const recipient = row(entry, `manifest.recipients[${index}]`, ["recipientId", "keyThumbprint"]);
      const recipientId = safe(recipient["recipientId"], `manifest.recipients[${index}].recipientId`);
      if (typeof recipient["keyThumbprint"] !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(recipient["keyThumbprint"]))
        fail("VES_SUPPORT_INVALID", "Support Bundle recipient thumbprint is invalid");
      recipientIds.push(recipientId);
      thumbprints.push(recipient["keyThumbprint"]);
    }
    if (
      new Set(recipientIds).size !== recipientIds.length ||
      new Set(thumbprints).size !== thumbprints.length ||
      canonicalizeJson(recipientIds) !== canonicalizeJson([...recipientIds].sort())
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle recipients are not canonical");
    const material = Object.fromEntries(
      Object.entries(plan.manifest).filter(([key]) => key !== "planId")
    ) as unknown as Omit<SupportBundleManifest, "planId">;
    if (
      sha256Digest(manifestMaterial(material)) !== plan.planId ||
      plan.manifest.registryVersion !== "1.0.0" ||
      plan.manifest.registryDigest !== registryDigest() ||
      plan.manifest.codeRegistryDigest !== this.#codeRegistry.digest
    )
      fail("VES_SUPPORT_INVALID", "Support Bundle plan identity is invalid");
    this.#scanner.assertSafe(plan.manifest);
  }
}

export interface SupportApprovalPort {
  verify(input: {
    readonly action: "support-export";
    readonly approvalRef: string;
    readonly planId: string;
    readonly inspectionDigest: Digest;
    readonly workspaceId: string;
    readonly runId: string;
    readonly destinationId: string;
  }): Promise<{ readonly valid: boolean; readonly bindingDigest?: string }>;
}

export interface SupportEgressPort {
  authorize(input: {
    readonly purpose: "support-export";
    readonly planId: string;
    readonly inspectionDigest: Digest;
    readonly workspaceId: string;
    readonly runId: string;
    readonly destinationId: string;
    readonly fields: readonly string[];
    readonly maximumClassification: "internal";
  }): Promise<{ readonly allowed: boolean; readonly decisionDigest?: string }>;
}

export interface SupportExportSinkPort {
  publish(input: {
    readonly idempotencyKey: string;
    readonly destinationId: string;
    readonly bundle: SignedSupportBundle;
  }): Promise<{ readonly status: string; readonly receiptId: string }>;
}

export class SupportExportCoordinator {
  readonly #builder: SupportBundleBuilder;
  readonly #approval: SupportApprovalPort;
  readonly #egress: SupportEgressPort;
  readonly #sink: SupportExportSinkPort;

  constructor(options: {
    readonly builder: SupportBundleBuilder;
    readonly approval: SupportApprovalPort;
    readonly egress: SupportEgressPort;
    readonly sink: SupportExportSinkPort;
  }) {
    this.#builder = options.builder;
    this.#approval = options.approval;
    this.#egress = options.egress;
    this.#sink = options.sink;
  }

  async export(
    plan: SupportBundlePlan,
    inspection: SupportBundleInspection,
    recipients: readonly SupportRecipientInput[],
    request: { readonly approvalRef: string; readonly destinationId: string }
  ): Promise<{ readonly status: string; readonly receiptId: string; readonly artifactId: string }> {
    const currentInspection = this.#builder.inspect(plan);
    if (
      canonicalizeJson(currentInspection as unknown as JsonValue) !==
      canonicalizeJson(inspection as unknown as JsonValue)
    )
      fail("VES_SUPPORT_INSPECTION_STALE", "Support Bundle inspection is stale or incomplete");
    const approval = await this.#approval.verify({
      action: "support-export",
      approvalRef: safe(request.approvalRef, "approvalRef"),
      planId: plan.planId,
      inspectionDigest: inspection.inspectionDigest,
      workspaceId: plan.manifest.workspaceId,
      runId: plan.manifest.runId,
      destinationId: safe(request.destinationId, "destinationId")
    });
    if (!approval.valid || typeof approval.bindingDigest !== "string" || !DIGEST.test(approval.bindingDigest))
      fail("VES_SUPPORT_APPROVAL_DENIED", "Support Export Approval is invalid");
    const egress = await this.#egress.authorize({
      purpose: "support-export",
      planId: plan.planId,
      inspectionDigest: inspection.inspectionDigest,
      workspaceId: plan.manifest.workspaceId,
      runId: plan.manifest.runId,
      destinationId: request.destinationId,
      fields: plan.manifest.diagnostics.map((entry) => entry.fieldId),
      maximumClassification: "internal"
    });
    if (!egress.allowed || typeof egress.decisionDigest !== "string" || !DIGEST.test(egress.decisionDigest))
      fail("VES_SUPPORT_EGRESS_DENIED", "Support Bundle Data Egress was denied");
    const authorization = Object.freeze({
      planId: plan.planId,
      approvalBindingDigest: approval.bindingDigest as Digest,
      egressDecisionDigest: egress.decisionDigest as Digest,
      destinationId: request.destinationId
    });
    authorizedTokens.add(authorization);
    const bundle = await this.#builder.authorizedBuild(plan, recipients, authorization);
    const published = await this.#sink.publish({
      idempotencyKey: sha256Digest({ planId: plan.planId, destinationId: request.destinationId }),
      destinationId: request.destinationId,
      bundle
    });
    return deepFreeze({ ...published, artifactId: bundle.artifactId });
  }
}
