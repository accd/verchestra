import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { StableId } from "@verchestra/domain";
import {
  PlatformSecurityError,
  RuntimeStore,
  ensureWorkspaceState,
  resolveStateRoot,
  resolveWorkspaceState,
  type WorkspaceStateLayout
} from "@verchestra/platform-node";
import { initPublicErrorRegistry, readWorkspaceIdentity } from "@verchestra/workspace";
import { PublicErrorException } from "@verchestra/domain";

import { cliError } from "../cli-errors.ts";
import { notConfigured } from "./task-errors.ts";
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

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
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
