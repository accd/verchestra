import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { link, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { ArtifactSealer } from "../integrity/artifact-sealer.ts";
import { canonicalizeJson, sha256Digest } from "../integrity/canonical.ts";
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

export interface RunCapsuleBuildInput {
  readonly schemaVersion: 1;
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

function refs(value: unknown, label: string): readonly RunCapsuleRef[] {
  if (!Array.isArray(value)) fail("VES_RUN_CAPSULE_INVALID", `${label} must be an array`);
  const normalized = value.map((entry, index) => ref(entry, `${label}[${index}]`));
  const identities = normalized.map((entry) => `${entry.artifactId}\0${entry.digest}`);
  if (new Set(identities).size !== identities.length)
    fail("VES_RUN_CAPSULE_INVALID", `${label} contains duplicate references`);
  return Object.freeze(
    normalized.sort(
      (left, right) => left.artifactId.localeCompare(right.artifactId) || left.digest.localeCompare(right.digest)
    )
  );
}

function optionalRef(value: unknown, label: string): RunCapsuleRef | undefined {
  return value === undefined ? undefined : ref(value, label);
}

function evidence(value: unknown, riskTier: RunRiskTier): RunCapsuleEvidence {
  const valueRow = row(value, "evidence", EVIDENCE_KEYS);
  const normalized = Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, refs(valueRow[key], `evidence.${key}`)])
  ) as unknown as RunCapsuleEvidence;
  for (const key of RISK_REQUIRED[riskTier]) {
    if (normalized[key].length === 0)
      fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", `${riskTier} risk requires ${key} evidence`);
  }
  return Object.freeze(normalized);
}

function normalizeHandoff(value: unknown): RunCapsuleHandoff {
  const valueRow = row(value, "handoff", [
    "packageRef",
    "publicationReceiptRefs",
    "claimDispositionRef",
    "receiverApprovalInherited"
  ]);
  if (valueRow["receiverApprovalInherited"] !== false)
    fail("VES_RUN_CAPSULE_INVALID", "Receiver Approval must never be inherited");
  const publicationReceiptRefs = refs(valueRow["publicationReceiptRefs"], "handoff.publicationReceiptRefs");
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
  "terminalTransition",
  "sealedAt"
]);

function normalizePayload(value: unknown): RunCapsulePayload {
  inspectPrivateMaterial(value);
  const valueRow = row(value, "Run Capsule", PAYLOAD_FIELDS);
  if (valueRow["schemaVersion"] !== 1) fail("VES_RUN_CAPSULE_INVALID", "Unsupported schema version");
  if (!RUN_TERMINAL_STATUSES.includes(valueRow["status"] as RunTerminalStatus))
    fail("VES_RUN_CAPSULE_INVALID", "Terminal status is invalid");
  const status = valueRow["status"] as RunTerminalStatus;
  if (!["low", "medium", "high", "critical"].includes(String(valueRow["riskTier"])))
    fail("VES_RUN_CAPSULE_INVALID", "Risk tier is invalid");
  const riskTier = valueRow["riskTier"] as RunRiskTier;
  if (valueRow["runKind"] !== "feature" && valueRow["runKind"] !== "recovery")
    fail("VES_RUN_CAPSULE_INVALID", "Run kind is invalid");
  const sourceStateRefs = refs(valueRow["sourceStateRefs"], "sourceStateRefs");
  if (sourceStateRefs.length === 0) fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Source state is required");
  if (!Array.isArray(valueRow["policyDigests"]) || valueRow["policyDigests"].length === 0)
    fail("VES_RUN_CAPSULE_EVIDENCE_INCOMPLETE", "Policy evidence is required");
  const policyDigests = Object.freeze(
    [...new Set(valueRow["policyDigests"].map((entry) => digest(entry, "policyDigest")))].sort()
  );
  const normalizedEvidence = evidence(valueRow["evidence"], riskTier);
  const terminalTransition = normalizeTransition(valueRow["terminalTransition"], status);
  const sealedAt = instant(valueRow["sealedAt"], "sealedAt");
  if (Date.parse(sealedAt) < Date.parse(terminalTransition.occurredAt))
    fail("VES_RUN_CAPSULE_INVALID", "Capsule cannot predate its terminal transition");
  const verificationRef = optionalRef(valueRow["verificationRef"], "verificationRef");
  const humanReviewRef = optionalRef(valueRow["humanReviewRef"], "humanReviewRef");
  const terminalErrorRef = optionalRef(valueRow["terminalErrorRef"], "terminalErrorRef");
  const recoveryRef = optionalRef(valueRow["recoveryRef"], "recoveryRef");
  const handoff = valueRow["handoff"] === undefined ? undefined : normalizeHandoff(valueRow["handoff"]);

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
    schemaVersion: 1,
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
    terminalTransition,
    sealedAt
  });
}

function bindingFor(payload: RunCapsulePayload) {
  return Object.freeze({
    schema: Object.freeze({ name: "run-capsule", version: 1 }),
    purpose: "run-capsule",
    bindingId: `${payload.workspaceId}:${payload.runId}:v${payload.runVersion}:${payload.status}`,
    sourceStateDigest: sha256Digest(payload.sourceStateRefs)
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
    const payload = normalizePayload(input);
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

function unsignedArtifact(artifact: SignedRunCapsule) {
  return {
    envelopeVersion: artifact.envelopeVersion,
    schema: artifact.schema,
    purpose: artifact.purpose,
    bindingId: artifact.bindingId,
    sourceStateDigest: artifact.sourceStateDigest,
    algorithm: artifact.algorithm,
    keyId: artifact.keyId,
    issuedAt: artifact.issuedAt,
    payloadDigest: artifact.payloadDigest,
    payload: artifact.payload
  };
}

function assertEnvelope(artifact: SignedRunCapsule, expectedId?: string): void {
  try {
    if (!ARTIFACT_ID.test(artifact.artifactId) || (expectedId !== undefined && artifact.artifactId !== expectedId))
      fail("VES_RUN_CAPSULE_STORAGE_INTEGRITY", "Capsule identity is invalid");
    if (
      sha256Digest(artifact.payload) !== artifact.payloadDigest ||
      sha256Digest(unsignedArtifact(artifact)) !== artifact.artifactId
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
    const bytes = `${canonicalizeJson(artifact as unknown as JsonValue)}\n`;
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
      artifact = JSON.parse(await readFile(target, "utf8")) as SignedRunCapsule;
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
    const intents = [...this.#journal.listUnsealedTerminalRuns()].sort((left, right) =>
      left.runId.localeCompare(right.runId)
    );
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
