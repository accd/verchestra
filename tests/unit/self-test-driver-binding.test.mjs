import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { deriveDriverBinding, resolveDriverBinding } from "../../apps/vestra-cli/src/self-test-full-scenario.ts";

// #35 / AD-011. The full profile's verification report used to bind two invented
// string constants, so `assertIndependentVerifier` passed on spelling rather
// than on two drivers existing. The binding is now derived from probe facts, and
// these are its refusal paths — pure, so they are provable without spawning
// anything.

test("the binding names the resolved implementer and a distinct verifier", () => {
  assert.deepEqual(
    deriveDriverBinding([
      { driverId: "claude-code", available: true },
      { driverId: "codex", available: true }
    ]),
    { implementerDriverId: "claude-code", verifierDriverId: "codex" }
  );
});

test("an unavailable driver is never attributed to", () => {
  // A missing provider is `not configured`, never a silently invented identity.
  assert.throws(
    () =>
      deriveDriverBinding([
        { driverId: "claude-code", available: false },
        { driverId: "codex", available: false }
      ]),
    /no available driver/u
  );
});

test("an unavailable driver cannot be chosen as the implementer over an available one", () => {
  assert.deepEqual(
    deriveDriverBinding([
      { driverId: "claude-code", available: false },
      { driverId: "codex", available: true },
      { driverId: "opencode", available: true }
    ]),
    { implementerDriverId: "codex", verifierDriverId: "opencode" }
  );
});

test("a single available driver cannot verify its own work", () => {
  // The whole point of #35: declared independence is not structural
  // independence. One driver reporting twice is still one driver.
  assert.throws(
    () =>
      deriveDriverBinding([
        { driverId: "claude-code", available: true },
        { driverId: "codex", available: false }
      ]),
    /no second driver/u
  );
  assert.throws(
    () =>
      deriveDriverBinding([
        { driverId: "claude-code", available: true },
        { driverId: "claude-code", available: true }
      ]),
    /no second driver/u
  );
});

test("no binding is produced from an empty fleet", () => {
  assert.throws(() => deriveDriverBinding([]), /no available driver/u);
});

test("the composition root refuses a driver that is not actually there", async () => {
  // The seam that makes the wiring provable: with the logic correct but the
  // composition root ignoring `probe.available`, an absent provider would be
  // attributed to anyway. Pointing a driver at nothing must fail closed.
  const absent = [process.execPath, join(tmpdir(), "verchestra-absent-driver-does-not-exist.mjs"), "claude"];
  await assert.rejects(
    resolveDriverBinding({ claude: absent, codex: absent }),
    /no available driver|no second driver/u
  );
});

test("one absent driver leaves no independent verifier", async () => {
  const absent = [process.execPath, join(tmpdir(), "verchestra-absent-driver-does-not-exist.mjs"), "codex"];
  const real = [
    process.execPath,
    fileURLToPath(new URL("../../apps/vestra-cli/src/self-test-driver-fake.mjs", import.meta.url)),
    "claude"
  ];
  await assert.rejects(resolveDriverBinding({ claude: real, codex: absent }), /no second driver/u);
});
