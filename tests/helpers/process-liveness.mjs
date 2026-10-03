import { execFileSync } from "node:child_process";

// invariant: these are liveness probes for processes a test started itself.
// Nothing here signals a process: signal 0 only asks whether it exists.

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // why: EPERM means a process with that id exists and belongs to someone
    // else, so the one the test started is gone and its id was reused.
    if (error.code === "ESRCH" || error.code === "EPERM") return false;
    throw error;
  }
}

// invariant: resolves with the first value of `probe` that is neither
// `undefined` nor `false`, or with its last value once the time is up, so a
// caller asserts on what it got instead of hanging.
export async function eventually(probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if ((value !== undefined && value !== false) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function eventuallyDead(pid, timeoutMs) {
  return eventually(() => !isAlive(pid), timeoutMs);
}

// why: a host that deschedules a run right after its spawn lets a fast
// provider finish and exit before the run's first write. This blocks the
// caller, without turning its event loop, until the process has exited, which
// makes that order certain: on POSIX the process is then a zombie its parent
// has not reaped; win32 has no process table to read, so the wait is a fixed
// two seconds there.
// invariant: the process table is read through the system's own `ps` by its
// absolute path.
export function blockUntilExited(pid) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  if (process.platform === "win32") {
    Atomics.wait(pause, 0, 0, 2_000);
    return;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    let state;
    try {
      state = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
      return;
    }
    if (state === "" || state.startsWith("Z")) return;
    Atomics.wait(pause, 0, 0, 10);
  }
}
