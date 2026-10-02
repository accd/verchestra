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
