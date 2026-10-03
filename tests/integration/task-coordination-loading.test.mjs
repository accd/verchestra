// invariant: D5, SSI-13, SSI-14. The Strands SDK is loaded only for a graph or
// swarm run: `vestra --version` and an agent run's engine load neither the SDK
// nor Zod nor the MCP SDK; a graph run's engine loads them through the one
// dynamic import of the composition. Each case runs in a fresh child process
// with a preloaded recorder of the modules it loads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RECORDER = pathToFileURL(fileURLToPath(new URL("../helpers/module-load-recorder.mjs", import.meta.url))).href;
const COMPOSITION = pathToFileURL(join(ROOT, "apps/vestra-cli/src/task/task-coordination.ts")).href;
const scratch = await mkdtemp(join(tmpdir(), "verchestra-load-record-"));
after(() => rm(scratch, { recursive: true, force: true }));

let sequence = 0;
async function loads(args) {
  sequence += 1;
  const record = join(scratch, `record-${sequence}.json`);
  const child = spawnSync(process.execPath, ["--import", RECORDER, ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", VERCHESTRA_LOAD_RECORD: record },
    encoding: "utf8",
    timeout: 120_000
  });
  assert.equal(child.status, 0, child.stderr);
  return { modules: JSON.parse(await readFile(record, "utf8")), stdout: child.stdout };
}

const engine = (mode) => [
  "--input-type=module",
  "-e",
  `const { coordinationEngine } = await import(${JSON.stringify(COMPOSITION)}); const engine = await coordinationEngine(${JSON.stringify(mode)}); console.log(engine.constructor.name);`
];

test("vestra --version loads no SDK, Zod, or MCP SDK module", async () => {
  const { modules, stdout } = await loads([join(ROOT, "apps/vestra-cli/bin/vestra.mjs"), "--version"]);
  assert.match(stdout, /\d+\.\d+\.\d+/u);
  assert.deepEqual(modules, []);
});

test("an agent run's engine is the native one and loads none of them", async () => {
  const { modules, stdout } = await loads(engine("agent"));
  assert.equal(stdout.trim(), "NativeAgentEngine");
  assert.deepEqual(modules, []);
});

test("a graph or swarm run's engine is the Strands one, loaded with the SDK and its peers", async () => {
  for (const mode of ["graph", "swarm"]) {
    const { modules, stdout } = await loads(engine(mode));
    assert.equal(stdout.trim(), "StrandsCoordinationEngine", mode);
    assert.deepEqual(modules, ["@modelcontextprotocol", "@strands-agents", "zod"], mode);
  }
});
