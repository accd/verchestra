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
import { SUBSYSTEM_OBSERVATION_PATHS, WORKSPACE_ROOT_DIRNAME } from "@verchestra/domain";
import { ArtifactSealer, NodeEd25519Signer, type SealedArtifact } from "@verchestra/evidence";

import { resolveReleaseIdentity } from "./release-manifest.ts";

// The workspace root and every subsystem path below it are owned by the
// domain layout contract (DDL-01/DDL-02, #207), not declared here — a doctor
// probe that watches a path nothing provisions reports blocked forever, and
// a second local copy of the root is exactly the drift that produced that
// bug. Importing @verchestra/domain here is safe for the read-only guard:
// domain takes no third-party or node: import
// (tests/architecture/repository-boundaries.test.mjs), so nothing reachable
// through it can be a writer.
// tests/architecture/doctor-workspace-root.test.mjs statically proves this
// file's watched root agrees with the contract without importing it as a
// runtime value beyond the literal check.

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

// Subsystems a bare source checkout does not provision report absent (blocked)
// through a read-only file-presence check, rather than constructing a heavy
// adapter to observe the obvious. Deeper live wiring is a follow-up.
function fileProbe(path: string): DoctorObservation {
  return existsSync(path) ? present(true) : absent;
}

function subsystemPath(metadataRoot: string, subsystem: keyof typeof SUBSYSTEM_OBSERVATION_PATHS): string {
  return join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS[subsystem]);
}

function buildRealProbes(controlRoot: string, registry: SchemaRegistry | null, now: () => number): DoctorProbeSet {
  const metadataRoot = join(controlRoot, WORKSPACE_ROOT_DIRNAME);
  return Object.freeze({
    "doctor.installation": installationProbe,
    "doctor.contract-schema": () => schemaProbe(registry),
    "doctor.cedar-policy": () => fileProbe(subsystemPath(metadataRoot, "cedar-policy")),
    "doctor.sqlite-durable-state": () => fileProbe(subsystemPath(metadataRoot, "sqlite-durable-state")),
    "doctor.native-asset": nativeAssetProbe,
    "doctor.git": gitProbe,
    "doctor.secret-presence": () => fileProbe(subsystemPath(metadataRoot, "secret-presence")),
    "doctor.clock": () => clockProbe(now),
    "doctor.driver": () => fileProbe(subsystemPath(metadataRoot, "driver")),
    "doctor.connector": () => fileProbe(subsystemPath(metadataRoot, "connector")),
    "doctor.probe": () => fileProbe(subsystemPath(metadataRoot, "probe")),
    "doctor.sandbox": () => fileProbe(subsystemPath(metadataRoot, "sandbox"))
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
export async function runDoctorDeep(options: { readonly controlRoot: string }): Promise<DoctorRunResult> {
  const now = (): number => Date.now();
  const registry = await SchemaRegistry.load(new URL("../../../schemas/", import.meta.url)).catch(() => null);
  const signer = NodeEd25519Signer.generate({ keyId: "doctor-cli", purposes: ["doctor-report"] });
  return runDoctor({
    probes: buildRealProbes(options.controlRoot, registry, now),
    captureSentinels: () => captureControlRootSentinels(options.controlRoot),
    sealer: new ArtifactSealer({ signer, now: () => new Date() }),
    now
  });
}
