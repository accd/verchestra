import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

function failure(code, message, fields = {}) {
  return Object.assign(new Error(message), { code, ...fields });
}

export function authorizeSkillExecution({ kind, requestsExecution, explicitGrant }) {
  if (!requestsExecution) return { authorized: false, authority: "none" };
  if (!new Set(["tool", "plugin"]).has(kind)) {
    throw failure("VES_SKILL_EXECUTION_RECLASSIFY", "executable behavior must be classified as a Tool or Plugin");
  }
  if (explicitGrant !== true) throw failure("VES_EXECUTION_GRANT_REQUIRED", "controller execution grant is required");
  return { authorized: true, authority: "controller-grant" };
}

export function selectIsolationProfile({ risk, requested, available }) {
  if (!available.includes(requested)) throw failure("VES_ISOLATION_PROFILE_UNAVAILABLE", "requested isolation profile is unavailable");
  if (risk === "high-untrusted-executable" && requested === "process-contained") {
    throw failure("VES_STRONG_ISOLATION_UNAVAILABLE", "high-risk executable work requires native or container isolation");
  }
  return requested;
}

const NATIVE_CONTROLS = Object.freeze({
  win32: ["job-object", "restricted-token", "filesystem-acl", "network-deny"],
  linux: ["namespaces", "seccomp", "cgroup-v2", "network-namespace"],
  darwin: ["signed-app-sandbox", "filesystem-profile", "network-deny", "process-group"]
});

export function qualifyPlatformIsolation({ platform, nativeEvidence }) {
  const required = NATIVE_CONTROLS[platform];
  if (!required) throw failure("VES_PLATFORM_UNSUPPORTED", "platform has no isolation qualification contract");
  if (!nativeEvidence) return { platform, available: ["process-contained"], nativeEvidenceDigest: null };
  const complete = /^[a-f0-9]{64}$/.test(nativeEvidence.digest ?? "") && required.every((control) => nativeEvidence.controls?.includes(control));
  if (!complete) throw failure("VES_NATIVE_ISOLATION_UNQUALIFIED", "native isolation evidence is incomplete");
  return { platform, available: ["process-contained", "native-restricted"], nativeEvidenceDigest: nativeEvidence.digest };
}

export function createWorkerEnvironment({ workspaceId, tempDirectory, executablePath, secretHandles = {} }) {
  const env = {
    PATH: executablePath,
    TMP: tempDirectory,
    TEMP: tempDirectory,
    VERCHESTRA_WORKSPACE_ID: workspaceId
  };
  for (const [name, handle] of Object.entries(secretHandles)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw failure("VES_SECRET_HANDLE_NAME_INVALID", "secret handle name is invalid");
    env[`VERCHESTRA_SECRET_HANDLE_${name}`] = handle;
  }
  return env;
}

export function buildWorkerLaunch({ workspaceId, workerRoot, executablePath, limits }) {
  return {
    cwd: workerRoot,
    env: createWorkerEnvironment({ workspaceId, tempDirectory: workerRoot, executablePath }),
    limits: { ...limits },
    profile: "process-contained"
  };
}

function normalizeForComparison(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root, candidate) {
  const rel = relative(normalizeForComparison(root), normalizeForComparison(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export class PathBroker {
  static async create({ workspaceId, roots }) {
    const realRoots = await Promise.all(roots.map((root) => realpath(root)));
    return new PathBroker(workspaceId, realRoots);
  }

  constructor(workspaceId, realRoots) {
    this.workspaceId = workspaceId;
    this.roots = realRoots;
  }

  async realRoot(index) {
    return this.roots[index];
  }

  async realPath(path) {
    return realpath(path);
  }

  async authorize(path, { workspaceId }) {
    if (workspaceId !== this.workspaceId) throw failure("VES_PATH_WORKSPACE_MISMATCH", "path request belongs to another Workspace");
    const candidate = await realpath(path);
    const root = this.roots.find((granted) => isWithin(granted, candidate));
    if (!root) throw failure("VES_PATH_OUTSIDE_GRANT", "resolved path is outside every granted root");
    return { authorized: true, root, path: candidate };
  }
}

export class NetworkBroker {
  constructor({ allowedOrigins = [] } = {}) {
    this.allowedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  }

  authorize(destination) {
    const url = new URL(destination);
    if (url.username || url.password || !this.allowedOrigins.has(url.origin)) {
      throw failure("VES_NETWORK_DESTINATION_DENIED", "network destination is outside the call-specific allowlist");
    }
    return { authorized: true, origin: url.origin };
  }
}

function probeFailure(code, message) {
  return failure(code, message, { promotedEvidence: false });
}

function validateProbe(request, policy) {
  if (request.principalReadOnly !== true) throw probeFailure("VES_PROBE_PRINCIPAL_NOT_READONLY", "database principal is not proven read-only");
  if (request.sessionReadOnly !== true) throw probeFailure("VES_PROBE_SESSION_NOT_READONLY", "database session is not configured read-only");
  if (!policy.schemas?.includes(request.schema)) throw probeFailure("VES_PROBE_SCHEMA_DENIED", "database schema is outside the allowlist");
  if (request.tables?.some((table) => !policy.tables?.includes(table))) throw probeFailure("VES_PROBE_TABLE_DENIED", "database table is outside the allowlist");
  if (request.functions?.some((name) => policy.deniedFunctions?.includes(name))) throw probeFailure("VES_PROBE_FUNCTION_DENIED", "database function is denied");
  if (policy.maxConcurrency !== undefined && request.activeConcurrency >= policy.maxConcurrency) {
    throw probeFailure("VES_PROBE_CONCURRENCY_LIMIT", "Probe concurrency budget is exhausted");
  }
}

export async function executeProbe({ request, policy, executor }) {
  validateProbe(request, policy);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = probeFailure("VES_PROBE_TIMEOUT", "Probe statement timeout exceeded");
      reject(error);
      controller.abort(error);
    }, policy.timeoutMs ?? 30_000);
  });
  let rows;
  try {
    rows = await Promise.race([Promise.resolve().then(() => executor(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (policy.maxRows !== undefined && rows.length > policy.maxRows) throw probeFailure("VES_PROBE_ROW_LIMIT", "Probe row limit exceeded");
  if (policy.maxBytes !== undefined && Buffer.byteLength(JSON.stringify(rows)) > policy.maxBytes) throw probeFailure("VES_PROBE_BYTE_LIMIT", "Probe byte limit exceeded");
  return { promotedEvidence: true, rows };
}
