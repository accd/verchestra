import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import type { TaskGateCommand, TaskGateRunnerResult } from "@verchestra/application";

import { NodeGitWorktreeAdapter } from "./git-worktree-adapter.ts";
import { terminateProcessGroup } from "./process-tree-terminator.ts";
import { safeEnvironment } from "./safe-environment.ts";
import {
  isGitObjectId,
  isWithinDirectory,
  resolveWorktreeHandle,
  runGit,
  taskCommitMessage,
  WorktreeRefusalError,
  type GitRunner,
  type ResolvedWorktree,
  type WorktreeRefusal,
  type WorktreeRoots
} from "./task-worktree.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export class GateAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GateAdapterError";
    this.code = code;
  }
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new GateAdapterError(code, message, options);
}

// invariant: the worktree module resolves a handle for both adapters here;
// each refusal keeps the code these adapters have always reported.
const REFUSAL_CODES: Readonly<Record<WorktreeRefusal, string>> = Object.freeze({
  handle: "VES_GATE_ADAPTER_HANDLE_INVALID",
  unregistered: "VES_GATE_ADAPTER_HANDLE_INVALID",
  missing: "VES_GATE_ADAPTER_HANDLE_INVALID",
  repository: "VES_GATE_ADAPTER_INPUT_INVALID",
  root: "VES_GATE_ADAPTER_PATH_ESCAPE",
  escape: "VES_GATE_ADAPTER_PATH_ESCAPE"
});

async function resolved(
  roots: WorktreeRoots,
  worktreeRef: string,
  options: { readonly baseCommit?: string; readonly git: GitRunner }
): Promise<ResolvedWorktree> {
  try {
    return await resolveWorktreeHandle(roots, worktreeRef, options);
  } catch (error) {
    if (error instanceof WorktreeRefusalError) fail(REFUSAL_CODES[error.refusal], error.message, { cause: error });
    throw error;
  }
}

export interface GateCommandProfile {
  readonly executable: string;
  readonly fixedArgs?: readonly string[];
  readonly protocols: readonly ("exit-code" | "test-summary")[];
}

export interface NodeGateProcessRunnerOptions {
  readonly repositoryRoot: string;
  readonly worktreesRoot: string;
  readonly commands: Readonly<Record<string, GateCommandProfile>>;
  readonly environment?: Readonly<Record<string, string>>;
}

