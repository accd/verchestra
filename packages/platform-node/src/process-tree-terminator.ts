import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { INSPECTION_CHILD_BOUND, childTimedOut } from "@verchestra/application";

import { systemRoot } from "./os-secret-backends/windows-credential-manager.ts";

const execFileAsync = promisify(execFile);

// why: the System32 program by absolute path, never a PATH lookup, so no
// entry on PATH can substitute the program that ends a process tree.
export function taskkillExecutable(): string {
  return String.raw`${systemRoot()}\System32\taskkill.exe`;
}

// invariant: `pid` was spawned with `detached: true` on POSIX, so it is also the
// id of a process group the child owns. Signalling `-pid` reaches every member
// that did not leave the group, including descendants the target itself forked.
// why: extracted unchanged from the T59 gate adapter so the gate runner and the
// out-of-process probe host share one qualified termination routine instead of
// a third copy (npx-launcher T2 follow-up).
export async function terminateProcessGroup(pid: number, incomplete: () => never): Promise<void> {
  if (process.platform === "win32") {
    await taskkillTree(pid, incomplete);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(await groupGone(pid, error))) throw error;
    return;
  }
  await awaitGroupGone(pid, incomplete);
}

async function taskkillTree(pid: number, incomplete: () => never): Promise<void> {
  try {
    await execFileAsync(taskkillExecutable(), ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      ...INSPECTION_CHILD_BOUND
    });
  } catch (error) {
    // why: the process may already have exited, and taskkill then fails. A
    // taskkill that outlived its bound ended nothing, so that is incomplete.
    if (childTimedOut(error)) incomplete();
  }
}

async function awaitGroupGone(pid: number, incomplete: () => never): Promise<void> {
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
    ({ stdout } = await execFileAsync("ps", ["-A", "-o", "pgid=,stat="], {
      encoding: "utf8",
      windowsHide: true,
      ...INSPECTION_CHILD_BOUND
    }));
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
    ({ stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
      windowsHide: true,
      ...INSPECTION_CHILD_BOUND
    }));
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

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly zombie: boolean;
}

export async function readProcessTable(): Promise<readonly ProcessRow[] | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat="], {
      encoding: "utf8",
      windowsHide: true,
      ...INSPECTION_CHILD_BOUND
    }));
  } catch {
    return undefined;
  }
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const [pid, ppid, pgid, stat] = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/u.exec(line)?.slice(1) ?? [];
    if (stat !== undefined)
      rows.push({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), zombie: stat.startsWith("Z") });
  }
  return rows;
}

// why: the processes reachable by parentage from the group's live members, the
// root first when it still runs. A member that called setsid() keeps its
// parent while that parent is stopped, so the link survives until the kill.
function linkedProcesses(rows: readonly ProcessRow[], pgid: number, rootRunning: boolean): readonly number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.zombie) continue;
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row.pid);
    children.set(row.ppid, siblings);
  }
  const roots = rows.filter((row) => row.pgid === pgid && !row.zombie && (rootRunning || row.pid !== pgid));
  const found = new Set<number>();
  const pending = roots.map((row) => row.pid);
  while (pending.length > 0) {
    const next = pending.pop() as number;
    if (found.has(next)) continue;
    found.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return [...found];
}

// why: false when the target is still there but this user may not signal it,
// so a stopped tree cannot be claimed for a process the host cannot end.
function stopped(pid: number): boolean {
  try {
    process.kill(pid, "SIGSTOP");
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

const STOP_ROUNDS = 32;

export interface StoppedTreeOptions {
  readonly exited: () => boolean;
  readonly incomplete: () => never;
  readonly table?: () => Promise<readonly ProcessRow[] | undefined>;
}

// why: a group signal cannot reach a descendant that called setsid(), and a
// snapshot taken while the tree runs races every fork and exit in it. A stopped
// process can neither fork nor exit, and a stopped parent cannot reap, so a pid
// found under a stopped parent is still that descendant when it is killed. The
// group is stopped first, then every process linked to it by parentage, until a
// table shows nothing new; only then is anything killed (#569).
// invariant: `running` is true only if the root had not exited when its group
// was stopped. A root that exited first has already orphaned its children, so
// a caller must not treat the sweep as complete.
// hazard: a descendant orphaned before the group was stopped, by a double fork
// whose middle process already exited, is linked to nothing and is not found.
export async function terminateStoppedTree(
  pid: number,
  options: StoppedTreeOptions
): Promise<{ readonly running: boolean }> {
  // invariant: POSIX only; the probe host refuses win32 before it starts a worker.
  if (process.platform === "win32") options.incomplete();
  const found = new Set<number>();
  let outcome: { readonly running: boolean; readonly complete: boolean };
  try {
    stopGroup(pid);
    outcome = await stopLinked(pid, options, found);
  } finally {
    try {
      await terminateProcessGroup(pid, options.incomplete);
    } finally {
      killProcesses([...found].filter((member) => member !== pid));
    }
  }
  if (!outcome.complete) options.incomplete();
  return { running: outcome.running };
}

function stopGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGSTOP");
  } catch (error) {
    // why: ESRCH is a group with no member left; EPERM is Darwin's answer for
    // a group of zombies only (see groupGone). Neither leaves anything to stop.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

async function stopLinked(
  pid: number,
  options: StoppedTreeOptions,
  found: Set<number>
): Promise<{ readonly running: boolean; readonly complete: boolean }> {
  let running = false;
  for (let round = 0; round <= STOP_ROUNDS; round += 1) {
    const rows = await (options.table ?? readProcessTable)();
    // invariant: without a table nothing outside the group can be found, so
    // the sweep is incomplete rather than reduced to the group kill.
    if (rows === undefined) return { running, complete: false };
    // why: the root runs only if the table shows it live and the host has not
    // seen it exit, read after the table: a root already a zombie when it was
    // stopped can be reaped, and its pid reused, while the table is read.
    if (round === 0) running = rows.some((row) => row.pid === pid && !row.zombie) && !options.exited();
    const fresh = linkedProcesses(rows, pid, running).filter((member) => !found.has(member));
    if (fresh.length === 0) return { running, complete: true };
    if (!stopAll(fresh, found)) return { running, complete: false };
  }
  return { running, complete: false };
}

function stopAll(members: readonly number[], found: Set<number>): boolean {
  let signalled = true;
  for (const member of members) {
    found.add(member);
    signalled = stopped(member) && signalled;
  }
  return signalled;
}

// why: a group signal alone leaves a setsid() escapee alive, so the tree is
// recorded first and what the signal could not reach is killed afterwards. The
// provider drivers stop a child through this routine; the probe host stops its
// tree before it looks (terminateStoppedTree).
// invariant: the escapees are killed even when the group could not be
// confirmed dead, so a failed termination still stops everything it found.
export async function terminateProcessTree(pid: number, incomplete: () => never): Promise<void> {
  const escapees = await snapshotDescendants(pid);
  try {
    await terminateProcessGroup(pid, incomplete);
  } finally {
    killProcesses(escapees);
  }
}
