// invariant: door 4 of .specs/features/sqlite-probe-worker/plan.md (AD-087). A
// source checkout builds the first-party SQLite probe worker with the release
// builder's own bundling code (scripts/t76-build-candidate.mjs
// `bundleSealedLauncher`, the launchers' option vector, the lazy node:sqlite
// shim and the check that a child bundle imports only `node:` modules), so the
// file `vestra probe worker` copies from a checkout is the bundle a sealed
// release carries at `bin/sqlite-probe-worker.mjs`. The output is build output,
// git-ignored and never canonical (AGENTS.md).
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gitExecutable } from "./git-executable.mjs";
import { bundleSealedLauncherWithMetafile } from "./t76-build-candidate.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PROBE_WORKER_COMPONENT = "probe:sqlite-worker";
export const PROBE_WORKER_OUTPUT = "apps/vestra-cli/dist/sqlite-probe-worker.mjs";

// why: the identity the builder compiles into a bundle. The worker reads none
// of it, so its bytes depend only on the sources and the pinned Node target
// (`engines.node`), which is the Node a release carries.
async function bundleIdentity(repository) {
  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const revision = execFileSync(gitExecutable(), ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true
  }).trim();
  return { semanticVersion: manifest.version, revision, nodeVersion: manifest.engines?.node };
}

// why: the bundle and the bundler's record of every import it makes, which
// the builder has already held to `node:` modules only.
export async function bundleProbeWorker(repository = ROOT) {
  return bundleSealedLauncherWithMetafile({
    repository,
    componentId: PROBE_WORKER_COMPONENT,
    ...(await bundleIdentity(repository))
  });
}

// invariant: AC 12. The bundle is written whole or not at all: identical bytes
// already in place are left as they are, and new bytes replace the file in one
// rename, so a reader never sees a partial bundle.
export async function buildProbeWorker(repository = ROOT) {
  const { bytes } = await bundleProbeWorker(repository);
  const output = join(repository, ...PROBE_WORKER_OUTPUT.split("/"));
  const current = await readFile(output).catch(() => undefined);
  if (current?.equals(bytes) === true) return output;
  await mkdir(dirname(output), { recursive: true });
  const staged = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(staged, bytes, { flag: "wx" });
    await rename(staged, output);
  } finally {
    await rm(staged, { force: true });
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildProbeWorker();
  console.log(`built ${PROBE_WORKER_OUTPUT}`);
}
