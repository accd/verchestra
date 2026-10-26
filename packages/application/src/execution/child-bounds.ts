// invariant: ARQ-003 (#597). A child process started outside a provider
// session runs to a bound: past its timeout it is killed with SIGKILL and its
// start fails, so a hung helper cannot hold a command open. A provider
// session is not one of these; its budget and cancellation end it.
// why: every adapter that starts such a child shares these bounds, the way it
// shares childEnvironment, so no adapter picks its own.
export interface ChildBound {
  readonly timeout: number;
  readonly killSignal: "SIGKILL";
}

const bound = (timeout: number): ChildBound => Object.freeze({ timeout, killSignal: "SIGKILL" });

// why: task-path git checks out, diffs, and commits a whole worktree, which
// takes minutes, not seconds, on a large repository.
export const GIT_CHILD_BOUND = bound(10 * 60_000);

// why: read-only Git inspection, the process table, and taskkill answer in
// well under a second on a healthy host.
export const INSPECTION_CHILD_BOUND = bound(60_000);

// invariant: execFile marks the child it killed at its timeout as `killed`,
// and execFileSync and spawnSync report ETIMEDOUT. An exit status, an output
// overflow, or a missing executable is not a timeout.
export function childTimedOut(error: unknown): boolean {
  const failure = error as { readonly killed?: unknown; readonly code?: unknown } | null | undefined;
  return failure?.killed === true || failure?.code === "ETIMEDOUT";
}
