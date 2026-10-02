// invariant: a read-only probe of the installed Codex CLI for the subscription
// identity directory (SPA-09, SPA-10). `codex login status` contacts no
// provider and invokes no model. It runs in a disposable CODEX_HOME holding
// only the pinned `config.toml`, with a disposable HOME, so no owner login is
// read. A machine without Codex reports not configured, never a pass by
// omission; the fleet must have its pinned build.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { CODEX_IDENTITY_CONFIG } from "../../../apps/vestra-cli/src/task/task-codex-identity.ts";
import { resolveCodexCommand } from "../src/codex-driver.mjs";

const execFileAsync = promisify(execFile);
const PIN_REQUIRED = process.env.VES_REQUIRE_PINNED_PROVIDERS === "1";
// why: the build on which the forced ChatGPT method was observed to turn an
// API-key login into "Not logged in" (spec.md, E4); older builds are held
// only to the line `vestra` itself requires.
const FORCED_METHOD_OBSERVED = [0, 157, 1];
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function absolute(command) {
  if (isAbsolute(command)) return command;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, command);
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false
      )
    )
      return candidate;
  }
  return undefined;
}

async function installedCodex() {
  const [command, ...prefix] = resolveCodexCommand();
  const executable = await absolute(command);
  if (executable === undefined) return undefined;
  // why: an executable that cannot answer `--version` is not an installed
  // Codex, the same judgment the driver's own probe makes.
  const stdout = await execFileAsync(executable, [...prefix, "--version"], { encoding: "utf8", timeout: 20_000 }).then(
    (result) => result.stdout,
    () => ""
  );
  const version = /(\d+)\.(\d+)\.(\d+)/u.exec(stdout)?.slice(1).map(Number);
  return version === undefined ? undefined : { executable, prefix, version };
}

async function loginStatus(codex, files) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-codex-identity-probe-"));
  roots.push(root);
  const home = join(root, "home");
  const identity = join(root, "codex-identity");
  await mkdir(home);
  await mkdir(identity, { mode: 0o700 });
  for (const [name, content] of Object.entries(files)) await writeFile(join(identity, name), content, { mode: 0o600 });
  const environment = { HOME: home, USERPROFILE: home, CODEX_HOME: identity };
  for (const key of ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP"])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  const result = await execFileAsync(codex.executable, [...codex.prefix, "login", "status"], {
    cwd: home,
    env: environment,
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" })
  );
  return { ...result, home, lines: result.stderr.split(/\r?\n/u).filter((line) => line.trim().length > 0) };
}

function atLeast(actual, minimum) {
  for (let index = 0; index < 3; index += 1) if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  return true;
}

test("the installed Codex loads the pinned identity configuration and reports an empty identity as not logged in", async (t) => {
  const codex = await installedCodex();
  if (codex === undefined) {
    assert.equal(PIN_REQUIRED, false, "the fleet must install its pinned Codex");
    return t.diagnostic("Codex is not configured on this machine");
  }
  const status = await loginStatus(codex, { "config.toml": CODEX_IDENTITY_CONFIG });
  assert.equal(status.code, 1);
  assert.ok(status.lines.includes("Not logged in"), status.lines.join(" | "));
  assert.equal(
    status.lines.some((line) => line.startsWith("Error")),
    false,
    "the pinned config.toml is accepted, not a configuration error"
  );
  assert.deepEqual(await readdir(status.home), [], "the status check wrote nothing to HOME");
});

test("an API-key login in a pinned identity directory does not count as a login", async (t) => {
  const codex = await installedCodex();
  if (codex === undefined) {
    assert.equal(PIN_REQUIRED, false, "the fleet must install its pinned Codex");
    return t.diagnostic("Codex is not configured on this machine");
  }
  // why: a synthetic file in the shape `codex login --with-api-key` writes;
  // the key is a fixture and no request is made with it.
  const apiKey = JSON.stringify({ OPENAI_API_KEY: "sk-fixture-not-a-real-key-000000000000", tokens: null, last_refresh: null });
  const pinned = await loginStatus(codex, { "config.toml": CODEX_IDENTITY_CONFIG, "auth.json": apiKey });
  // invariant: whatever the build prints, `vestra` accepts only this line.
  assert.equal(pinned.lines.includes("Logged in using ChatGPT"), false);
  if (!atLeast(codex.version, FORCED_METHOD_OBSERVED))
    return t.diagnostic(`forced-method refusal was observed on ${FORCED_METHOD_OBSERVED.join(".")}; this build is older`);
  assert.equal(pinned.code, 1);
  assert.ok(pinned.lines.includes("Not logged in"), pinned.lines.join(" | "));
  const unpinned = await loginStatus(codex, { "config.toml": 'cli_auth_credentials_store = "file"\n', "auth.json": apiKey });
  assert.equal(unpinned.code, 0);
  assert.ok(unpinned.lines.some((line) => line.startsWith("Logged in using an API key - ")));
});

test("the probe's version comparison is numeric in every component", () => {
  assert.equal(atLeast([0, 157, 1], [0, 157, 1]), true);
  assert.equal(atLeast([0, 200, 0], [0, 157, 1]), true);
  assert.equal(atLeast([1, 0, 0], [0, 157, 1]), true);
  assert.equal(atLeast([0, 115, 0], [0, 157, 1]), false);
  assert.equal(atLeast([0, 157, 0], [0, 157, 1]), false);
});
