// invariant: the registry reader the composition root hands the Claude Code
// driver (SSI-74) asks only whether a key under SOFTWARE exists, through the
// System32 reg.exe, and leaves a key present unless the query ran and said it
// is absent. The `win32:` case reads the real registry on the Windows runner.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { win32 } from "node:path";
import { test } from "node:test";

import {
  regExecutable,
  registryKeyPresent,
  registryQueryArguments
} from "../../packages/platform-node/src/windows-registry.ts";

const HKCU = "HKCU\\SOFTWARE\\Policies\\ClaudeCode";

test("the reader asks the System32 reg.exe about one key in the 64-bit view", () => {
  assert.ok(win32.isAbsolute(regExecutable()));
  assert.ok(regExecutable().endsWith("\\System32\\reg.exe"));
  assert.deepEqual(registryQueryArguments(HKCU), ["query", HKCU, "/reg:64"]);
});

for (const key of [
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies",
  "HKU\\SOFTWARE\\Policies",
  "HKLM\\SYSTEM\\CurrentControlSet",
  "HKLM\\SOFTWARE\\Policies\\a & calc",
  'HKLM\\SOFTWARE\\Policies\\a" /f',
  "HKLM\\SOFTWARE\\",
  ""
])
  test(`the reader refuses ${JSON.stringify(key)} before running anything`, async () => {
    let ran = false;
    await assert.rejects(
      registryKeyPresent(key, async () => {
        ran = true;
        return 1;
      }),
      TypeError
    );
    assert.equal(ran, false);
  });

for (const [outcome, present] of [
  [0, true],
  [1, false],
  [2, true],
  [null, true]
])
  test(`a query that ends with ${String(outcome)} leaves the key ${present ? "present" : "absent"}`, async () => {
    const asked = [];
    const runner = async (args) => {
      asked.push(args);
      return outcome;
    };
    assert.equal(await registryKeyPresent(HKCU, runner), present);
    assert.deepEqual(asked, [["query", HKCU, "/reg:64"]]);
  });

test("a query that cannot run leaves the key present", async () => {
  assert.equal(
    await registryKeyPresent(HKCU, async () => {
      throw new Error("spawn failed");
    }),
    true
  );
});

test("win32: the real registry reports an existing key present and a missing one absent", async () => {
  const missing = `HKCU\\SOFTWARE\\Verchestra-absent-${randomBytes(8).toString("hex")}`;
  if (process.platform !== "win32") {
    // why: without reg.exe nothing can be proven absent, so both keys count as present.
    assert.equal(await registryKeyPresent("HKLM\\SOFTWARE\\Microsoft"), true);
    assert.equal(await registryKeyPresent(missing), true);
    return;
  }
  assert.equal(await registryKeyPresent("HKLM\\SOFTWARE\\Microsoft"), true);
  assert.equal(await registryKeyPresent(missing), false);
});
