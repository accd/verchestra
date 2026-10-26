// invariant: TCK-01..TCK-06 (.specs/features/task-check/spec.md). Every task
// prerequisite is judged in one pass by the same check `task plan` or
// `task start` applies, and a missing one is recorded, not thrown, so the next
// check still runs. Presence only: no credential value is read, no provider
// session starts, and nothing is written to the repository.
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandResult } from "@verchestra/application";
import {
  CLAUDE_MEDIATED_MINIMUM_VERSION,
  CODEX_STRUCTURED_MINIMUM_VERSION,
  ClaudeCodeDriver,
  CodexDriver
} from "@verchestra/drivers";
import { PublicErrorException } from "@verchestra/domain";

import { IMPLEMENTER_CREDENTIALS, loadProviderAuth, type ProviderAuth } from "../task-provider-auth.ts";
import { requireSubscriptionPreflight } from "./task-billing.ts";
import { codexIdentityDirectory, codexSubscriptionLoggedIn } from "./task-codex-identity.ts";
import { SIGNING_PASSPHRASE, VERIFIER_CREDENTIAL, requireCredentialBound } from "./task-credentials.ts";
import { notConfigured, stableCode } from "./task-errors.ts";
import { loadGateAllowlist } from "./task-gates.ts";
import { findExecutable } from "./task-implementer.ts";
import type { TaskCommandIo } from "./task-io.ts";
import type { PlannedTaskRequest } from "./task-plan-record.ts";
import { readRequest } from "./task-plan.ts";
import { providerModels, requireModelsPricedForApiKey } from "./task-provider-models.ts";
import { requireWindowsPrerequisites } from "./task-windows.ts";
import { openTaskWorkspace, type TaskWorkspace } from "./task-workspace.ts";

export type TaskCheckStatus = "ready" | "missing" | "not-checked";

export interface TaskCheckRow {
  readonly check: string;
  readonly status: TaskCheckStatus;
  readonly code?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly recovery?: string;
  // why: a check that could not be judged names the one it waits for.
  readonly dependsOn?: string;
}

// invariant: a missing check carries what the refusal of `task plan` or
// `task start` carries for the same piece: its code, its safe details, and its
// recovery. Anything that is not a public refusal keeps only a stable code.
function missing(check: string, error: unknown): TaskCheckRow {
  if (!(error instanceof PublicErrorException)) return { check, status: "missing", code: stableCode(error) };
  const { code, safeDetails, recovery } = error.envelope;
  return { check, status: "missing", code, details: { ...safeDetails }, recovery };
}

class TaskCheckRows {
  readonly rows: TaskCheckRow[] = [];

  async run<T>(check: string, probe: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await probe();
      this.rows.push({ check, status: "ready" });
      return value;
    } catch (error) {
      this.rows.push(missing(check, error));
      return undefined;
    }
  }

  skip(check: string, dependsOn: string): void {
    this.rows.push({ check, status: "not-checked", dependsOn });
  }
}

const probeOnly = async () => {
  throw new Error("task check starts no provider session");
};

// invariant: TCK-06. The driver's own probe judges the version against the
// minimum the run applies; only `--version` is started.
async function requireClaude(io: TaskCommandIo): Promise<void> {
  const executable = await findExecutable("claude", io.env, io.platform);
  const report = await new ClaudeCodeDriver({
    command: [executable],
    minimumVersion: CLAUDE_MEDIATED_MINIMUM_VERSION,
    resolveExecution: probeOnly
  }).probe();
  if (!report.available)
    throw notConfigured(
      report.error.code === "VES_CLAUDE_VERSION_UNSUPPORTED" ? "claude-version" : "executable:claude",
      `Claude Code ${CLAUDE_MEDIATED_MINIMUM_VERSION} or later in its major line is required`
    );
}

async function requireCodex(io: TaskCommandIo, request: PlannedTaskRequest | undefined): Promise<string> {
  const executable = await findExecutable("codex", io.env, io.platform);
  const report = await new CodexDriver({
    command: [executable],
    ...(request?.schemaVersion === 2 ? { minimumVersion: CODEX_STRUCTURED_MINIMUM_VERSION } : {}),
    resolveExecution: probeOnly
  }).probe();
  if (!report.available)
    throw notConfigured(
      report.error.code === "VES_CODEX_VERSION_UNSUPPORTED" ? "codex-version" : "executable:codex",
      "The installed Codex does not meet the version this run needs"
    );
  return executable;
}

