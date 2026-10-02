import { terminateProcessTree } from "@verchestra/platform-node";

// why: Claude Code and Codex each lead a process group of their own, and a
// process they start can leave it. Stopping a provider therefore kills the
// group and every descendant found before the kill, instead of the one
// process the driver started.
// hazard: the drivers call this from an abort listener, where a rejection
// would be unhandled and end the whole command, so it never rejects. A tree
// that could not be confirmed gone is not reported by this function; the
// session still ends, and it ends as cancelled.
export async function terminateProviderTree(pid: number): Promise<void> {
  try {
    await terminateProcessTree(pid, () => {
      throw new Error("provider process tree remained alive after termination");
    });
  } catch {
    // why: the provider may already have exited, and nothing more can be done
    // for a tree that survived the kill.
  }
}
