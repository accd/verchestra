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
  admitWorkspaceProbeWorker
} from "../../packages/extension-host/src/index.ts";
import { SpawnedProbeWorker } from "../../packages/platform-node/src/index.ts";
import { probePlan } from "./probe-worker-fixture.mjs";
import { grillSkill, lock, skill, verifier } from "./skill-registry-fixture.mjs";

export const NODE_WORKER = fileURLToPath(new URL("../fixtures/probe-workers/reference-worker.mjs", import.meta.url));
export const PYTHON_WORKER = fileURLToPath(new URL("../fixtures/probe-workers/reference_worker.py", import.meta.url));
export const POSIX_ONLY =
  process.platform === "win32"
    ? "The out-of-process probe host is qualified on POSIX only; win32 refusal is asserted separately"
    : false;

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

export async function resolvedExtension({
  worker = NODE_WORKER,
  entryPath = "probe/worker.mjs",
  extensionRef = { kind: "plugin", id: "plugin:acme-orders-probe", approvalRef: "approval:probe-worker:001" }
} = {}) {
  const registry = new GovernedSkillRegistry({
    verifier: verifier(),
    harnessVersion: "1.0.0",
    schemaVersion: 1,
    tlcMinimumVersion: "3.2.0",
    allowedLicenses: ["MIT"]
  });
  const value = lock({
    skills: [skill(), grillSkill(), extensionSkill({ entryPath, digest: fileDigest(worker), extensionRef })]
  });
  return registry.resolveExecutableExtension(value, {
    skillId: "acme-orders-probe",
    extensionId: extensionRef.id,
    entryPath
  });
}

export function controllerGrant(extension, workspaceId, overrides = {}) {
  return {
    grantRef: "capability-grant:probe-worker:001",
    workspaceId,
    lockDigest: extension.lockDigest,
    extensionId: extension.extensionRef.id,
    approvalRef: extension.extensionRef.approvalRef,
    componentDigest: extension.entry.digest,
    capabilities: ["database-read"],
    isolationProfile: "process-contained",
    risk: "approved-workspace-executable",
    ...overrides
  };
}

// why: composes the whole out-of-process path the way a composition root would:
// locked extension -> controller grant -> admission -> spawned transport ->
// framed worker -> supervisor. Every option overrides one link of that chain.
export async function spawnedProbe(options = {}) {
  const worker = options.worker ?? NODE_WORKER;
  const plan = await probePlan(options.request);
  const extension = await resolvedExtension({
    worker,
    entryPath: worker.endsWith(".py") ? "probe/worker.py" : "probe/worker.mjs",
    ...(options.extensionRef === undefined ? {} : { extensionRef: options.extensionRef })
  });
  const trust = admitWorkspaceProbeWorker({
    workspaceId: plan.workspaceId,
    extension,
    grant: controllerGrant(extension, plan.workspaceId)
  });
  const transport = await SpawnedProbeWorker.launch({
    executable: options.executable ?? process.execPath,
    args: options.args ?? [],
    entry: { path: worker, digest: extension.entry.digest },
    workspaceId: plan.workspaceId,
    limits: options.limits ?? {},
    environment: {
      PROBE_FIXTURE_MODE: options.mode ?? "reference",
      PROBE_FIXTURE_COMPONENT: extension.extensionRef.id,
      ...options.environment
    }
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
