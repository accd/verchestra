// The only place that wires deep doctor together (T72, #13). Application owns
// the rules and the read-only probe port; this composition root constructs the
// real read-only probes, the sentinel capture, and the TEST-ONLY signing
// identity, and seals the diagnostic report. Nothing here mutates the machine,
// opens a writer, or calls a provider — every probe reports presence and health
// as booleans only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DOCTOR_CHECK_IDS,
  DOCTOR_REMEDIATION_CODES,
  DoctorError,
  buildDoctorReport,
  collectDoctorFacts,
  diffSentinels,
  type DoctorObservation,
  type DoctorProbeSet,
  type DoctorReportPayload,
  type DoctorVerdict,
  type SentinelFact
} from "@verchestra/application";
import { SchemaRegistry } from "@verchestra/contracts";
import { PiDriver } from "@verchestra/drivers";
import { ArtifactSealer, NodeEd25519Signer, type SealedArtifact } from "@verchestra/evidence";
import type { SecretAdapter } from "@verchestra/platform-node";

import { resolveReleaseIdentity } from "./release-manifest.ts";

// Must name the same directory init actually writes to
// (WORKSPACE_ROOT_DIRNAME in packages/workspace/src/init/safe-init.ts) — a
// doctor probe that watches a directory nothing provisions reports blocked
// forever. Kept as a plain literal rather than importing @verchestra/workspace
// (which re-exports SafeInitService, a genuine filesystem writer) so this
// read-only composition root's reachable graph stays read-only by contract;
// tests/architecture/doctor-workspace-root.test.mjs statically proves the two
// literals agree without either file importing the other.
const WORKSPACE_ROOT_DIRNAME = ".verchestra";

export interface DoctorPorts {
  readonly probes: DoctorProbeSet;
  readonly captureSentinels: () => readonly SentinelFact[];
  readonly sealer: ArtifactSealer;
  readonly now: () => number;
}

export interface DoctorRunResult {
  readonly payload: DoctorReportPayload;
  readonly artifact: SealedArtifact<DoctorReportPayload>;
  readonly verdict: DoctorVerdict;
}

// The release composition supplies these references only after it has resolved
// the active Workspace. Each port is presence-only: no secret value, runtime
// content, or machine path can be placed in a doctor fact or sealed report.
// Leaving a port unconfigured is an honest blocked observation for source mode.
export interface DoctorLiveProbeOptions {
  readonly workspaceId?: string;
  readonly runtimeDatabase?: string;
  readonly secret?: {
    readonly logicalName: string;
    readonly adapter: Pick<SecretAdapter, "has">;
  };
}

// Binds the sealed report to the exact closed catalog it was produced against,
// so a report cannot be replayed against a build with different checks.
const DOCTOR_CODE_DIGEST = createHash("sha256")
  .update(JSON.stringify({ checks: [...DOCTOR_CHECK_IDS], remediations: [...DOCTOR_REMEDIATION_CODES] }))
  .digest("hex");

// The read-only diagnostic, bracketed by sentinels: collect facts, prove the
// guarded files did not change, build the closed report, and seal it.
export async function runDoctor(ports: DoctorPorts): Promise<DoctorRunResult> {
  const before = ports.captureSentinels();
  const start = ports.now();
  const facts = await collectDoctorFacts(ports.probes);
  const after = ports.captureSentinels();
  if (!diffSentinels(before, after).identical)
    throw new DoctorError("VES_DOCTOR_SENTINEL_MUTATION", "a sentinel changed during the read-only diagnostic");
  const payload = buildDoctorReport(facts, Math.max(0, ports.now() - start));
  const artifact = await ports.sealer.seal(payload, {
    schema: { name: "doctor-report", version: 1 },
    purpose: "doctor-report",
    bindingId: "doctor:deep",
    sourceStateDigest: DOCTOR_CODE_DIGEST
  });
  return Object.freeze({ payload, artifact, verdict: payload["doctor.verdict"] as DoctorVerdict });
}

const present = (healthy: boolean): DoctorObservation => ({ present: true, healthy });
const absent: DoctorObservation = Object.freeze({ present: false, healthy: false });

function installationProbe(): DoctorObservation {
  try {
    return present(resolveReleaseIdentity().semanticVersion.length > 0);
  } catch {
    return present(false);
  }
}

function nativeAssetProbe(): DoctorObservation {
  // Source mode has no verified release artifact (releaseDigest is null), so the
  // hermetic native asset is legitimately absent until T76 ships a candidate.
  try {
    return resolveReleaseIdentity().releaseDigest === null ? absent : present(true);
  } catch {
    return absent;
  }
}

function gitProbe(): DoctorObservation {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return absent;
  return present(/git version/u.test(result.stdout));
}

