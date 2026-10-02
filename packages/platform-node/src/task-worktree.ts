import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { safeEnvironment } from "./safe-environment.ts";

const execFileAsync = promisify(execFile);
const MAXIMUM_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

// invariant: a Git object ID is a complete SHA-1 (40 hex) or SHA-256 (64 hex)
// name; every task worktree fact below accepts both and nothing shorter.
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const HANDLE_ID = /^[a-f0-9]{32}$/u;
const HANDLE = /^worktree:([a-f0-9]{32}):([a-f0-9]{40}|[a-f0-9]{64})$/u;
// invariant: a run or task ID becomes one ref component of
// refs/heads/vestra/<runId>/<taskId>, so it may not contain a separator or any
// character git check-ref-format rejects; git still validates the whole ref.
const REF_COMPONENT = /^(?!.*\.\.)(?!.*\.lock$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRAILER = /^(Verchestra-Task|Verchestra-Run|Verchestra-Gate-Evidence|Verchestra-Idempotency-Key): (.+)$/gmu;

export function isGitObjectId(value: string): boolean {
  return OBJECT_ID.test(value);
}

export interface WorktreeHandle {
  readonly id: string;
  readonly baseCommit: string;
}

// invariant: the handle is `worktree:<id>:<baseCommit>`. It is written and read
// only here; every other module carries it as an opaque string.
export function encodeWorktreeHandle(handle: WorktreeHandle): string | undefined {
  if (!HANDLE_ID.test(handle.id) || !OBJECT_ID.test(handle.baseCommit)) return undefined;
  return `worktree:${handle.id}:${handle.baseCommit}`;
}

export function parseWorktreeHandle(worktreeRef: string): WorktreeHandle | undefined {
  const match = HANDLE.exec(worktreeRef);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return Object.freeze({ id: match[1], baseCommit: match[2] });
}

export function isTaskBranchComponent(value: string): boolean {
  return REF_COMPONENT.test(value);
}

export function taskBranchName(runId: string, taskId: string): string {
  return `vestra/${runId}/${taskId}`;
}

export function taskBranchRef(runId: string, taskId: string): string {
  return `refs/heads/${taskBranchName(runId, taskId)}`;
}

export interface TaskCommitMessageInput {
  readonly subject: string;
  readonly taskId: string;
  readonly runId: string;
  readonly requirementIds: readonly string[];
  readonly gatePlanDigest: string;
  readonly gateEvidenceDigest: string;
  readonly expectedChangeDigest: string;
  readonly idempotencyKey: string;
}

function codeUnitOrder(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

// invariant: these bytes are compared whole when a commit is reconciled, so
// the trailer names, their order, and the separators never change.
export function taskCommitMessage(input: TaskCommitMessageInput): string {
  return [
    input.subject,
    "",
    `Verchestra-Task: ${input.taskId}`,
    `Verchestra-Run: ${input.runId}`,
    `Verchestra-Requirements: ${[...input.requirementIds].sort(codeUnitOrder).join(",")}`,
    `Verchestra-Gate-Plan: ${input.gatePlanDigest}`,
    `Verchestra-Gate-Evidence: ${input.gateEvidenceDigest}`,
    `Verchestra-Change: ${input.expectedChangeDigest}`,
    `Verchestra-Idempotency-Key: ${input.idempotencyKey}`
  ].join("\n");
}

export interface TaskCommitTrailers {
  readonly runId: string;
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly gateEvidenceDigest: string | undefined;
}

// invariant: when a trailer name repeats, the last line wins: the block this
// module writes ends the message, so a subject cannot shadow it.
export function parseTaskCommitTrailers(message: string): TaskCommitTrailers {
  const trailers = new Map([...message.matchAll(TRAILER)].map((match) => [match[1], match[2] ?? ""]));
  const gateEvidence = trailers.get("Verchestra-Gate-Evidence") ?? "";
  return Object.freeze({
    runId: (trailers.get("Verchestra-Run") ?? "").trim(),
    taskId: (trailers.get("Verchestra-Task") ?? "").trim(),
    idempotencyKey: (trailers.get("Verchestra-Idempotency-Key") ?? "").trim(),
    gateEvidenceDigest: DIGEST.test(gateEvidence) ? gateEvidence : undefined
  });
}

export interface GitOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<GitOutput>;

// why: the scrub must not cost git what it legitimately needs. These locate
// the user's own configuration when it is not under HOME, and name the commit
// identity when it is given by environment instead of configuration; none of
// them can aim git at another repository or change what it executes.
const GIT_VARIABLES = [
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL"
] as const;

// hazard: git reads its repository, index, object store, configuration, and
// helper programs from GIT_* variables before it looks at its working
// directory. An inherited GIT_DIR, GIT_CONFIG_* or GIT_EXEC_PATH would turn a
// worktree operation into one on another repository or under other rules, so
// git never inherits this process's environment.
export function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = safeEnvironment();
  for (const key of GIT_VARIABLES) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function spawnOptions(cwd: string, maxBuffer: number) {
  return { cwd, env: gitEnvironment(), maxBuffer, windowsHide: true } as const;
}

// invariant: every git process the task path starts goes through runGit or
// runGitBytes: an argument vector (never a shell), a bounded buffer, an
// explicit working directory, and the scrubbed environment above.
export async function runGit(
  cwd: string,
  args: readonly string[],
  maximumOutputBytes = MAXIMUM_GIT_OUTPUT_BYTES
): Promise<GitOutput> {
  const { stdout, stderr } = await execFileAsync("git", [...args], {
    ...spawnOptions(cwd, maximumOutputBytes),
    encoding: "utf8"
  });
  return { stdout, stderr };
}

export async function runGitBytes(cwd: string, args: readonly string[], maximumOutputBytes: number): Promise<Buffer> {
  return (
    await execFileAsync("git", [...args], {
      ...spawnOptions(cwd, maximumOutputBytes),
      encoding: "buffer"
    })
  ).stdout;
}

// why: the worktree adapter and the gate runner decide from the same listing:
// the HEAD of every registered worktree, keyed by its resolved directory.
export function registeredWorktrees(porcelain: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  let path: string | undefined;
  for (const line of porcelain.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) path = resolve(line.slice("worktree ".length));
    if (path !== undefined && line.startsWith("HEAD ")) {
      entries.set(path, line.slice("HEAD ".length));
      path = undefined;
    }
  }
  return entries;
}

export async function refTarget(
  repositoryRoot: string,
  ref: string,
  git: GitRunner = runGit
): Promise<string | undefined> {
  const listed = (await git(repositoryRoot, ["for-each-ref", "--format=%(refname) %(objectname)", ref])).stdout;
  for (const line of listed.split(/\r?\n/u)) {
    const [name, objectId] = line.split(" ");
    if (name === ref) return objectId;
  }
  return undefined;
}
