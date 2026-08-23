// The only place that wires deep doctor together (T72, #13). Application owns
// the rules and the read-only probe port; this composition root constructs the
// real read-only probes, the sentinel capture, and the TEST-ONLY signing
// identity, and seals the diagnostic report. Nothing here mutates the machine,
// opens a writer, or calls a provider — every probe reports presence and health
// as booleans only.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
import {
  type AvailabilitySubsystem,
  SUBSYSTEM_OBSERVATION_PATHS,
  WORKSPACE_ROOT_DIRNAME,
  parseSubsystemAvailability
} from "@verchestra/domain";
import { ArtifactSealer, NodeEd25519Signer, type SealedArtifact } from "@verchestra/evidence";
import {
  ProtectedPathBroker,
  type SecretAdapter,
  inspectRuntimeDatabase,
  secretPresence
} from "@verchestra/platform-node/readonly";
import { type PolicyBundleCrypto, verifyPolicyBundle } from "@verchestra/policy/readonly";

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

// The release composition supplies these references only after it has resolved
// the active Workspace. Each port is presence-only: no secret value, runtime
// content, or machine path can be placed in a doctor fact or sealed report.
// Leaving a port unconfigured is an honest blocked observation for source mode.
export interface DoctorLiveProbeOptions {
  readonly workspaceId?: string;
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

function subsystemPath(metadataRoot: string, subsystem: keyof typeof SUBSYSTEM_OBSERVATION_PATHS): string {
  return join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS[subsystem]);
}

// A read-only diagnostic that is not operating within any real bound
// workspace still needs an identity shape ProtectedPathBroker.create accepts
// (StableId, "workspace_<uuid>"). This literal names no real workspace; it
// exists only to satisfy that shape for the sandbox probe below.
const SANDBOX_PROBE_WORKSPACE_ID = "workspace_00000000-0000-4000-8000-000000000000";

// The narrow shape sandboxProbe needs from a broker, so the mapping logic
// below is independently testable against a fixture double — the real
// ProtectedPathBroker (imported from the platform-node read-only subpath,
// DDL-12) is structurally compatible without being named in this type.
interface EscapeCheckBroker {
  openExisting(request: {
    readonly workspaceId: string;
    readonly rootId: string;
    readonly logicalPath: string;
  }): Promise<unknown>;
}

// DDL-06 (#207): the pure pass/fail mapping. scripts/provision-doctor-fixtures.mjs
// plants a directory symlink/junction ("escape") inside the sandbox root
// pointing at its own parent, so this path genuinely resolves outside the
// granted root on a provisioned machine — LogicalPath.parse already rejects
// any naive "../" logical path, so a symlink escape is the only way the
// broker's out-of-root refusal is ever reachable at all. Refusal
// (VES_PATH_OUTSIDE_ROOT) is the pass signal; the broker permitting the open
// — or erroring for any other reason — means the sandbox failed to contain
// it, so it fails rather than silently passing.
export async function evaluateSandboxEscape(broker: EscapeCheckBroker): Promise<DoctorObservation> {
  try {
    await broker.openExisting({
      workspaceId: SANDBOX_PROBE_WORKSPACE_ID,
      rootId: "sandbox",
      logicalPath: "escape/runtime.db"
    });
    return present(false);
  } catch (error) {
    return present((error as { readonly code?: unknown }).code === "VES_PATH_OUTSIDE_ROOT");
  }
}

async function sandboxProbe(metadataRoot: string): Promise<DoctorObservation> {
  try {
    const broker = await ProtectedPathBroker.create({
      workspaceId: SANDBOX_PROBE_WORKSPACE_ID,
      roots: [{ rootId: "sandbox", path: subsystemPath(metadataRoot, "sandbox") }]
    });
    return await evaluateSandboxEscape(broker);
  } catch {
    return absent;
  }
}

// DDL-08 (#207): a live read-only integrity check, not a file-presence check.
// Absence is genuinely absence (blocked, checked before this runs). A present
// file that fails PRAGMA integrity_check, is corrupt, or errors for any other
// reason (a held lock included, though a WAL-mode read-only open is not
// actually blocked by one — verified empirically while building this task)
// degrades to fail through the same catch, never a crash. Split from the
// wrapper below so a test can inject an arbitrary failure without needing a
// real corrupt file or a real concurrent-access scenario for every class of
// error this must degrade.
export async function evaluateRuntimeDatabase(inspect: () => Promise<unknown>): Promise<DoctorObservation> {
  try {
    await inspect();
    return present(true);
  } catch {
    return present(false);
  }
}

async function sqliteDurableStateProbe(metadataRoot: string): Promise<DoctorObservation> {
  const dbPath = subsystemPath(metadataRoot, "sqlite-durable-state");
  if (!existsSync(dbPath)) return absent;
  return evaluateRuntimeDatabase(() => inspectRuntimeDatabase(dbPath));
}

