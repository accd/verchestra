import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PROBE_SCAFFOLD_ENGINES,
  buildProbeScaffoldFiles,
  defaultProbeScaffoldDirectory
} from "../../packages/workspace/src/index.ts";

// Writes the generated scaffold of every requested engine, exactly as init
// would, under one disposable root outside the repository.
export async function writeProbeScaffolds(engines = PROBE_SCAFFOLD_ENGINES) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-probe-scaffold-"));
  for (const engine of engines) {
    const files = buildProbeScaffoldFiles({
      engine,
      language: "typescript",
      directory: defaultProbeScaffoldDirectory(engine)
    });
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  }
  return {
    root,
    directory: (engine) => join(root, ...defaultProbeScaffoldDirectory(engine).split("/")),
    async load(engine) {
      const directory = join(root, ...defaultProbeScaffoldDirectory(engine).split("/"));
      return {
        kit: await import(pathToFileURL(join(directory, "conformance-kit.mts")).href),
        connection: await import(pathToFileURL(join(directory, "connection.mts")).href)
      };
    },
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}
