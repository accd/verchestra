import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { StableId } from "@verchestra/domain";
import {
  NodeGitWorktreeAdapter,
  PlatformSecurityError,
  RuntimeStore,
  ensureWorkspaceState,
  resolveStateRoot,
  resolveWorkspaceState,
  worktreeRootFits,
  type WorkspaceStateLayout
} from "@verchestra/platform-node";
import { initPublicErrorRegistry, readWorkspaceIdentity } from "@verchestra/workspace";
import { PublicErrorException } from "@verchestra/domain";

import { cliError } from "../cli-errors.ts";
import { notConfigured } from "./task-errors.ts";
import { sha256 } from "./task-files.ts";
import { git } from "./task-git.ts";

export interface TaskWorkspace {
  readonly workspaceId: string;
  readonly repositoryRoot: string;
  readonly layout: WorkspaceStateLayout;
  readonly tasksRoot: string;
  readonly keysRoot: string;
  readonly verificationRoot: string;
}

// invariant: the state roots the task path owns beyond the Workspace layout:
// the Run records, the evidence key and its trust anchor, and the scratch
// checkouts of verification. Each is created by its first write.
const TASK_STATE_ROOTS = Object.freeze({ tasksRoot: "tasks", keysRoot: "keys", verificationRoot: "verification" });

export interface TaskWorkspaceIo {
  readonly controlRoot: string;
  readonly platform: string;
  readonly homeDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function parseRunId(value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error("run ID is not text");
    return StableId.parse(value, "run").value;
  } catch {
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--run-id" }, "Run ID is invalid");
  }
}

async function repositoryRoot(controlRoot: string): Promise<string> {
  let top: string;
  try {
    top = (await git(controlRoot, ["rev-parse", "--show-toplevel"])).trim();
  } catch (error) {
    throw notConfigured("git-repository", "The Workspace is not inside a Git repository", { cause: error });
  }
  const [real, control] = await Promise.all([realpath(top), realpath(controlRoot)]);
  // why: a governed task edits one repository whose root is the Workspace's
  // control root (colocated placement); anything else would let the
  // repository and the Workspace identity disagree about what is governed.
  if (real !== control)
    throw notConfigured("colocated-workspace", "Run vestra task from the repository root that holds .verchestra");
  return real;
}

function absent(error: unknown): boolean {
  const code = (error as { readonly code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (absent(error)) return false;
    throw error;
  }
}

// invariant: a task state root that exists resolves strictly inside the
// Workspace state root, so no task write, key, or scratch checkout (which
// verification deletes recursively) can land in, or be removed from, a place
// a link points to.
// hazard: this only reads. `ensureWorkspaceState` creates every directory it
// checks, so these roots are not part of it: a dry run must create nothing.
async function requireContained(workspaceRoot: string, directory: string): Promise<void> {
  if (!(await present(directory))) return;
  const comparable = (path: string): string => (process.platform === "win32" ? path.toLowerCase() : path);
  let child: string;
  try {
    const [owner, resolved] = await Promise.all([realpath(workspaceRoot), realpath(directory)]);
    child = relative(comparable(owner), comparable(resolved));
  } catch (error) {
    // why: a link whose target is gone resolves nowhere, which is not inside.
    throw new PlatformSecurityError(
      "VES_STATE_ROOT_ESCAPE",
      "Workspace state path does not resolve",
      {},
      { cause: error }
    );
  }
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new PlatformSecurityError("VES_STATE_ROOT_ESCAPE", "Workspace state path resolves outside its owner");
}

// invariant: below a task state root nothing is reached through a link. The
// directories named here, from a per-Run root down, are created by the task
// path itself and are real. A link at one of them would carry every read,
// write, and recursive delete below it to wherever it points, which is the
// escape the root check refuses, so it takes the same code.
// hazard: this only reads, and a directory that does not exist ends the walk:
// its first write creates it as a real directory. A file in a directory's
// place is left to the reader or writer that finds it.
export async function requireRealDirectories(root: string, directories: readonly string[]): Promise<void> {
  let current = root;
  for (const name of directories) {
    current = join(current, name);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (absent(error)) return;
      throw error;
    }
    if (metadata.isSymbolicLink())
      throw new PlatformSecurityError("VES_STATE_ROOT_ESCAPE", "A directory below a task state root is a link");
  }
}

export interface ScratchCheckouts {
  readonly root: string;
  readonly checkouts: NodeGitWorktreeAdapter;
}

type ScratchPurpose = "review" | "mutations";
const SCRATCH_PURPOSES: Readonly<Record<ScratchPurpose, string>> = Object.freeze({ review: "r", mutations: "m" });
const RUN_SEGMENT_LENGTH = 16;