// why: the status check runs from a temporary home outside the Workspace, so
// `task check` creates no Workspace state, and a missing identity directory is
// a missing login rather than something to set up here.
async function requireCodexLogin(io: TaskCommandIo, workspace: TaskWorkspace, codex: string): Promise<void> {
  const directory = codexIdentityDirectory(workspace.layout.workspaceRoot);
  const present = await access(directory).then(
    () => true,
    () => false
  );
  const home = await mkdtemp(join(tmpdir(), "verchestra-task-check-"));
  try {
    if (present && (await codexSubscriptionLoggedIn({ command: [codex], directory, home, env: io.env }))) return;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  throw notConfigured("codex-login", "Codex is not signed in with a ChatGPT plan in the Workspace identity directory");
}

function credentialNames(auth: ProviderAuth): readonly string[] {
  return [
    IMPLEMENTER_CREDENTIALS[auth.implementer],
    ...(auth.verifier === "api-key" ? [VERIFIER_CREDENTIAL] : []),
    SIGNING_PASSPHRASE
  ];
}

async function checkCredentials(
  rows: TaskCheckRows,
  io: TaskCommandIo,
  workspace: TaskWorkspace,
  auth: ProviderAuth | undefined
): Promise<void> {
  if (auth === undefined) rows.skip("credential:providers", "provider-modes");
  const source = {
    workspaceId: workspace.workspaceId,
    platform: io.platform,
    ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
  };
  for (const name of auth === undefined ? [SIGNING_PASSPHRASE] : credentialNames(auth))
    await rows.run(`credential:${name}`, () => requireCredentialBound(source, name));
}

async function checkRequestSettings(
  rows: TaskCheckRows,
  io: TaskCommandIo,
  workspace: TaskWorkspace,
  request: PlannedTaskRequest | undefined,
  auth: ProviderAuth | undefined
): Promise<void> {
  if (request === undefined) {
    for (const check of ["gate-allowlist", "api-key-models"]) rows.skip(check, "request");
    return;
  }
  await rows.run("gate-allowlist", () => loadGateAllowlist(workspace, request, io.stderr));
  if (auth === undefined) rows.skip("api-key-models", "provider-modes");
  else await rows.run("api-key-models", async () => requireModelsPricedForApiKey(auth, request));
  if (request.schemaVersion !== 2) return;
  if (auth === undefined) rows.skip("billing", "provider-modes");
  else
    await rows.run("billing", () =>
      requireSubscriptionPreflight({ workspaceRoot: workspace.layout.workspaceRoot, auth, request, stderr: io.stderr })
    );
}

async function checkProviders(
  rows: TaskCheckRows,
  io: TaskCommandIo,
  workspace: TaskWorkspace | undefined,
  request: PlannedTaskRequest | undefined,
  auth: ProviderAuth | undefined
): Promise<void> {
  const runsClaude = request === undefined || providerModels(request).claude.length > 0;
  if (runsClaude) await rows.run("executable:claude", () => requireClaude(io));
  const codex = await rows.run("executable:codex", () => requireCodex(io, request));
  if (auth?.verifier === "api-key") return;
  const waitsFor = workspace === undefined ? "workspace" : auth === undefined ? "provider-modes" : undefined;
  if (waitsFor !== undefined) rows.skip("codex-login", waitsFor);
  else if (codex === undefined) rows.skip("codex-login", "executable:codex");
  else await rows.run("codex-login", () => requireCodexLogin(io, workspace as TaskWorkspace, codex));
}

async function checkWindows(
  rows: TaskCheckRows,
  io: TaskCommandIo,
  workspace: TaskWorkspace | undefined,
  request: PlannedTaskRequest | undefined,
  auth: ProviderAuth | undefined
): Promise<void> {
  if (io.platform !== "win32" || (request !== undefined && providerModels(request).claude.length === 0)) return;
  if (workspace === undefined || auth === undefined)
    rows.skip("windows", workspace === undefined ? "workspace" : "provider-modes");
  else
    await rows.run("windows", () =>
      requireWindowsPrerequisites({
        platform: io.platform,
        sessionsRoot: workspace.layout.sessionsRoot,
        claude: auth.implementer
      })
    );
}

// why: without a Workspace there is no state directory to read settings or a
// login from, and no Workspace ID to look a credential up under.
function workspaceChecks(request: PlannedTaskRequest | undefined): readonly string[] {
  return [
    "gate-allowlist",
    "provider-modes",
    "api-key-models",
    ...(request?.schemaVersion === 2 ? ["billing"] : []),
    `credential:${SIGNING_PASSPHRASE}`
  ];
}

// why: the human line reads like a refusal, `CODE (k=v): recovery`, with the
// check it belongs to in front.
function line(row: TaskCheckRow): string {
  if (row.status === "not-checked") return `not-checked ${row.check}: waits for ${row.dependsOn}`;
  const details = Object.entries(row.details ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  const named = details === "" ? "" : ` (${details})`;
  return `missing ${row.check}: ${row.code}${named}${row.recovery === undefined ? "" : `: ${row.recovery}`}`;
}

export async function checkTask(io: TaskCommandIo, requestPath: string): Promise<CommandResult> {
  const rows = new TaskCheckRows();
  const workspace = await rows.run("workspace", () => openTaskWorkspace(io, { ensure: false }));
  const request = await rows.run("request", () => readRequest(io, requestPath));
  let auth: ProviderAuth | undefined;
  if (workspace === undefined) for (const check of workspaceChecks(request)) rows.skip(check, "workspace");
  else {
    auth = await rows.run("provider-modes", () => loadProviderAuth(workspace.layout.workspaceRoot));
    await checkRequestSettings(rows, io, workspace, request, auth);
    await checkCredentials(rows, io, workspace, auth);
  }
  await checkProviders(rows, io, workspace, request, auth);
  await checkWindows(rows, io, workspace, request, auth);
  const ready = rows.rows.every((row) => row.status === "ready");
  return {
    data: { ready, checks: rows.rows },
    diagnostics: rows.rows.filter((row) => row.status !== "ready").map(line),
    exitCode: ready ? 0 : 4
  };
}
