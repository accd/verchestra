import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GovernedSkillRegistry } from "../../packages/agent-runtime/src/skills/governed-skill-registry.ts";
import {
  FramedProbeWorker,
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor,
  WorkspaceProbeAdmission
} from "../../packages/extension-host/src/index.ts";
import { SpawnedProbeWorker, probeLaunchDigest } from "../../packages/platform-node/src/index.ts";
import { probePlan } from "./probe-worker-fixture.mjs";
import { grillSkill, lock, skill, verifier } from "./skill-registry-fixture.mjs";

export const NODE_WORKER = fileURLToPath(new URL("../fixtures/probe-workers/reference-worker.mjs", import.meta.url));
export const PYTHON_WORKER = fileURLToPath(new URL("../fixtures/probe-workers/reference_worker.py", import.meta.url));
// invariant: the out-of-process probe host is qualified on POSIX only. On win32
// every case asserts, instead of skipping, that the whole admitted path is
// refused for the platform before any worker is spawned, so the sealed gate
// counters never record a skip and no case passes there without asserting.
export const WIN32_HOST = process.platform === "win32";

export async function probeHostRefusedOnWin32(t) {
  t.diagnostic("win32: asserting the out-of-process probe host refuses this platform instead");
  await assert.rejects(spawnedProbe(), { code: "VES_PROBE_HOST_PLATFORM_UNSUPPORTED" });
}

export function fileDigest(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

// why: python3 is resolved from the runner's own PATH rather than a hardcoded
// location, so the language-neutrality test runs wherever a stock image ships it
// and reports an explicit skip, never a silent pass, where it does not.
export function findPython() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, "python3");
    if (directory !== "" && existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function extensionSkill({ entryPath, digest, extensionRef }) {
  return skill({
    id: "acme-orders-probe",
    lifecycleOwners: [],
    contents: [
      {
        path: entryPath,
        digest,
        declaredClass: "executable",
        mediaType: entryPath.endsWith(".py") ? "text/x-python" : "text/javascript"
      }
    ],
    ...(extensionRef === null ? {} : { extensionRef })
  });
}

export const EXTENSION_REF = Object.freeze({
  kind: "plugin",
  id: "plugin:acme-orders-probe",
  approvalRef: "approval:probe-worker:001"
});
// why: a well-formed launch digest for admission cases that never launch.
export const LAUNCH_DIGEST = `sha256:${"7".repeat(64)}`;

export function extensionRegistry() {
  return new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT"]
  });
}

// why: the signed lock and the request a composition root would hand admission
// for one workspace worker.
export function extensionLock({
  worker = NODE_WORKER,
  entryPath = "probe/worker.mjs",
  extensionRef = EXTENSION_REF
} = {}) {
  return {
    lock: lock({
      skills: [skill(), grillSkill(), extensionSkill({ entryPath, digest: fileDigest(worker), extensionRef })]
    }),
    request: { skillId: "acme-orders-probe", extensionId: extensionRef.id, entryPath }
  };
}

export async function resolvedExtension(options = {}) {
  const { lock: value, request } = extensionLock(options);
  return extensionRegistry().resolveExecutableExtension(value, request);
}

// why: an approval store as the composition root's adapter answers it: only an
// approval on record, already verified, unrevoked and unexpired.
export class MemoryApprovals {
  #records;
  lookups = [];

  constructor(records = []) {
    this.#records = new Map(records.map((record) => [record.approvalRef, record]));
  }

  async lookup(approvalRef) {
    this.lookups.push(approvalRef);
    return this.#records.get(approvalRef);
  }
}

export function approvalFor(extension, launchDigest = LAUNCH_DIGEST, overrides = {}) {
  return {
    approvalRef: extension.extensionRef.approvalRef,
    extensionId: extension.extensionRef.id,
    componentDigest: extension.entry.digest,
    launchDigest,
    ...overrides
  };
}