function parseNodeTestSummary(output: string) {
  const plain = output.replaceAll(/\u001b\[[0-9;]*m/gu, "");
  const read = (label: string) => {
    const match = new RegExp(`(?:^|\\n)(?:#|ℹ)\\s*${label}\\s+(\\d+)`, "u").exec(plain);
    return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  };
  return {
    total: read("tests"),
    passed: read("pass"),
    failed: read("fail"),
    skipped: read("skipped"),
    cancelled: read("cancelled"),
    todo: read("todo")
  };
}

async function terminate(pid: number): Promise<void> {
  await terminateProcessGroup(pid, () =>
    fail("VES_GATE_ADAPTER_TERMINATION_INCOMPLETE", "Gate process group remained alive after termination")
  );
}

export class NodeGateProcessRunner {
  readonly #repositoryRoot: string;
  readonly #worktreesRoot: string;
  readonly #commands: Readonly<Record<string, GateCommandProfile>>;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: NodeGateProcessRunnerOptions) {
    if (!isAbsolute(options.repositoryRoot) || !isAbsolute(options.worktreesRoot))
      fail("VES_GATE_ADAPTER_INPUT_INVALID", "Repository and worktree roots must be absolute");
    this.#repositoryRoot = resolve(options.repositoryRoot);
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#commands = Object.freeze(
      Object.fromEntries(
        Object.entries(options.commands).map(([key, profile]) => [
          key,
          Object.freeze({
            executable: profile.executable,
            fixedArgs: Object.freeze([...(profile.fixedArgs ?? [])]),
            protocols: Object.freeze([...profile.protocols])
          })
        ])
      )
    );
    this.#environment = safeEnvironment(options.environment);
  }

  async run(command: TaskGateCommand & { readonly worktreeRef: string }): Promise<TaskGateRunnerResult> {
    const profile = this.#commands[command.commandRef];
    if (profile === undefined || !isAbsolute(profile.executable) || !profile.protocols.includes(command.resultProtocol))
      fail("VES_GATE_ADAPTER_COMMAND_DENIED", "Gate command is not locally allowlisted");
    if ([...(profile.fixedArgs ?? []), ...command.args].some((argument) => argument.includes("\0")))
      fail("VES_GATE_ADAPTER_COMMAND_DENIED", "Gate argument contains a null byte");
    const worktree = await resolved(
      { repositoryRoot: this.#repositoryRoot, worktreesRoot: this.#worktreesRoot },
      command.worktreeRef,
      { git: runGit }
    );
    // invariant: a gate judges the worktree as its handle names it: still at
    // the handle's commit, with nothing committed on top.
    if (worktree.head !== worktree.handle.baseCommit)
      fail("VES_GATE_ADAPTER_HANDLE_INVALID", "Gate target is not the expected registered worktree");
    const target = worktree.directory;
    const requestedCwd = command.cwd === "." ? target : join(target, ...command.cwd.split("/"));
    const cwd = await realpath(requestedCwd);
    if (!isWithinDirectory(target, cwd)) fail("VES_GATE_ADAPTER_PATH_ESCAPE", "Gate cwd escaped the worktree");

    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    const captured: Buffer[] = [];
    let capturedBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let termination: Promise<void> | undefined;
    const child = spawn(profile.executable, [...(profile.fixedArgs ?? []), ...command.args], {
      cwd,
      env: this.#environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
      if (stream === "stdout") {
        stdoutBytes += chunk.byteLength;
        stdoutHash.update(chunk);
      } else {
        stderrBytes += chunk.byteLength;
        stderrHash.update(chunk);
      }
      const remaining = Math.max(0, command.outputLimitBytes - capturedBytes);
      if (remaining > 0) {
        const part = chunk.subarray(0, remaining);
        captured.push(part);
        capturedBytes += part.byteLength;
      }
      if (stdoutBytes + stderrBytes > command.outputLimitBytes && !outputLimitExceeded) {
        outputLimitExceeded = true;
        termination ??= terminate(child.pid!);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    const timer = setTimeout(() => {
      timedOut = true;
      termination ??= terminate(child.pid!);
    }, command.timeoutMs);
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code ?? -1));
    }).finally(() => clearTimeout(timer));
    await termination;
    const combined = Buffer.concat(captured).toString("utf8");
    const stdoutDigest = `sha256:${stdoutHash.digest("hex")}`;
    const stderrDigest = `sha256:${stderrHash.digest("hex")}`;
    return Object.freeze({
      exitCode,
      timedOut,
      outputLimitExceeded,
      stdoutDigest,
      stderrDigest,
      stdoutBytes,
      stderrBytes,
      outputRef: `gate-output:${createHash("sha256").update(`${stdoutDigest}:${stderrDigest}`).digest("hex")}`,
      ...(command.resultProtocol === "test-summary" ? { tests: parseNodeTestSummary(combined) } : {})
    });
  }
}

interface CommitRequest {
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly requirementIds: readonly string[];
  readonly worktreeRef: string;
  readonly baseCommit: string;
  readonly subject: string;
  readonly expectedChangedPaths: readonly string[];
  readonly expectedChangeDigest: string;
  readonly gatePlanDigest: string;
  readonly gateEvidenceDigest: string;
  readonly gateEvidenceRefs: readonly string[];
  readonly idempotencyKey: string;
}

export interface NodeAtomicGitCommitAdapterOptions {
  readonly repositoryRoot: string;
  readonly worktreesRoot: string;
  readonly runGit?: GitRunner;
}

export class NodeAtomicGitCommitAdapter {
  readonly #repositoryRoot: string;
  readonly #worktreesRoot: string;
  readonly #runGit: GitRunner;
  readonly #worktrees: NodeGitWorktreeAdapter;

