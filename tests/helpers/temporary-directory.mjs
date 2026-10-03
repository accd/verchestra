import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// hazard: on Windows a child that is still exiting holds its working directory
// open, so a single recursive removal can fail with EBUSY. The retries wait out
// that transient class; they are inert on POSIX.
const REMOVAL = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

export function removeTemporaryDirectory(path) {
  return rm(path, REMOVAL);
}

// invariant: the directory is removed when `context` (a test or suite context)
// ends, pass or fail, so no run leaves it behind under the OS temp directory.
export async function temporaryDirectory(context, prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => removeTemporaryDirectory(path));
  return path;
}