export function controllerGrant(extension, workspaceId, overrides = {}) {
  return {
    grantRef: "capability-grant:probe-worker:001",
    workspaceId,
    lockDigest: extension.lockDigest,
    extensionId: extension.extensionRef.id,
    approvalRef: extension.extensionRef.approvalRef,
    componentDigest: extension.entry.digest,
    launchDigest: LAUNCH_DIGEST,
    capabilities: ["database-read"],
    isolationProfile: "process-contained",
    risk: "approved-workspace-executable",
    ...overrides
  };
}

// why: admission as a composition root wires it, the real registry and an
// approval on record for the resolved extension. Each option replaces one link.
export async function admitted(options = {}) {
  const workspaceId = options.workspaceId;
  const { lock: value, request } = extensionLock(options);
  const extension = await extensionRegistry().resolveExecutableExtension(value, request);
  const launchDigest = options.launchDigest ?? LAUNCH_DIGEST;
  const approvals = options.approvals ?? new MemoryApprovals([approvalFor(extension, launchDigest)]);
  const admission = new WorkspaceProbeAdmission({ extensions: options.extensions ?? extensionRegistry(), approvals });
  const grant =
    options.grant === null
      ? undefined
      : controllerGrant(extension, workspaceId, { launchDigest, ...options.grantOverrides });
  const trust = await admission.admit({ workspaceId, lock: value, request, grant });
  return { extension, trust, approvals };
}

// why: a transport-only launch, approved for exactly what it starts unless the
// case names another approved launch digest.
export async function launchApproved(options) {
  const approvedLaunchDigest = await probeLaunchDigest(options).catch(() => LAUNCH_DIGEST);
  return SpawnedProbeWorker.launch({ approvedLaunchDigest, ...options });
}

// why: composes the whole out-of-process path the way a composition root would:
// locked extension -> approval -> controller grant -> admission -> spawned
// transport -> framed worker -> supervisor. Every option overrides one link of
// that chain; `approvedLaunch` is what the approval and grant name, when a test
// launches something else.
export async function spawnedProbe(options = {}) {
  const worker = options.worker ?? NODE_WORKER;
  const plan = await probePlan(options.request);
  const extensionRef = options.extensionRef ?? EXTENSION_REF;
  const entryPath = worker.endsWith(".py") ? "probe/worker.py" : "probe/worker.mjs";
  const launch = {
    executable: options.executable ?? process.execPath,
    args: options.args ?? [],
    entry: { path: worker, digest: fileDigest(worker) },
    environment: {
      PROBE_FIXTURE_MODE: options.mode ?? "reference",
      PROBE_FIXTURE_COMPONENT: extensionRef.id,
      ...options.environment
    }
  };
  const { extension, trust } = await admitted({
    worker,
    entryPath,
    extensionRef,
    workspaceId: plan.workspaceId,
    // why: a launch the host cannot measure (a relative or missing executable) is
    // refused by launch() itself, which is what those cases assert.
    launchDigest: await probeLaunchDigest({ ...launch, ...options.approvedLaunch }).catch(() => LAUNCH_DIGEST)
  });
  const transport = await SpawnedProbeWorker.launch({
    ...launch,
    approvedLaunchDigest: trust.launchDigest,
    workspaceId: plan.workspaceId,
    limits: options.limits ?? {}
  });
  const framed = new FramedProbeWorker({ transport, workspaceId: plan.workspaceId, maximumMessageBytes: 65_536 });
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(
    plan.operation.protectedRequestRef,
    new TextEncoder().encode(options.parameter ?? '{"status":"paid"}')
  );
  const results = options.results ?? new MemoryProbeResultSink();
  const supervisor = new ProbeWorkerSupervisor({
    worker: framed,
    parameters,
    results,
    plan,
    ...(options.productComponent === undefined
      ? { workspaceTrust: trust }
      : { expectedComponent: options.productComponent }),
    maximumMessageBytes: 65_536
  });
  return { plan, extension, trust, transport, framed, parameters, results, supervisor };
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function eventuallyDead(pid, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

// why: a result sink that records every appended row outside the transaction, so a
// fault test can learn what a worker reported even after the rollback.
export class ObservingResultSink extends MemoryProbeResultSink {
  observed = [];

  async append(transactionId, rows) {
    this.observed.push(...rows.map((row) => structuredClone(row)));
    return super.append(transactionId, rows);
  }
}