function clockProbe(now: () => number): DoctorObservation {
  const first = now();
  const second = now();
  return present(Number.isFinite(first) && Number.isFinite(second) && first > 0 && second >= first);
}

function schemaProbe(registry: SchemaRegistry | null): DoctorObservation {
  return registry === null ? present(false) : present(registry.list().includes("doctor-report@1"));
}

async function runtimeDatabaseProbe(live: DoctorLiveProbeOptions): Promise<DoctorObservation> {
  if (live.runtimeDatabase === undefined) return absent;
  try {
    // This stays dynamic so a non-doctor CLI invocation never evaluates the
    // SQLite adapter (which owns the experimental Node SQLite surface).
    const { inspectRuntimeDatabase } = await import("@verchestra/platform-node");
    inspectRuntimeDatabase(live.runtimeDatabase, { assertExtensionsDisabled: true });
    return present(true);
  } catch {
    return present(false);
  }
}

async function secretPresenceProbe(live: DoctorLiveProbeOptions): Promise<DoctorObservation> {
  if (live.workspaceId === undefined || live.secret === undefined) return absent;
  return (await live.secret.adapter.has(live.workspaceId, live.secret.logicalName)) ? present(true) : absent;
}

async function driverProbe(): Promise<DoctorObservation> {
  // probe() resolves only the installed package manifest. The execution resolver
  // is deliberately unreachable from it, so doctor cannot start a session,
  // invoke a provider, or spend credentials while checking driver readiness.
  const result = await new PiDriver({
    resolveExecution: async () => {
      throw new Error("Driver execution is unavailable during doctor");
    }
  }).probe();
  if (result["available"] === true) return present(true);
  const code = (result["error"] as Readonly<Record<string, unknown>> | undefined)?.["code"];
  return code === "VES_PI_NOT_AVAILABLE" ? absent : present(false);
}

async function sandboxProbe(metadataRoot: string, live: DoctorLiveProbeOptions): Promise<DoctorObservation> {
  if (live.workspaceId === undefined || !existsSync(metadataRoot)) return absent;
  try {
    const { ProtectedPathBroker } = await import("@verchestra/platform-node");
    const broker = await ProtectedPathBroker.create({
      workspaceId: live.workspaceId,
      roots: [{ rootId: "workspace", path: metadataRoot }]
    });
    await broker.openExisting({ workspaceId: live.workspaceId, rootId: "workspace", logicalPath: "../escape" });
    return present(false);
  } catch (error) {
    return present((error as { readonly code?: unknown }).code === "VES_PATH_LOGICAL_INVALID");
  }
}

function buildRealProbes(
  controlRoot: string,
  registry: SchemaRegistry | null,
  now: () => number,
  live: DoctorLiveProbeOptions
): DoctorProbeSet {
  const metadataRoot = join(controlRoot, WORKSPACE_ROOT_DIRNAME);
  return Object.freeze({
    "doctor.installation": installationProbe,
    "doctor.contract-schema": () => schemaProbe(registry),
    "doctor.cedar-policy": () => absent,
    "doctor.sqlite-durable-state": () => runtimeDatabaseProbe(live),
    "doctor.native-asset": nativeAssetProbe,
    "doctor.git": gitProbe,
    "doctor.secret-presence": () => secretPresenceProbe(live),
    "doctor.clock": () => clockProbe(now),
    "doctor.driver": driverProbe,
    "doctor.connector": () => absent,
    "doctor.probe": () => absent,
    "doctor.sandbox": () => sandboxProbe(metadataRoot, live)
  });
}

// Read-only sentinels: a content digest of stable control-root files. A
// read-only diagnostic must leave them byte-identical.
export function captureControlRootSentinels(controlRoot: string): readonly SentinelFact[] {
  const facts: SentinelFact[] = [];
  for (const name of ["package.json", "AGENTS.md"]) {
    const path = join(controlRoot, name);
    if (!existsSync(path)) continue;
    facts.push({
      sentinelId: `control:${name}`,
      digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
    });
  }
  return Object.freeze(facts);
}

// The one entry point main.ts needs. Constructs the TEST-ONLY signing identity
// and the real read-only probes here, and nowhere else.
export async function runDoctorDeep(options: {
  readonly controlRoot: string;
  readonly live?: DoctorLiveProbeOptions;
}): Promise<DoctorRunResult> {
  const now = (): number => Date.now();
  const registry = await SchemaRegistry.load(new URL("../../../schemas/", import.meta.url)).catch(() => null);
  const signer = NodeEd25519Signer.generate({ keyId: "doctor-cli", purposes: ["doctor-report"] });
  return runDoctor({
    probes: buildRealProbes(options.controlRoot, registry, now, options.live ?? {}),
    captureSentinels: () => captureControlRootSentinels(options.controlRoot),
    sealer: new ArtifactSealer({ signer, now: () => new Date() }),
    now
  });
}
