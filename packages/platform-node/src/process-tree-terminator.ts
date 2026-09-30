import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// invariant: `pid` was spawned with `detached: true` on POSIX, so it is also the
// id of a process group the child owns. Signalling `-pid` reaches every member
// that did not leave the group, including descendants the target itself forked.
// why: extracted unchanged from the T59 gate adapter so the gate runner and the
// out-of-process probe host share one qualified termination routine instead of
// a third copy (npx-launcher T2 follow-up).
export async function terminateProcessGroup(pid: number, incomplete: () => never): Promise<void> {
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {
      // why: the process may already have exited.
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(await groupGone(pid, error))) throw error;
    return;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (await groupGone(pid, error)) return;
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  }
  incomplete();
}

// hazard: Darwin answers a group signal with EPERM, not ESRCH, when every member
// left is a zombie awaiting its reaper, so on a slow host a fully killed tree
// looked like a failure. EPERM alone cannot tell that apart from a live member
// this user may not signal, so only a process table that shows no live member
// of the group counts as gone; without a table the error stands.
async function groupGone(pgid: number, error: unknown): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ESRCH") return true;
  if (code !== "EPERM") return false;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ps", ["-A", "-o", "pgid=,stat="], { encoding: "utf8", windowsHide: true }));
  } catch {
    return false;
  }
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\S+)/u.exec(line);
    if (match?.[1] !== undefined && Number(match[1]) === pgid && match[2]?.startsWith("Z") !== true) return false;
  }
  return true;
}

function parseProcessTable(stdout: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) parents.set(Number(match[1]), Number(match[2]));
  }
  return parents;
}

// why: a descendant that called setsid() has left the process group, so the group
// signal alone cannot reach it. The table is read before the group is signalled,
// while the intermediate parent is still alive to link the escapee to the root.
export async function snapshotDescendants(rootPid: number): Promise<readonly number[]> {
  if (process.platform === "win32") return [];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", windowsHide: true }));
  } catch {
    // hazard: without a process table only the group signal applies; a setsid()
    // escapee then survives. That residual is documented in the probe host
    // threat model rather than turned into a failed probe.
    return [];
  }
  const children = new Map<number, number[]>();
  for (const [child, parent] of parseProcessTable(stdout)) {
    const siblings = children.get(parent) ?? [];
    siblings.push(child);
    children.set(parent, siblings);
  }
  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const next = pending.pop() as number;
    descendants.push(next);
    pending.push(...(children.get(next) ?? []));
  }
  return descendants;
}

export function killProcesses(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // invariant: an EPERM target is no longer this user's descendant (its pid
      // was reused after the snapshot), so it is not ours to kill.
      if (code !== "ESRCH" && code !== "EPERM") throw error;
    }
  }
}