  constructor(options: NodeAtomicGitCommitAdapterOptions) {
    this.#repositoryRoot = resolve(options.repositoryRoot);
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#runGit =
      options.runGit ??
      (async (cwd, args) => {
        try {
          return await runGit(cwd, args);
        } catch (error) {
          fail("VES_GATE_GIT_COMMAND_FAILED", "Atomic Git command failed", { cause: error });
        }
      });
    this.#worktrees = new NodeGitWorktreeAdapter({
      repositoryRoot: this.#repositoryRoot,
      worktreesRoot: this.#worktreesRoot,
      runGit: this.#runGit
    });
  }

  async reconcile(request: CommitRequest) {
    this.#validateRequest(request);
    const target = await this.#target(request);
    const head = (await this.#git(target, ["rev-parse", "HEAD"])).stdout.trim();
    if (head === request.baseCommit) return undefined;
    const count = (await this.#git(target, ["rev-list", "--count", `${request.baseCommit}..HEAD`])).stdout.trim();
    if (count !== "1") fail("VES_GATE_GIT_COMMIT_CONFLICT", "Worktree contains an unexpected commit history");
    return await this.#receipt(target, request, "already-committed");
  }

  async commitAtomic(request: CommitRequest) {
    this.#validateRequest(request);
    const existing = await this.reconcile(request);
    if (existing !== undefined) return existing;
    const target = await this.#target(request);
    const before = await this.#worktrees.inspect({ worktreeRef: request.worktreeRef, baseCommit: request.baseCommit });
    if (
      before.changeDigest !== request.expectedChangeDigest ||
      JSON.stringify(before.changedPaths) !== JSON.stringify([...request.expectedChangedPaths].sort())
    )
      fail("VES_GATE_GIT_DIFF_DRIFT", "Worktree changed before atomic commit");
    await this.#git(target, ["add", "-A", "--", ...request.expectedChangedPaths]);
    const staged = (await this.#git(target, ["diff", "--cached", "--name-only", "-z", request.baseCommit, "--"])).stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.replaceAll("\\", "/"))
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...request.expectedChangedPaths].sort()))
      fail("VES_GATE_GIT_DIFF_DRIFT", "Staged paths do not match the authorized diff");
    const afterStage = await this.#worktrees.inspect({
      worktreeRef: request.worktreeRef,
      baseCommit: request.baseCommit
    });
    if (afterStage.changeDigest !== request.expectedChangeDigest)
      fail("VES_GATE_GIT_DIFF_DRIFT", "Worktree changed while staging the atomic commit");
    await this.#git(target, ["commit", "--no-verify", "--no-gpg-sign", "-m", taskCommitMessage(request)]);
    const status = (await this.#git(target, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout;
    if (status !== "") fail("VES_GATE_GIT_COMMIT_UNCERTAIN", "Commit succeeded but worktree is not clean");
    return await this.#receipt(target, request, "committed");
  }

  async #receipt(target: string, request: CommitRequest, status: "committed" | "already-committed") {
    const line = (await this.#git(target, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(/\s+/u);
    const commitId = line[0];
    const parentCommit = line[1];
    if (!isGitObjectId(commitId ?? "") || parentCommit !== request.baseCommit || line.length !== 2)
      fail("VES_GATE_GIT_COMMIT_CONFLICT", "Commit parent does not match the authorized base");
    const message = (await this.#git(target, ["show", "-s", "--format=%B", "HEAD"])).stdout.trimEnd();
    if (message !== taskCommitMessage(request))
      fail("VES_GATE_GIT_COMMIT_CONFLICT", "Commit trailers do not match the authorized gate evidence");
    return Object.freeze({
      status,
      commitId: commitId!,
      parentCommit,
      changeDigest: request.expectedChangeDigest,
      gateEvidenceDigest: request.gateEvidenceDigest,
      idempotencyKey: request.idempotencyKey
    });
  }

  async #target(request: CommitRequest): Promise<string> {
    return (
      await resolved(
        { repositoryRoot: this.#repositoryRoot, worktreesRoot: this.#worktreesRoot },
        request.worktreeRef,
        {
          baseCommit: request.baseCommit,
          git: (cwd, args) => this.#git(cwd, args)
        }
      )
    ).directory;
  }

  #validateRequest(request: CommitRequest): void {
    if (
      !isGitObjectId(request.baseCommit) ||
      !DIGEST.test(request.expectedChangeDigest) ||
      !DIGEST.test(request.gatePlanDigest) ||
      !DIGEST.test(request.gateEvidenceDigest) ||
      !DIGEST.test(request.idempotencyKey) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u.test(request.workspaceId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u.test(request.runId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u.test(request.taskId) ||
      request.requirementIds.length === 0 ||
      request.requirementIds.some((id) => !/^VES-[A-Z]{3}-[0-9]{3}$/u.test(id)) ||
      request.expectedChangedPaths.length === 0 ||
      !/^[\x20-\x7e]{1,512}$/u.test(request.subject)
    )
      fail("VES_GATE_GIT_INPUT_INVALID", "Atomic commit request is invalid");
  }

  async #git(cwd: string, args: readonly string[]) {
    try {
      return await this.#runGit(cwd, args);
    } catch (error) {
      if (error instanceof GateAdapterError) throw error;
      fail("VES_GATE_GIT_COMMAND_FAILED", "Atomic Git command failed", { cause: error });
    }
  }
}
