import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { link, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { normalizeDeclaredSet } from "@verchestra/domain";

import {
  ArtifactSealer,
  dsseEnvelopeOf,
  sealedArtifactFromEnvelope,
  sealedProjectionMatches
} from "../integrity/artifact-sealer.ts";
import { canonicalizeJsonForVersion, sha256DigestForVersion } from "../integrity/canonical.ts";
import type { JsonValue, SealedArtifact, TrustRoot } from "../integrity/types.ts";

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;

export const RUN_TERMINAL_STATUSES = Object.freeze([
  "COMPLETED",
  "HANDED_OFF",
  "FAILED",
  "ABORTED",
  "INTERRUPTED",
  "RECOVERED"
] as const);

export type RunTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];
export type RunRiskTier = "low" | "medium" | "high" | "critical";

export interface RunCapsuleRef {
  readonly artifactId: string;
  readonly digest: Digest;
}

export interface RunCapsuleTerminalTransition {
  readonly eventId: string;
  readonly eventDigest: Digest;
  readonly fromState: string;
  readonly toState: RunTerminalStatus;
  readonly occurredAt: string;
}

export interface RunCapsuleHandoff {
  readonly packageRef: RunCapsuleRef;
  readonly publicationReceiptRefs: readonly RunCapsuleRef[];
  readonly claimDispositionRef: RunCapsuleRef;
  readonly receiverApprovalInherited: false;
}

export interface RunCapsuleEvidence {
  readonly decisions: readonly RunCapsuleRef[];
  readonly modelSelections: readonly RunCapsuleRef[];
  readonly contexts: readonly RunCapsuleRef[];
  readonly capabilityGrants: readonly RunCapsuleRef[];
  readonly approvals: readonly RunCapsuleRef[];
  readonly claims: readonly RunCapsuleRef[];
  readonly tasks: readonly RunCapsuleRef[];
  readonly gates: readonly RunCapsuleRef[];
  readonly operationReceipts: readonly RunCapsuleRef[];
  readonly outputs: readonly RunCapsuleRef[];
  readonly terminal: readonly RunCapsuleRef[];
}

// Declared-versus-consumed budget evidence (BUD-05). The price table version is
// sealed with the run so historical cost stays auditable after rate updates.
export interface RunCapsuleBudgetEvidence {
  readonly declared: {
    readonly maximumCostUsd: number;
    readonly maximumTokens: number;
    readonly maximumDurationMs: number;
  };
  readonly consumed: {
    readonly costUsd: number;
    readonly tokens: number;
    readonly durationMs: number;
    readonly usageEvents: number;
  };
  readonly priceTableVersion: string;
  readonly stopReason: string | null;
}

export interface RunCapsuleBuildInput {
  readonly schemaVersion: 1 | 2;
  readonly workspaceId: string;
  readonly runId: string;
  readonly runKind: "feature" | "recovery";
  readonly runVersion: number;
  readonly status: RunTerminalStatus;
  readonly riskTier: RunRiskTier;
  readonly predecessorRunId?: string;
  readonly successorRunId?: string;
  readonly requestDigest: Digest;
  readonly workspaceFingerprint: Digest;
  readonly executionPackageRef: RunCapsuleRef;
  readonly sourceStateRefs: readonly RunCapsuleRef[];
  readonly releaseDigest: Digest;
  readonly policyDigests: readonly Digest[];
  readonly skillLockDigest: Digest;
  readonly evidence: RunCapsuleEvidence;
  readonly verificationRef?: RunCapsuleRef;
  readonly humanReviewRef?: RunCapsuleRef;
  readonly terminalErrorRef?: RunCapsuleRef;
  readonly recoveryRef?: RunCapsuleRef;
  readonly handoff?: RunCapsuleHandoff;
  readonly budgetEvidence?: RunCapsuleBudgetEvidence;
  readonly terminalTransition: RunCapsuleTerminalTransition;
  readonly sealedAt: string;
}

export type RunCapsulePayload = RunCapsuleBuildInput;
export type SignedRunCapsule = SealedArtifact<RunCapsulePayload & JsonValue> & {
  readonly payload: RunCapsulePayload;
};