// DDL-07 (#207): a read-only Ed25519 verifier matching the encoding this
// product already uses elsewhere (packages/evidence/src/integrity/artifact-sealer.ts:
// spki-der public key, base64url signature) — applying an existing product
// convention, not inventing a new one. No production signer for a policy
// bundle exists yet anywhere in the repository; this is deliberately
// verify-only. `sign` throws unconditionally rather than being omitted,
// because PolicyBundleCrypto requires it structurally even though
// verifyPolicyBundle itself never calls it — a throwing stub proves the
// capability is genuinely absent from what this file can do, not merely
// unused by one call path today.
//
// P1 review finding on #306: `verify`'s third parameter is the bundle's own
// declared `publicKeyRef`, read from the same file under verification — an
// opaque, untrusted claim, not a trust source. Trusting it would let a fully
// replaced, self-consistent, self-signed bundle (content, digest, signature,
// and key all swapped together) pass every check here. `pinnedPublicKeyRef`
// is sourced independently, from a sibling file the doctor reads through a
// path the bundle's own content cannot influence
// (cedarPolicyProbe/subsystemPath), and is what verification actually
// checks against; the parameter this function receives from
// verifyPolicyBundle is intentionally ignored.
function cedarPolicyReadOnlyCrypto(pinnedPublicKeyRef: string): PolicyBundleCrypto {
  return {
    sha256: (value: string) => createHash("sha256").update(value).digest("hex"),
    sign: () => {
      throw new Error("read-only diagnostic: policy bundle signing is not available here");
    },
    verify: (digestValue: string, signature: string) => {
      try {
        const publicKey = createPublicKey({
          key: Buffer.from(pinnedPublicKeyRef, "base64url"),
          type: "spki",
          format: "der"
        });
        return verifyBytes(null, Buffer.from(digestValue), publicKey, Buffer.from(signature, "base64url"));
      } catch {
        return false;
      }
    }
  };
}

// The bundle's own bundleDigest is recomputed and checked as part of
// verification (policy-bundle.ts's own "recompute everything from the
// sources" design); this probe never returns or logs that value — DDL-11
// forbids the sealed report from carrying anything but the two booleans, so
// a caught error here discards its message the same way every other probe
// in this file does. Absent -> blocked; present but the bundle fails to
// parse (edge case: truncated or zero-length) or fails verification (edge
// case: tampered) both degrade to fail through the same catch, never a
// crash out of runDoctor.
//
// The trust anchor (trusted-signer.pub, a sibling of the bundle file) is
// read the same way: absent -> blocked (nothing to verify against yet, the
// same honest "not provisioned" signal as the bundle itself being absent),
// present but unusable -> caught by the same catch as every other failure
// mode here.
async function cedarPolicyProbe(metadataRoot: string): Promise<DoctorObservation> {
  const bundlePath = subsystemPath(metadataRoot, "cedar-policy");
  if (!existsSync(bundlePath)) return absent;
  const trustedSignerPath = join(dirname(bundlePath), "trusted-signer.pub");
  if (!existsSync(trustedSignerPath)) return absent;
  try {
    const pinnedPublicKeyRef = readFileSync(trustedSignerPath, "utf8");
    const parsed: unknown = JSON.parse(readFileSync(bundlePath, "utf8"));
    verifyPolicyBundle(parsed, cedarPolicyReadOnlyCrypto(pinnedPublicKeyRef));
    return present(true);
  } catch {
    return present(false);
  }
}

// DDL-10 (#207): availability from a read-only record, never an adapter
// construction — tests/architecture/doctor-readonly-graph.test.mjs forbids
// this file's transitive closure from reaching the driver, connector, or
// database-probe packages by name, precisely the three a real adapter would
// need. "Available" means the record exists,
// parses, and declares the matching subsystem — never that it is reachable.
//
// A well-formed record whose `available` field is false is treated the same
// as an absent record (blocked): the record's own claim is "not installed
// here," which is the same "cannot run until provisioned" outcome
// observeToFact already gives an absent subsystem, not a broken one. A
// record present but malformed, or one declaring a different subsystem than
// the one being checked (edge case: a build/directory mismatch), degrades
// to fail — something was published, and it is wrong.
async function availabilityProbe(metadataRoot: string, subsystem: AvailabilitySubsystem): Promise<DoctorObservation> {
  const recordPath = join(subsystemPath(metadataRoot, subsystem), "availability.json");
  if (!existsSync(recordPath)) return absent;
  try {
    const record = parseSubsystemAvailability(JSON.parse(readFileSync(recordPath, "utf8")));
    if (record.subsystem !== subsystem) return present(false);
    return record.available ? present(true) : absent;
  } catch {
    return present(false);
  }
}

// DDL-09 (#207): presence only, through the readonly subpath's own narrow
// wrapper (secretPresence, T10) — never the full adapter, so this probe can
// structurally never reach the byte-reading method and place a secret's
// bytes in a fact.
async function secretPresenceProbe(live: DoctorLiveProbeOptions): Promise<DoctorObservation> {
  if (live.workspaceId === undefined || live.secret === undefined) return absent;
  const has = await secretPresence(live.secret.adapter, live.workspaceId, live.secret.logicalName);
  return has ? present(true) : absent;
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
    "doctor.cedar-policy": () => cedarPolicyProbe(metadataRoot),
    "doctor.sqlite-durable-state": () => sqliteDurableStateProbe(metadataRoot),
    "doctor.native-asset": nativeAssetProbe,
    "doctor.git": gitProbe,
    "doctor.secret-presence": () => secretPresenceProbe(live),
    "doctor.clock": () => clockProbe(now),
    "doctor.driver": () => availabilityProbe(metadataRoot, "driver"),
    "doctor.connector": () => availabilityProbe(metadataRoot, "connector"),
    "doctor.probe": () => availabilityProbe(metadataRoot, "probe"),
    "doctor.sandbox": () => sandboxProbe(metadataRoot)
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
