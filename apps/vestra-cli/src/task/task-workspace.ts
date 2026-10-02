import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { StableId } from "@verchestra/domain";
import {
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
}

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
  return Object.freeze({
    workspaceId: identity.workspaceId,
    repositoryRoot: root,
    layout,
    tasksRoot: join(layout.workspaceRoot, "tasks")
  });
}

export function runDirectory(workspace: TaskWorkspace, runId: string): string {
  return join(workspace.tasksRoot, parseRunId(runId));
}

// hazard: two processes (a running `start` and a `cancel` or `status`) share
// this database; the default 100 ms busy timeout would turn ordinary contention
// into a failure.
export function openRuntime(workspace: TaskWorkspace): RuntimeStore {
  const store = new RuntimeStore({ dbPath: workspace.layout.runtimeDatabase, timeoutMs: 5_000 });
  store.open();
  return store;
}
