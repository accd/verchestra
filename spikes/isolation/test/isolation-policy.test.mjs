import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  NetworkBroker,
  PathBroker,
  authorizeSkillExecution,
  buildWorkerLaunch,
  createWorkerEnvironment,
  executeProbe,
  qualifyPlatformIsolation,
  selectIsolationProfile
} from "../src/isolation-policy.mjs";

const roots = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), "verchestra-isolation-"));
  roots.push(path);
  return path;
}
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

test("installing a Skill grants no implicit executable capability", () => {
  assert.throws(() => authorizeSkillExecution({ kind: "skill", requestsExecution: true, explicitGrant: false }), { code: "VES_SKILL_EXECUTION_RECLASSIFY" });
});

test("a reclassified Tool executes only with an explicit controller grant", () => {
  assert.deepEqual(authorizeSkillExecution({ kind: "tool", requestsExecution: true, explicitGrant: true }), { authorized: true, authority: "controller-grant" });
  assert.throws(() => authorizeSkillExecution({ kind: "tool", requestsExecution: true, explicitGrant: false }), { code: "VES_EXECUTION_GRANT_REQUIRED" });
});

test("untrusted payload content cannot promote capabilities", () => {
  assert.throws(() => authorizeSkillExecution({ kind: "tool", requestsExecution: true, explicitGrant: false, untrustedPayload: { grant: true, capability: "process.exec" } }), { code: "VES_EXECUTION_GRANT_REQUIRED" });
});

test("high-risk executable work is blocked on process-contained isolation", () => {
  assert.throws(() => selectIsolationProfile({ risk: "high-untrusted-executable", requested: "process-contained", available: ["process-contained"] }), { code: "VES_STRONG_ISOLATION_UNAVAILABLE" });
});

test("high-risk executable work accepts a qualified native profile", () => {
  assert.equal(selectIsolationProfile({ risk: "high-untrusted-executable", requested: "native-restricted", available: ["process-contained", "native-restricted"] }), "native-restricted");
});

test("an unavailable requested profile is blocked rather than downgraded", () => {
  assert.throws(() => selectIsolationProfile({ risk: "standard", requested: "native-restricted", available: ["process-contained"] }), { code: "VES_ISOLATION_PROFILE_UNAVAILABLE" });
});

test("platform fixtures advertise only process-contained without qualified native evidence", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    assert.deepEqual(qualifyPlatformIsolation({ platform }), { platform, available: ["process-contained"], nativeEvidenceDigest: null });
  }
});

test("incomplete native-control evidence cannot advertise strong isolation", () => {
  assert.throws(() => qualifyPlatformIsolation({ platform: "win32", nativeEvidence: { digest: "a".repeat(64), controls: ["job-object"] } }), { code: "VES_NATIVE_ISOLATION_UNQUALIFIED" });
  assert.throws(() => qualifyPlatformIsolation({ platform: "linux", nativeEvidence: { digest: "b".repeat(64), controls: ["namespaces", "seccomp"] } }), { code: "VES_NATIVE_ISOLATION_UNQUALIFIED" });
  assert.throws(() => qualifyPlatformIsolation({ platform: "darwin", nativeEvidence: { digest: "c".repeat(64), controls: ["signed-app-sandbox"] } }), { code: "VES_NATIVE_ISOLATION_UNQUALIFIED" });
});

test("complete platform-specific evidence enables native-restricted exactly", () => {
  const fixtures = [
    ["win32", ["job-object", "restricted-token", "filesystem-acl", "network-deny"]],
    ["linux", ["namespaces", "seccomp", "cgroup-v2", "network-namespace"]],
    ["darwin", ["signed-app-sandbox", "filesystem-profile", "network-deny", "process-group"]]
  ];
  for (const [platform, controls] of fixtures) {
    assert.deepEqual(qualifyPlatformIsolation({ platform, nativeEvidence: { digest: "d".repeat(64), controls } }), { platform, available: ["process-contained", "native-restricted"], nativeEvidenceDigest: "d".repeat(64) });
  }
});

