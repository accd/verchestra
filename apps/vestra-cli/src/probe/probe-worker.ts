// invariant: door 1 and door 4 of .specs/features/sqlite-probe-worker/plan.md
// (AD-087). `vestra probe worker` writes Verchestra's own SQLite probe worker
// into the Workspace as a file the owner reviews, commits, registers and
// approves like any other worker. It never registers or approves it, and it
// never overwrites other bytes: the file holds the bundle's bytes, or nothing
// is written.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { fileDigest, resolveWorkspaceFile } from "../extension/extension-workspace.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { openTaskWorkspace } from "../task/task-workspace.ts";
import { probeError } from "./probe-errors.ts";

export interface ProbeWorkerOptions {
  readonly engine: string;
  readonly entry: string;
  // why: the bundle this layout carries (release-layout.ts
  // `resolveSqliteProbeWorker`), which may not exist in a source checkout.
  readonly bundle: string;
}

export interface ProbeWorkerOutput {
  readonly path: string;
  readonly engine: "sqlite";
  readonly digest: string;
  readonly written: boolean;
}

function targetInvalid(): never {
  throw probeError(
    "VES_PROBE_WORKER_TARGET_INVALID",
    {},
    "The worker path is not a file path inside the Workspace's Git top level"
  );
}

async function workerBundle(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw probeError(
      "VES_PROBE_WORKER_UNAVAILABLE",
      {},
      "No probe worker bundle is built; run `corepack pnpm build:probe-worker`",
      { cause: error }
    );
  }
}

// invariant: AC 1 to AC 6. The engine and the bundle are checked before the
// Workspace is opened, and the path is held to the entry rule `extension add`
// applies (resolveWorkspaceFile) before anything is created. A missing file is
// written once, exclusively; a file with the same bytes is left as it is; any
// other file is refused.
export async function writeProbeWorker(io: TaskCommandIo, options: ProbeWorkerOptions): Promise<ProbeWorkerOutput> {
  if (options.engine !== "sqlite")
    throw probeError("VES_PROBE_WORKER_ENGINE_UNSUPPORTED", {}, "SQLite is the only probe worker engine");
  const bytes = await workerBundle(options.bundle);
  const workspace = await openTaskWorkspace(io, { ensure: false });
  const target = await resolveWorkspaceFile(workspace.repositoryRoot, options.entry, targetInvalid);
  const output = { path: target.path, engine: "sqlite" as const, digest: fileDigest(bytes) };
  if (target.exists) {
    if (!(await readFile(target.absolute)).equals(bytes))
      throw probeError("VES_PROBE_WORKER_TARGET_CONFLICT", {}, "The worker path holds other bytes");
    return Object.freeze({ ...output, written: false });
  }
  await mkdir(dirname(target.absolute), { recursive: true });
  await writeFile(target.absolute, bytes, { flag: "wx" });
  return Object.freeze({ ...output, written: true });
}