// why: Git refuses a worktree whose `.git` path passes PATH_MAX - 40, 220
// bytes on Windows, so a scratch checkout lies only 22 characters deeper than
// the run's own worktree: below 16 hex digits of the run ID's digest and one
// letter per purpose, not below the run ID and the purpose's name. The
// segments are derived, so a checkout a killed verification left is found
// and replaced; review and mutation checkouts live only inside one
// verification, and no record names them.
export function scratchSegments(runId: string, purpose: ScratchPurpose): readonly [string, string] {
  return [sha256(runId).slice(7, 7 + RUN_SEGMENT_LENGTH), SCRATCH_PURPOSES[purpose]];
}

function scratchRoot(workspace: Pick<TaskWorkspace, "verificationRoot">, runId: string, purpose: ScratchPurpose) {
  return join(workspace.verificationRoot, ...scratchSegments(runId, purpose));
}

// invariant: before a run's first transition, every worktree directory it will
// ask Git to add (its own worktree, its review checkout, and its mutation
// checkouts) fits Git's limit on this platform, measured on the real path Git
// will be given. A state root too deep for one is `not configured`, never a
// Git failure in the middle of the run.
export async function requireWorktreePathBudget(
  workspace: Pick<TaskWorkspace, "layout" | "verificationRoot">,
  runId: string,
  platform: string = process.platform
): Promise<void> {
  const workspaceRoot = workspace.layout.workspaceRoot;
  const real = await realpath(workspaceRoot);
  const roots = [workspace.layout.worktreesRoot, scratchRoot(workspace, runId, "review")];
  roots.push(scratchRoot(workspace, runId, "mutations"));
  for (const root of roots)
    if (!worktreeRootFits(join(real, relative(workspaceRoot, root)), platform))
      throw notConfigured(
        "state-path-length",
        "The Workspace state root is too deep for Git to add the run's worktrees on this platform"
      );
}

// invariant: a scratch checkout is created, and deleted recursively, only
// below real directories. Every directory from the Workspace's verification
// root down to the run's scratch root is checked before each use, and the
// worktree module refuses a link in a checkout's own place.
export async function scratchCheckouts(
  workspace: Pick<TaskWorkspace, "repositoryRoot" | "verificationRoot">,
  runId: string,
  purpose: ScratchPurpose
): Promise<ScratchCheckouts> {
  await requireRealDirectories(workspace.verificationRoot, scratchSegments(runId, purpose));
  const root = scratchRoot(workspace, runId, purpose);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return {
    root,
    checkouts: new NodeGitWorktreeAdapter({ repositoryRoot: workspace.repositoryRoot, worktreesRoot: root })
  };
}

// why: `plan --dry-run` must write nothing, so it resolves the state layout
// without creating it.
export async function openTaskWorkspace(
  io: TaskWorkspaceIo,
  options: { readonly ensure: boolean } = { ensure: true }
): Promise<TaskWorkspace> {
  const identity = await readWorkspaceIdentity(io.controlRoot);
  if (identity === undefined)
    throw new PublicErrorException(
      initPublicErrorRegistry.create("VES_INIT_WORKSPACE_MISSING", {}),
      "No Workspace is initialized in this directory"
    );
  const root = await repositoryRoot(io.controlRoot);
  const layout = resolveWorkspaceState({
    stateRoot: resolveStateRoot({ platform: io.platform, env: io.env, homeDirectory: io.homeDirectory }),
    workspaceId: identity.workspaceId,
    platform: io.platform
  });
  if (options.ensure) await ensureWorkspaceState(layout);
  const tasksRoot = join(layout.workspaceRoot, TASK_STATE_ROOTS.tasksRoot);
  const keysRoot = join(layout.workspaceRoot, TASK_STATE_ROOTS.keysRoot);
  const verificationRoot = join(layout.workspaceRoot, TASK_STATE_ROOTS.verificationRoot);
  for (const directory of [tasksRoot, keysRoot, verificationRoot])
    await requireContained(layout.workspaceRoot, directory);
  return Object.freeze({
    workspaceId: identity.workspaceId,
    repositoryRoot: root,
    layout,
    tasksRoot,
    keysRoot,
    verificationRoot
  });
}

// hazard: two processes (a running `start` and a `cancel` or `status`) share
// this database; the default 100 ms busy timeout would turn ordinary contention
// into a failure.
export function openRuntime(workspace: TaskWorkspace): RuntimeStore {
  const store = new RuntimeStore({ dbPath: workspace.layout.runtimeDatabase, timeoutMs: 5_000 });
  store.open();
  return store;
}