export type RunCapsuleErrorCode =
  | "VES_RUN_CAPSULE_INVALID"
  | "VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE"
  | "VES_RUN_CAPSULE_BINDING_INVALID"
  | "VES_RUN_CAPSULE_EXPECTATION_MISMATCH"
  | "VES_RUN_CAPSULE_STORAGE_INVALID"
  | "VES_RUN_CAPSULE_STORAGE_CONFLICT"
  | "VES_RUN_CAPSULE_STORAGE_INTEGRITY"
  | "VES_RUN_CAPSULE_RECOVERY_INVALID";

export class RunCapsuleError extends Error {
  readonly code: RunCapsuleErrorCode;

  constructor(code: RunCapsuleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunCapsuleError";
    this.code = code;
  }
}

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_ID = /^[a-f0-9]{64}$/u;
const SAFE = /^[\x21-\x7e]{1,240}$/u;
const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/|file:)/u;
const PROHIBITED = new Set([
  "provider",
  "providerId",
  "backend",
  "backendId",
  "model",
  "modelId",
  "session",
  "sessionId",
  "threadId",
  "turnId",
  "transcript",
  "credential",
  "secret",
  "secretValue",
  "token",
  "providerToken",
  "environment",
  "environmentValue",
  "localPath",
  "absolutePath",
  "prompt",
  "row"
]);
const EVIDENCE_KEYS = Object.freeze([
  "decisions",
  "modelSelections",
  "contexts",
  "capabilityGrants",
  "approvals",
  "claims",
  "tasks",
  "gates",
  "operationReceipts",
  "outputs",
  "terminal"
] as const);
const RISK_REQUIRED: Readonly<Record<RunRiskTier, readonly (keyof RunCapsuleEvidence)[]>> = Object.freeze({
  low: Object.freeze(["decisions", "terminal"] as const),
  medium: Object.freeze(["decisions", "contexts", "tasks", "gates", "terminal"] as const),
  high: Object.freeze([
    "decisions",
    "contexts",
    "capabilityGrants",
    "approvals",
    "claims",
    "tasks",
    "gates",
    "operationReceipts",
    "outputs",
    "terminal"
  ] as const),
  critical: Object.freeze([...EVIDENCE_KEYS])
});

function fail(code: RunCapsuleErrorCode, message: string): never {
  throw new RunCapsuleError(code, message);
}

export type RunCapsuleSchemaVersion = RunCapsuleBuildInput["schemaVersion"];

function schemaVersionOf(value: unknown): RunCapsuleSchemaVersion {
  if (value !== 1 && value !== 2) fail("VES_RUN_CAPSULE_INVALID", "Unsupported schema version");
  return value;
}

/**
 * Ordering for the set-like reference arrays sealed into a Capsule.
 *
 * Schema V2 uses UTF-16 code-unit comparison, so a Capsule's identity is a
 * property of its values rather than of the sealing machine's collation.
 *
 * Schema V1 keeps ambient `localeCompare`, and that retention is
 * verification-critical rather than cosmetic. Unlike the Execution Package
 * (AD-029), whose normalized member is a JSON *object* that RFC 8785 re-sorts
 * by key anyway — making its pre-sort inert — `sourceStateRefs` is an
 * **array**, and RFC 8785 preserves array order. `RunCapsuleBuilder.verify`
 * re-runs `normalizePayload` over the stored payload and recomputes
 * `bindingFor(...).sourceStateDigest` from the re-sorted array, comparing it to
 * the digest signed at seal time. Normalizing V1 onto code-unit order would
 * therefore change that recomputation and make every stored V1 Capsule whose
 * `artifactId` values differ by case or punctuation fail verification with
 * `VES_RUN_CAPSULE_BINDING_INVALID`. AD-029's "verification never re-sorts"
 * argument does not hold for this owner, so compatibility rule 1 applies in
 * full: V1 keeps its bytes and its verifier.
 */