test("worker environment excludes ambient credentials, home, and global config", () => {
  const env = createWorkerEnvironment({
    workspaceId: "workspace-a",
    tempDirectory: "C:\\safe\\tmp",
    executablePath: "C:\\runtime",
    ambient: { HOME: "secret-home", USERPROFILE: "secret-profile", OPENAI_API_KEY: "secret", NPM_CONFIG_USERCONFIG: "secret-config", PATH: "ambient-path" }
  });
  assert.deepEqual(env, {
    PATH: "C:\\runtime",
    TMP: "C:\\safe\\tmp",
    TEMP: "C:\\safe\\tmp",
    VERCHESTRA_WORKSPACE_ID: "workspace-a"
  });
});

test("secret delivery records only an opaque handle name", () => {
  const env = createWorkerEnvironment({ workspaceId: "workspace-a", tempDirectory: "/safe/tmp", executablePath: "/runtime", secretHandles: { DATABASE: "handle:42" } });
  assert.equal(env.VERCHESTRA_SECRET_HANDLE_DATABASE, "handle:42");
  assert.equal(JSON.stringify(env).includes("password"), false);
});

test("worker launch uses a dedicated cwd and explicit bounded resources", () => {
  const launch = buildWorkerLaunch({
    workspaceId: "workspace-a",
    workerRoot: "C:\\workspace\\.verchestra\\workers\\run-1",
    executablePath: "C:\\runtime",
    limits: { cpuMs: 1000, memoryBytes: 64 * 1024 * 1024, processes: 2, outputBytes: 4096, wallClockMs: 2000, concurrency: 1, messageBytes: 1024 }
  });
  assert.deepEqual(launch, {
    cwd: "C:\\workspace\\.verchestra\\workers\\run-1",
    env: { PATH: "C:\\runtime", TMP: "C:\\workspace\\.verchestra\\workers\\run-1", TEMP: "C:\\workspace\\.verchestra\\workers\\run-1", VERCHESTRA_WORKSPACE_ID: "workspace-a" },
    limits: { cpuMs: 1000, memoryBytes: 67108864, processes: 2, outputBytes: 4096, wallClockMs: 2000, concurrency: 1, messageBytes: 1024 },
    profile: "process-contained"
  });
});

test("PathBroker authorizes a real path inside its granted root", async () => {
  const workspace = await root();
  const granted = join(workspace, "project");
  await mkdir(granted);
  const file = join(granted, "readme.md");
  await writeFile(file, "safe");
  const broker = await PathBroker.create({ workspaceId: "workspace-a", roots: [granted] });
  assert.deepEqual(await broker.authorize(file, { workspaceId: "workspace-a" }), { authorized: true, root: await broker.realRoot(0), path: await broker.realPath(file) });
});

test("PathBroker rejects traversal outside every granted root", async () => {
  const workspace = await root();
  const granted = join(workspace, "project");
  await mkdir(granted);
  const outside = join(workspace, "outside.txt");
  await writeFile(outside, "outside");
  const broker = await PathBroker.create({ workspaceId: "workspace-a", roots: [granted] });
  await assert.rejects(() => broker.authorize(outside, { workspaceId: "workspace-a" }), { code: "VES_PATH_OUTSIDE_GRANT" });
});

test("PathBroker revalidates real paths and rejects junction or symlink escape", async () => {
  const workspace = await root();
  const granted = join(workspace, "project");
  const outside = join(workspace, "outside");
  await mkdir(granted);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(granted, "escape"), process.platform === "win32" ? "junction" : "dir");
  const broker = await PathBroker.create({ workspaceId: "workspace-a", roots: [granted] });
  await assert.rejects(() => broker.authorize(join(granted, "escape", "secret.txt"), { workspaceId: "workspace-a" }), { code: "VES_PATH_OUTSIDE_GRANT" });
});

test("PathBroker rejects a cross-Workspace request", async () => {
  const workspace = await root();
  const granted = join(workspace, "project");
  await mkdir(granted);
  const broker = await PathBroker.create({ workspaceId: "workspace-a", roots: [granted] });
  await assert.rejects(() => broker.authorize(granted, { workspaceId: "workspace-b" }), { code: "VES_PATH_WORKSPACE_MISMATCH" });
});

