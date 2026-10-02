// invariant: every process started in the process-tree termination suites
// (ADP-4, C4-4) belongs to the test and is killed by id when its case ends;
// nothing outside those ids is signalled.

// invariant: whatever the case proved, no process it started outlives it.
export function reap(t, pids) {
  t.after(() => {
    for (const pid of pids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
      }
    }
  });
}