function compareIdentity(version: RunCapsuleSchemaVersion, left: string, right: string): number {
  if (version === 1) return left.localeCompare(right);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function row(value: unknown, label: string, allowed: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_RUN_CAPSULE_INVALID", `${label} must be an object`);
  const valueRow = value as Row;
  const extras = Object.keys(valueRow).filter((key) => !allowed.includes(key));
  if (extras.length > 0) fail("VES_RUN_CAPSULE_INVALID", `${label} contains unknown fields`);
  return valueRow;
}

function safe(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE.test(value) || ABSOLUTE.test(value))
    fail("VES_RUN_CAPSULE_INVALID", `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_RUN_CAPSULE_INVALID", `${label} is invalid`);
  return value as Digest;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail("VES_RUN_CAPSULE_INVALID", `${label} is invalid`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    fail("VES_RUN_CAPSULE_INVALID", `${label} must be a positive integer`);
  return Number(value);
}

function inspectPrivateMaterial(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) inspectPrivateMaterial(entry, seen);
    return;
  }
  for (const [key, entry] of Object.entries(value as Row)) {
    if (PROHIBITED.has(key)) fail("VES_RUN_CAPSULE_INVALID", `Prohibited private field: ${key}`);
    if (typeof entry === "string" && ABSOLUTE.test(entry))
      fail("VES_RUN_CAPSULE_INVALID", "Absolute machine paths are prohibited");
    inspectPrivateMaterial(entry, seen);
  }
}

function ref(value: unknown, label: string): RunCapsuleRef {
  const valueRow = row(value, label, ["artifactId", "digest"]);
  return Object.freeze({
    artifactId: safe(valueRow["artifactId"], `${label}.artifactId`),
    digest: digest(valueRow["digest"], `${label}.digest`)
  });
}

function refs(value: unknown, label: string, version: RunCapsuleSchemaVersion): readonly RunCapsuleRef[] {
  if (!Array.isArray(value)) fail("VES_RUN_CAPSULE_INVALID", `${label} must be an array`);
  const normalized = value.map((entry, index) => ref(entry, `${label}[${index}]`));
  const identities = normalized.map((entry) => `${entry.artifactId}\0${entry.digest}`);
  if (new Set(identities).size !== identities.length)
    fail("VES_RUN_CAPSULE_INVALID", `${label} contains duplicate references`);
  return Object.freeze(
    normalized.sort(
      (left, right) =>
        compareIdentity(version, left.artifactId, right.artifactId) ||
        compareIdentity(version, left.digest, right.digest)
    )
  );
}

function optionalRef(value: unknown, label: string): RunCapsuleRef | undefined {
  return value === undefined ? undefined : ref(value, label);
}

function evidence(value: unknown, riskTier: RunRiskTier, version: RunCapsuleSchemaVersion): RunCapsuleEvidence {
  const valueRow = row(value, "evidence", EVIDENCE_KEYS);
  const normalized = Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, refs(valueRow[key], `evidence.${key}`, version)])
  ) as unknown as RunCapsuleEvidence;
  for (const key of RISK_REQUIRED[riskTier]) {
    if (normalized[key].length === 0)
      fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", `${riskTier} risk requires ${key} evidence`);
  }
  return Object.freeze(normalized);
}

function normalizeHandoff(value: unknown, version: RunCapsuleSchemaVersion): RunCapsuleHandoff {
  const valueRow = row(value, "handoff", [
    "packageRef",
    "publicationReceiptRefs",
    "claimDispositionRef",
    "receiverApprovalInherited"
  ]);
  if (valueRow["receiverApprovalInherited"] !== false)
    fail("VES_RUN_CAPSULE_INVALID", "Receiver Approval must never be inherited");
  const publicationReceiptRefs = refs(valueRow["publicationReceiptRefs"], "handoff.publicationReceiptRefs", version);
  if (publicationReceiptRefs.length === 0)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Handoff publication evidence is required");
  return Object.freeze({
    packageRef: ref(valueRow["packageRef"], "handoff.packageRef"),
    publicationReceiptRefs,
    claimDispositionRef: ref(valueRow["claimDispositionRef"], "handoff.claimDispositionRef"),
    receiverApprovalInherited: false
  });
}

function normalizeTransition(value: unknown, status: RunTerminalStatus): RunCapsuleTerminalTransition {
  const valueRow = row(value, "terminalTransition", ["eventId", "eventDigest", "fromState", "toState", "occurredAt"]);
  if (valueRow["toState"] !== status) fail("VES_RUN_CAPSULE_INVALID", "Terminal transition does not match status");
  return Object.freeze({
    eventId: safe(valueRow["eventId"], "terminalTransition.eventId"),
    eventDigest: digest(valueRow["eventDigest"], "terminalTransition.eventDigest"),
    fromState: safe(valueRow["fromState"], "terminalTransition.fromState"),
    toState: status,
    occurredAt: instant(valueRow["occurredAt"], "terminalTransition.occurredAt")
  });
}

const PAYLOAD_FIELDS = Object.freeze([
  "schemaVersion",
  "workspaceId",
  "runId",
  "runKind",
  "runVersion",
  "status",
  "riskTier",
  "predecessorRunId",
  "successorRunId",
  "requestDigest",
  "workspaceFingerprint",
  "executionPackageRef",
  "sourceStateRefs",
  "releaseDigest",
  "policyDigests",
  "skillLockDigest",
  "evidence",
  "verificationRef",
  "humanReviewRef",
  "terminalErrorRef",
  "recoveryRef",
  "handoff",
  "budgetEvidence",
  "terminalTransition",
  "sealedAt"
]);

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail("VES_RUN_CAPSULE_INVALID", `${label} must be a non-negative finite number`);
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    fail("VES_RUN_CAPSULE_INVALID", `${label} must be a positive finite number`);
  return value;
}

function normalizeBudgetEvidence(value: unknown): RunCapsuleBudgetEvidence {
  const valueRow = row(value, "budgetEvidence", ["declared", "consumed", "priceTableVersion", "stopReason"]);
  const declared = row(valueRow["declared"], "budgetEvidence.declared", [
    "maximumCostUsd",
    "maximumTokens",
    "maximumDurationMs"
  ]);
  const consumed = row(valueRow["consumed"], "budgetEvidence.consumed", [
    "costUsd",
    "tokens",
    "durationMs",
    "usageEvents"
  ]);
  const stopReason = valueRow["stopReason"];
  if (stopReason !== null && (typeof stopReason !== "string" || !SAFE.test(stopReason)))
    fail("VES_RUN_CAPSULE_INVALID", "budgetEvidence.stopReason is invalid");
  return Object.freeze({
    declared: Object.freeze({
      maximumCostUsd: positiveNumber(declared["maximumCostUsd"], "budgetEvidence.declared.maximumCostUsd"),
      maximumTokens: positiveNumber(declared["maximumTokens"], "budgetEvidence.declared.maximumTokens"),
      maximumDurationMs: positiveNumber(declared["maximumDurationMs"], "budgetEvidence.declared.maximumDurationMs")
    }),
    consumed: Object.freeze({
      costUsd: nonNegativeNumber(consumed["costUsd"], "budgetEvidence.consumed.costUsd"),
      tokens: nonNegativeNumber(consumed["tokens"], "budgetEvidence.consumed.tokens"),
      durationMs: nonNegativeNumber(consumed["durationMs"], "budgetEvidence.consumed.durationMs"),
      usageEvents: nonNegativeNumber(consumed["usageEvents"], "budgetEvidence.consumed.usageEvents")
    }),
    priceTableVersion: safe(valueRow["priceTableVersion"], "budgetEvidence.priceTableVersion"),
    stopReason
  });
}

function normalizePayload(value: unknown): RunCapsulePayload {
  inspectPrivateMaterial(value);
  const valueRow = row(value, "Run Capsule", PAYLOAD_FIELDS);
  const version = schemaVersionOf(valueRow["schemaVersion"]);
  if (!RUN_TERMINAL_STATUSES.includes(valueRow["status"] as RunTerminalStatus))
    fail("VES_RUN_CAPSULE_INVALID", "Terminal status is invalid");
  const status = valueRow["status"] as RunTerminalStatus;
  if (!["low", "medium", "high", "critical"].includes(String(valueRow["riskTier"])))
    fail("VES_RUN_CAPSULE_INVALID", "Risk tier is invalid");
  const riskTier = valueRow["riskTier"] as RunRiskTier;
  if (valueRow["runKind"] !== "feature" && valueRow["runKind"] !== "recovery")
    fail("VES_RUN_CAPSULE_INVALID", "Run kind is invalid");
  const sourceStateRefs = refs(valueRow["sourceStateRefs"], "sourceStateRefs", version);
  if (sourceStateRefs.length === 0) fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Source state is required");
  if (!Array.isArray(valueRow["policyDigests"]) || valueRow["policyDigests"].length === 0)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Policy evidence is required");
  const policyDigests = Object.freeze(
    [...new Set(valueRow["policyDigests"].map((entry) => digest(entry, "policyDigest")))].sort()
  );
  const normalizedEvidence = evidence(valueRow["evidence"], riskTier, version);
  const terminalTransition = normalizeTransition(valueRow["terminalTransition"], status);
  const sealedAt = instant(valueRow["sealedAt"], "sealedAt");
  if (Date.parse(sealedAt) < Date.parse(terminalTransition.occurredAt))
    fail("VES_RUN_CAPSULE_INVALID", "Capsule cannot predate its terminal transition");
  const verificationRef = optionalRef(valueRow["verificationRef"], "verificationRef");
  const humanReviewRef = optionalRef(valueRow["humanReviewRef"], "humanReviewRef");
  const terminalErrorRef = optionalRef(valueRow["terminalErrorRef"], "terminalErrorRef");
  const recoveryRef = optionalRef(valueRow["recoveryRef"], "recoveryRef");
  const handoff = valueRow["handoff"] === undefined ? undefined : normalizeHandoff(valueRow["handoff"], version);
  const budgetEvidence =
    valueRow["budgetEvidence"] === undefined ? undefined : normalizeBudgetEvidence(valueRow["budgetEvidence"]);

  if (status === "COMPLETED" && (verificationRef === undefined || humanReviewRef === undefined))
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Completed runs require verification and Human Review");
  if (status === "COMPLETED" && terminalTransition.fromState !== "HUMAN_REVIEW")
    fail("VES_RUN_CAPSULE_INVALID", "Completed runs must close from HUMAN_REVIEW");
  if (["FAILED", "ABORTED", "INTERRUPTED"].includes(status) && terminalErrorRef === undefined)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", `${status} requires terminal error evidence`);
  if (status === "HANDED_OFF" && handoff === undefined)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Handed-off runs require publication and claim evidence");
  if (status === "RECOVERED" && recoveryRef === undefined)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Recovered runs require recovery evidence");
  if (
    status === "HANDED_OFF" &&
    (normalizedEvidence.claims.length === 0 || normalizedEvidence.operationReceipts.length === 0)
  )
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Handoff requires claim and operation evidence");
  if (status !== "COMPLETED" && (verificationRef !== undefined || humanReviewRef !== undefined))
    fail("VES_RUN_CAPSULE_INVALID", "Only completed runs may carry final verification and Human Review");
  if (!["FAILED", "ABORTED", "INTERRUPTED"].includes(status) && terminalErrorRef !== undefined)
    fail("VES_RUN_CAPSULE_INVALID", "Terminal error evidence is not valid for this status");
  if (status !== "RECOVERED" && recoveryRef !== undefined)
    fail("VES_RUN_CAPSULE_INVALID", "Recovery evidence is not valid for this status");
  if (status !== "HANDED_OFF" && handoff !== undefined)
    fail("VES_RUN_CAPSULE_INVALID", "Handoff evidence is not valid for this status");
  if (status === "RECOVERED" && valueRow["runKind"] !== "recovery")
    fail("VES_RUN_CAPSULE_INVALID", "Recovered status requires a recovery run");

  return Object.freeze({
    schemaVersion: version,
    workspaceId: safe(valueRow["workspaceId"], "workspaceId"),
    runId: safe(valueRow["runId"], "runId"),
    runKind: valueRow["runKind"],
    runVersion: positiveInteger(valueRow["runVersion"], "runVersion"),
    status,
    riskTier,
    ...(valueRow["predecessorRunId"] === undefined
      ? {}
      : { predecessorRunId: safe(valueRow["predecessorRunId"], "predecessorRunId") }),
    ...(valueRow["successorRunId"] === undefined
      ? {}
      : { successorRunId: safe(valueRow["successorRunId"], "successorRunId") }),
    requestDigest: digest(valueRow["requestDigest"], "requestDigest"),
    workspaceFingerprint: digest(valueRow["workspaceFingerprint"], "workspaceFingerprint"),
    executionPackageRef: ref(valueRow["executionPackageRef"], "executionPackageRef"),
    sourceStateRefs,
    releaseDigest: digest(valueRow["releaseDigest"], "releaseDigest"),
    policyDigests,
    skillLockDigest: digest(valueRow["skillLockDigest"], "skillLockDigest"),
    evidence: normalizedEvidence,
    ...(verificationRef === undefined ? {} : { verificationRef }),
    ...(humanReviewRef === undefined ? {} : { humanReviewRef }),
    ...(terminalErrorRef === undefined ? {} : { terminalErrorRef }),
    ...(recoveryRef === undefined ? {} : { recoveryRef }),
    ...(handoff === undefined ? {} : { handoff }),
    ...(budgetEvidence === undefined ? {} : { budgetEvidence }),
    terminalTransition,
    sealedAt
  });
}

function bindingFor(payload: RunCapsulePayload) {
  return Object.freeze({
    // The schema version travels into the signed in-toto Statement and selects
    // the predicate type, so a V1 Capsule cannot be reinterpreted as V2: the
    // two are different signed documents, and `verify` additionally requires
    // the envelope's schema version to equal the payload's.
    schema: Object.freeze({ name: "run-capsule", version: payload.schemaVersion }),
    purpose: "run-capsule",
    bindingId: `${payload.workspaceId}:${payload.runId}:v${payload.runVersion}:${payload.status}`,
    sourceStateDigest: sha256DigestForVersion(payload.schemaVersion, payload.sourceStateRefs)
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export class RunCapsuleBuilder {
  readonly #sealer: ArtifactSealer;

  constructor(options: { readonly sealer: ArtifactSealer }) {
    this.#sealer = options.sealer;
  }

  async build(input: unknown): Promise<SignedRunCapsule> {
    // A caller that omits the version receives the locale-independent V2
    // contract; an explicit schemaVersion: 1 stays V1 and is never silently
    // upgraded, and an unknown version fails closed in `schemaVersionOf`.
    const versioned =
      input !== null && typeof input === "object" && !Array.isArray(input) && !("schemaVersion" in input)
        ? { ...(input as Row), schemaVersion: 2 }
        : input;
    const payload = normalizePayload(versioned);
    return deepFreeze(
      (await this.#sealer.seal(payload as unknown as JsonValue, bindingFor(payload), {
        issuedAt: payload.sealedAt
      })) as SignedRunCapsule
    );
  }

  async verify(
    artifact: SignedRunCapsule,
    trust: TrustRoot,
    expected: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly runVersion: number;
      readonly status: RunTerminalStatus;
      readonly evaluatedAt: string;
    }
  ): Promise<
    | { readonly ok: true; readonly capsuleId: string; readonly status: RunTerminalStatus }
    | { readonly ok: false; readonly code: string }
  > {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      artifact.schema === null ||
      typeof artifact.schema !== "object"
    )
      return Object.freeze({ ok: false, code: "VES_RUN_CAPSULE_INVALID" });
    const cryptographic = await this.#sealer.verify(artifact, trust, {
      schema: artifact.schema,
      purpose: artifact.purpose,
      bindingId: artifact.bindingId,
      sourceStateDigest: artifact.sourceStateDigest,
      now: new Date(expected.evaluatedAt)
    });
    if (!cryptographic.ok) return Object.freeze({ ok: false, code: cryptographic.code });
    let payload: RunCapsulePayload;
    try {
      payload = normalizePayload(artifact.payload);
    } catch (error) {
      return Object.freeze({
        ok: false,
        code: error instanceof RunCapsuleError ? error.code : "VES_RUN_CAPSULE_INVALID"
      });
    }
    const binding = bindingFor(payload);
    if (
      artifact.schema.name !== binding.schema.name ||
      artifact.schema.version !== binding.schema.version ||
      artifact.purpose !== binding.purpose ||
      artifact.bindingId !== binding.bindingId ||
      artifact.sourceStateDigest !== binding.sourceStateDigest ||
      artifact.issuedAt !== payload.sealedAt
    )
      return Object.freeze({ ok: false, code: "VES_RUN_CAPSULE_BINDING_INVALID" });
    if (
      payload.workspaceId !== expected.workspaceId ||
      payload.runId !== expected.runId ||
      payload.runVersion !== expected.runVersion ||
      payload.status !== expected.status
    )
      return Object.freeze({ ok: false, code: "VES_RUN_CAPSULE_EXPECTATION_MISMATCH" });
    return Object.freeze({ ok: true, capsuleId: artifact.artifactId, status: payload.status });
  }
}

function assertEnvelope(artifact: SignedRunCapsule, expectedId?: string): void {
  try {
    if (!ARTIFACT_ID.test(artifact.artifactId) || (expectedId !== undefined && artifact.artifactId !== expectedId))
      fail("VES_RUN_CAPSULE_STORAGE_INTEGRITY", "Capsule identity is invalid");
    // The canonicalizer is selected from the recorded schema version, never
    // guessed, so a stored V1 Capsule is re-digested exactly as it was sealed.
    const version = schemaVersionOf(artifact.schema.version);
    if (
      sha256DigestForVersion(version, artifact.payload) !== artifact.payloadDigest ||
      !sealedProjectionMatches(artifact)
    )
      fail("VES_RUN_CAPSULE_STORAGE_INTEGRITY", "Capsule content address is invalid");
  } catch (error) {
    if (error instanceof RunCapsuleError) throw error;
    throw new RunCapsuleError("VES_RUN_CAPSULE_STORAGE_INTEGRITY", "Capsule envelope is malformed", {
      cause: error
    });
  }
}

async function safeRoot(configured: string): Promise<string> {
  const root = resolve(configured);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) fail("VES_RUN_CAPSULE_STORAGE_INVALID", "Capsule root is linked");
  return realpath(root);
}

async function safeTarget(root: string, target: string): Promise<void> {
  if (relative(root, target).startsWith("..")) fail("VES_RUN_CAPSULE_STORAGE_INVALID", "Capsule target leaves root");
  try {
    if ((await lstat(target)).isSymbolicLink()) fail("VES_RUN_CAPSULE_STORAGE_INVALID", "Capsule target is linked");
    if (relative(root, await realpath(target)).startsWith(".."))
      fail("VES_RUN_CAPSULE_STORAGE_INVALID", "Capsule target leaves root");
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
  }
}

export class FileRunCapsuleStore {
  readonly #root: string;
  readonly #afterPublish: (() => void) | undefined;

  constructor(options: { readonly root: string; readonly afterPublish?: () => void }) {
    this.#root = options.root;
    this.#afterPublish = options.afterPublish;
  }

  async put(artifact: SignedRunCapsule): Promise<"published" | "already-published"> {
    assertEnvelope(artifact);
    const root = await safeRoot(this.#root);
    const target = join(root, `${artifact.artifactId}.json`);
    await safeTarget(root, target);
    // The persisted object IS the DSSE envelope (#248); flat fields derive on read.
    const bytes = `${canonicalizeJsonForVersion(schemaVersionOf(artifact.schema.version), dsseEnvelopeOf(artifact) as unknown as JsonValue)}\n`;
    try {
      const existing = await readFile(target, "utf8");
      if (existing !== bytes) fail("VES_RUN_CAPSULE_STORAGE_CONFLICT", "Capsule target contains different bytes");
      return "already-published";
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
    }
    const staging = join(root, `.run-capsule-${randomUUID()}.tmp`);
    try {
      await writeFile(staging, bytes, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
      await safeTarget(root, target);
      try {
        await link(staging, target);
      } catch (error) {
        if ((error as { readonly code?: unknown }).code !== "EEXIST") throw error;
        const existing = await readFile(target, "utf8");
        if (existing !== bytes) fail("VES_RUN_CAPSULE_STORAGE_CONFLICT", "Capsule target changed during publication");
        return "already-published";
      }
      this.#afterPublish?.();
      return "published";
    } finally {
      await rm(staging, { force: true });
    }
  }

  async get(capsuleId: string): Promise<SignedRunCapsule> {
    if (!ARTIFACT_ID.test(capsuleId)) fail("VES_RUN_CAPSULE_STORAGE_INVALID", "Capsule ID is invalid");
    const root = await safeRoot(this.#root);
    const target = join(root, `${capsuleId}.json`);
    await safeTarget(root, target);
    let artifact: SignedRunCapsule;
    try {
      artifact = sealedArtifactFromEnvelope(JSON.parse(await readFile(target, "utf8"))) as SignedRunCapsule;
    } catch (error) {
      throw new RunCapsuleError("VES_RUN_CAPSULE_STORAGE_INTEGRITY", "Stored Capsule is unreadable", {
        cause: error
      });
    }
    assertEnvelope(artifact, capsuleId);
    return deepFreeze(artifact);
  }
}

export interface UnsealedRunCapsuleIntent {
  readonly runId: string;
  readonly runKind: "feature" | "recovery";
  readonly status: RunTerminalStatus;
  readonly stateVersion: number;
  readonly predecessorRunId?: string;
  readonly successorRunId?: string;
}

export interface RunCapsuleJournalPort {
  listUnsealedTerminalRuns(): readonly UnsealedRunCapsuleIntent[];
  recordRunCapsuleSeal(value: {
    readonly runId: string;
    readonly stateVersion: number;
    readonly status: RunTerminalStatus;
    readonly capsuleId: string;
    readonly payloadDigest: string;
    readonly sealedAt: string;
  }): "recorded" | "already-recorded";
}

export interface RunCapsuleInputResolver {
  resolve(intent: UnsealedRunCapsuleIntent): Promise<RunCapsuleBuildInput> | RunCapsuleBuildInput;
}

export class RunCapsuleRecoveryCoordinator {
  readonly #journal: RunCapsuleJournalPort;
  readonly #resolver: RunCapsuleInputResolver;
  readonly #builder: RunCapsuleBuilder;
  readonly #store: FileRunCapsuleStore;
  readonly #afterStore: ((capsuleId: string) => void) | undefined;

  constructor(options: {
    readonly journal: RunCapsuleJournalPort;
    readonly resolver: RunCapsuleInputResolver;
    readonly builder: RunCapsuleBuilder;
    readonly store: FileRunCapsuleStore;
    readonly afterStore?: (capsuleId: string) => void;
  }) {
    this.#journal = options.journal;
    this.#resolver = options.resolver;
    this.#builder = options.builder;
    this.#store = options.store;
    this.#afterStore = options.afterStore;
  }

  async recoverUnsealed(): Promise<
    readonly {
      readonly runId: string;
      readonly capsuleId: string;
      readonly storage: string;
      readonly journal: string;
    }[]
  > {
    // Recovery order only, not a digest input and not version-bearing: no
    // sealed byte depends on it, so it normalizes to code-unit order outright
    // rather than carrying a V1 branch. Deterministic ordering still matters —
    // it makes the sealed-and-recorded sequence reproducible across machines.
    const intents = normalizeDeclaredSet(this.#journal.listUnsealedTerminalRuns(), (intent) => intent.runId);
    const results: { runId: string; capsuleId: string; storage: string; journal: string }[] = [];
    for (const intent of intents) {
      const input = await this.#resolver.resolve(intent);
      if (
        input.runId !== intent.runId ||
        input.runKind !== intent.runKind ||
        input.runVersion !== intent.stateVersion ||
        input.status !== intent.status ||
        input.predecessorRunId !== intent.predecessorRunId ||
        input.successorRunId !== intent.successorRunId
      )
        fail("VES_RUN_CAPSULE_RECOVERY_INVALID", "Resolved Capsule input does not match terminal intent");
      const artifact = await this.#builder.build(input);
      const storage = await this.#store.put(artifact);
      this.#afterStore?.(artifact.artifactId);
      const journal = this.#journal.recordRunCapsuleSeal({
        runId: input.runId,
        stateVersion: input.runVersion,
        status: input.status,
        capsuleId: artifact.artifactId,
        payloadDigest: artifact.payloadDigest,
        sealedAt: input.sealedAt
      });
      results.push(Object.freeze({ runId: input.runId, capsuleId: artifact.artifactId, storage, journal }));
    }
    return Object.freeze(results);
  }
}
