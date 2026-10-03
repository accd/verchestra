import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { TaskGateCommand, TaskGateRunnerResult } from "@verchestra/application";

import { runBoundedChild, type BoundedChildExit } from "./bounded-child-run.ts";
import { NodeGitWorktreeAdapter } from "./git-worktree-adapter.ts";
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

// invariant: the gate's verdict material, read off how its child ended: every
// byte of each stream is digested, a child the run stopped exits as -1 when it
// reports no status, and only a test-summary gate reads the captured output.
function gateResult(
  command: TaskGateCommand,
  observation: BoundedChildExit,
  digests: { readonly stdout: string; readonly stderr: string }
): TaskGateRunnerResult {
  return Object.freeze({
    exitCode: observation.exitCode ?? -1,
    timedOut: observation.timedOut,
    outputLimitExceeded: observation.outputLimitExceeded,
    stdoutDigest: digests.stdout,
    stderrDigest: digests.stderr,
    stdoutBytes: observation.stdoutBytes,
    stderrBytes: observation.stderrBytes,
    outputRef: `gate-output:${createHash("sha256").update(`${digests.stdout}:${digests.stderr}`).digest("hex")}`,
    ...(command.resultProtocol === "test-summary"
      ? { tests: parseNodeTestSummary(observation.output.toString("utf8")) }
      : {})
  });
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
    const args = [...(profile.fixedArgs ?? []), ...command.args];
    if (args.some((argument) => argument.includes("\0")))
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

    const hashes = { stdout: createHash("sha256"), stderr: createHash("sha256") };
    const observation = await runBoundedChild({
      executable: profile.executable,
      args,
      cwd,
      env: this.#environment,
      timeoutMs: command.timeoutMs,
      outputLimitBytes: command.outputLimitBytes,
      observe: (stream, chunk) => {
        hashes[stream].update(chunk);
      },
      incomplete: () =>
        fail("VES_GATE_ADAPTER_TERMINATION_INCOMPLETE", "Gate process group remained alive after termination")
    });
    if (observation.ended === "spawn-failed") throw observation.error;
    return gateResult(command, observation, {
      stdout: `sha256:${hashes.stdout.digest("hex")}`,
      stderr: `sha256:${hashes.stderr.digest("hex")}`
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
