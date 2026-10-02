export type ProcessTreeTerminator = (pid: number) => Promise<void>;

// invariant: a provider child leads a process group of its own on POSIX, so
// one signal to that group reaches every descendant that did not leave it.
// Windows has no process groups; a tree is reached there only through the
// terminator the composition root injects.
export const OWN_PROCESS_GROUP = process.platform !== "win32";

// why: without an injected terminator a driver still stops what it can reach,
// which is the group it started, never the one process alone.
async function signalOwnGroup(pid: number): Promise<void> {
  try {
    process.kill(OWN_PROCESS_GROUP ? -pid : pid);
  } catch {
    // why: the group may already be gone, and a stop that finds nothing left
    // to stop has done its work.
  }
}

// why: the qualified tree terminator lives in platform-node, which a driver
// may not import; the composition root injects it, and it also reaches a
// descendant that left the group.
export function processTreeTerminator(injected: ProcessTreeTerminator | undefined): ProcessTreeTerminator {
  return injected ?? signalOwnGroup;
}

// invariant: one termination per child, whoever asks: the abort path, a
// stream that keeps failing, or a cancel. A stop reaches a driver twice, once
// through its signal and once through `cancel`, and a provider that the first
// request already stopped must not fail the second: on Windows a kill of a
// process that has exited is an error, and a cancel that fails emits no
// terminal event of its own, so the stop would lose its reason.
// why: a termination that failed is forgotten, so a later request tries again.
export function singleTermination(terminate: ProcessTreeTerminator, pid: number): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () =>
    (stopping ??= terminate(pid).catch((error: unknown) => {
      stopping = undefined;
      throw error;
    }));
}

// invariant: a provider is ended in more ways than by a stop: its stream
// fails, it exceeds its output limit, it stops reading its input, or its run
// ends while it is still running. Each of these goes through the termination
// of its child as well, so none of them leaves a descendant behind.
// why: no caller awaits such an end. A termination that fails there has no one
// to answer to, and the run still waits for the provider's own exit.
export function unawaitedTermination(stop: () => Promise<void>): () => void {
  return () => {
    stop().catch(() => undefined);
  };
}
