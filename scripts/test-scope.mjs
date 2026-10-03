import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// A scope with zero tests fails closed: a green stage that executed nothing is
// indistinguishable from evidence. Every required scope now carries tests — T73
// filled the last declared-empty exception (release) — so there is none left.
const scope = process.argv[2];
const roots = process.argv.slice(3);
const tests = [];
async function collect(path) {
  if (!existsSync(path)) return;
  if (!(await stat(path)).isDirectory()) {
    if (/\.test\.mjs$/.test(path)) tests.push(path);
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) await collect(join(path, entry.name));
}
for (const root of roots) await collect(root);
if (tests.length === 0) {
  process.stderr.write(`${scope}: 0 tests found under ${roots.join(", ")} — an empty required scope cannot pass\n`);
  process.exit(1);
}

// invariant: the scope runs under a private temporary directory and fails when
// anything is left in it, so a test that leaks a directory fails the run that
// introduced it instead of filling the disk. The private directory is removed
// either way, so the guard itself leaves nothing behind.
// why: tools a test spawns (tsc, npm, corepack) enable Node's compile cache,
// whose default home is one fixed, reused `node-compile-cache` directory under
// the temporary directory. It is a cache shared with every Node tool on the
// machine, not a per-run artifact, so it is the one entry a test need not own.
const SHARED_CACHE = "node-compile-cache";
const temporary = await mkdtemp(join(tmpdir(), "vts-"));
const result = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
  env: { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary }
});
const leftovers = (await readdir(temporary))
  .filter((entry) => entry !== SHARED_CACHE)
  .sort((left, right) => Number(left > right) - Number(left < right));
const removal = await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
  (error) => error
);
if (leftovers.length > 0)
  process.stderr.write(
    `${scope}: tests left ${leftovers.length} entries in their temporary directory; every test must remove what it creates:\n${leftovers.map((entry) => `  ${entry}\n`).join("")}`
  );
if (removal !== undefined) process.stderr.write(`${scope}: could not remove ${temporary}: ${removal.code}\n`);
process.exit(leftovers.length > 0 || removal !== undefined ? 1 : (result.status ?? 1));