test("network access is denied by default", () => {
  const broker = new NetworkBroker();
  assert.throws(() => broker.authorize("https://api.example.com/v1"), { code: "VES_NETWORK_DESTINATION_DENIED" });
});

test("network broker allows only an exact call-specific destination origin", () => {
  const broker = new NetworkBroker({ allowedOrigins: ["https://api.example.com:443"] });
  assert.deepEqual(broker.authorize("https://api.example.com/v1"), { authorized: true, origin: "https://api.example.com" });
  assert.throws(() => broker.authorize("https://evil.example.com/v1"), { code: "VES_NETWORK_DESTINATION_DENIED" });
});

test("Probe execution requires a read-only database principal", async () => {
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: false, sessionReadOnly: true, schema: "public" }, policy: { schemas: ["public"] }, executor: async () => [] }), { code: "VES_PROBE_PRINCIPAL_NOT_READONLY", promotedEvidence: false });
});

test("Probe execution requires engine-aware read-only session configuration", async () => {
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: true, sessionReadOnly: false, schema: "public" }, policy: { schemas: ["public"] }, executor: async () => [] }), { code: "VES_PROBE_SESSION_NOT_READONLY", promotedEvidence: false });
});

test("Probe execution rejects schemas and functions outside policy", async () => {
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: true, sessionReadOnly: true, schema: "private", functions: [] }, policy: { schemas: ["public"], deniedFunctions: ["pg_sleep"] }, executor: async () => [] }), { code: "VES_PROBE_SCHEMA_DENIED", promotedEvidence: false });
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: true, sessionReadOnly: true, schema: "public", functions: ["pg_sleep"] }, policy: { schemas: ["public"], deniedFunctions: ["pg_sleep"] }, executor: async () => [] }), { code: "VES_PROBE_FUNCTION_DENIED", promotedEvidence: false });
});

test("Probe execution rejects tables outside the approved allowlist", async () => {
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: true, sessionReadOnly: true, schema: "public", tables: ["secrets"], functions: [] }, policy: { schemas: ["public"], tables: ["orders"] }, executor: async () => [] }), { code: "VES_PROBE_TABLE_DENIED", promotedEvidence: false });
});

test("Probe execution rejects work when the concurrency budget is exhausted", async () => {
  await assert.rejects(() => executeProbe({ request: { principalReadOnly: true, sessionReadOnly: true, schema: "public", tables: ["orders"], functions: [], activeConcurrency: 1 }, policy: { schemas: ["public"], tables: ["orders"], maxConcurrency: 1 }, executor: async () => [] }), { code: "VES_PROBE_CONCURRENCY_LIMIT", promotedEvidence: false });
});

test("Probe row or byte overflow produces no partial promoted evidence", async () => {
  const base = { request: { principalReadOnly: true, sessionReadOnly: true, schema: "public", functions: [] }, executor: async () => [{ value: "12345" }, { value: "67890" }] };
  await assert.rejects(() => executeProbe({ ...base, policy: { schemas: ["public"], maxRows: 1, maxBytes: 100, timeoutMs: 100 } }), { code: "VES_PROBE_ROW_LIMIT", promotedEvidence: false });
  await assert.rejects(() => executeProbe({ ...base, policy: { schemas: ["public"], maxRows: 10, maxBytes: 5, timeoutMs: 100 } }), { code: "VES_PROBE_BYTE_LIMIT", promotedEvidence: false });
});

test("Probe timeout aborts the executor and produces no promoted evidence", async () => {
  let aborted = false;
  await assert.rejects(() => executeProbe({
    request: { principalReadOnly: true, sessionReadOnly: true, schema: "public", functions: [] },
    policy: { schemas: ["public"], maxRows: 10, maxBytes: 100, timeoutMs: 10 },
    executor: (signal) => new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve([]); }, { once: true }))
  }), { code: "VES_PROBE_TIMEOUT", promotedEvidence: false });
  assert.equal(aborted, true);
});
