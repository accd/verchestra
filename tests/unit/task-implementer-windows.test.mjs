// invariant: what the task composition hands a provider on Windows and what it
// hands elsewhere (SSI-71, SSI-73). Elsewhere every choice stays as it was;
// on Windows a provider child gets the variables it cannot start without, the
// relay gets SystemRoot, the driver gets the owner-only ACL proof, and only a
// native executable is ever taken from PATH.
import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import {
  findExecutable,
  isolationProof,
  passThroughEnvironment,
  provenOwnerOnly,
  relayEnvironment
} from "../../apps/vestra-cli/src/task/task-implementer.ts";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const AMBIENT = Object.freeze({
  PATH: "C:\\bin",
  SystemRoot: "C:\\Windows",
  TEMP: "C:\\Users\\owner\\AppData\\Local\\Temp",
  TMP: "C:\\Users\\owner\\AppData\\Local\\Temp",
  TZ: "UTC",
  TMPDIR: "/tmp/owner",
  LANG: "en_US.UTF-8",
  LC_ALL: "C",
  LC_CTYPE: "C",
  USERPROFILE: "C:\\Users\\owner",
  APPDATA: "C:\\Users\\owner\\AppData\\Roaming",
  ANTHROPIC_API_KEY: "ambient-anthropic-key",
  CLAUDE_CODE_OAUTH_TOKEN: "ambient-subscription-token",
  OPENAI_API_KEY: "ambient-openai-key"
});
const BRIDGE = Object.freeze({
  VERCHESTRA_BRIDGE_SOCKET: "\\\\.\\pipe\\verchestra-0",
  VERCHESTRA_BRIDGE_TOKEN: "f".repeat(64)
});

test("a Windows provider child gets PATH, SystemRoot, TEMP, TMP, and TZ, and nothing else", () => {
  assert.deepEqual(passThroughEnvironment(AMBIENT, "win32"), {
    PATH: "C:\\bin",
    SystemRoot: "C:\\Windows",
    TEMP: AMBIENT.TEMP,
    TMP: AMBIENT.TMP,
    TZ: "UTC"
  });
  assert.deepEqual(passThroughEnvironment({ SystemRoot: "C:\\Windows\nPATH=x", TEMP: "C:\\t\r" }, "win32"), {});
});

test("elsewhere a provider child keeps the locale and search variables it had", () => {
  for (const platform of ["darwin", "linux"])
    assert.deepEqual(
      passThroughEnvironment(AMBIENT, platform),
      { PATH: "C:\\bin", LANG: "en_US.UTF-8", LC_ALL: "C", LC_CTYPE: "C", TZ: "UTC", TMPDIR: "/tmp/owner" },
      platform
    );
});

test("on Windows the relay carries SystemRoot beside the bridge variables, and elsewhere only those", () => {
  assert.deepEqual(relayEnvironment(BRIDGE, AMBIENT, "win32"), { ...BRIDGE, SYSTEMROOT: "C:\\Windows" });
  assert.deepEqual(
    Object.keys(relayEnvironment(BRIDGE, AMBIENT, "win32")).filter((key) => !/^[A-Z][A-Z0-9_]*$/u.test(key)),
    []
  );
  assert.deepEqual(relayEnvironment(BRIDGE, { SystemRoot: "C:\\Windows\r\n" }, "win32"), BRIDGE);
  assert.deepEqual(relayEnvironment(BRIDGE, {}, "win32"), BRIDGE);
  for (const platform of ["darwin", "linux"]) assert.deepEqual(relayEnvironment(BRIDGE, AMBIENT, platform), BRIDGE);
});

test("only Windows hands the driver the owner-only ACL proof", () => {
  assert.deepEqual(isolationProof("win32"), { ownerOnlyProof: provenOwnerOnly });
  for (const platform of ["darwin", "linux", "freebsd"]) assert.deepEqual(isolationProof(platform), {}, platform);
});

async function providers(t, names) {
  const directory = await temporaryDirectory(t, "verchestra-task-executables-");
  for (const name of names) {
    await writeFile(join(directory, name), "DETERMINISTIC FAKE - not a provider CLI\n");
    await chmod(join(directory, name), 0o700);
  }
  return directory;
}

function missing(name) {
  return (error) => {
    assert.equal(error.code, "VES_TASK_NOT_CONFIGURED");
    assert.deepEqual(error.envelope.safeDetails, { requirement: `executable:${name}` });
    return true;
  };
}

test("on Windows only a native executable is taken from PATH, never a shim", async (t) => {
  const directory = await providers(t, ["claude", "claude.exe", "codex", "codex.cmd", "codex.ps1"]);
  const env = { PATH: ["relative", directory].join(delimiter) };
  assert.equal(await findExecutable("claude", env, "win32"), join(directory, "claude.exe"));
  await assert.rejects(findExecutable("codex", env, "win32"), missing("codex"));
});

test("elsewhere the executable keeps its bare name", async (t) => {
  const directory = await providers(t, ["claude", "claude.exe", "codex.exe"]);
  const env = { PATH: directory };
  for (const platform of ["darwin", "linux"]) {
    assert.equal(await findExecutable("claude", env, platform), join(directory, "claude"), platform);
    await assert.rejects(findExecutable("codex", env, platform), missing("codex"), platform);
  }
});
