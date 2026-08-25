import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { test } from "node:test";

import {
  ACTIVATION_HEALTH_ARGUMENT,
  NodeActivationHealthGate,
  NodeVerifiedLauncherHandoff,
  supportedLauncherHost
} from "../../packages/platform-node/src/activation-launcher-adapters.ts";
import {
  ACTIVATION_LAUNCHER_ERROR_CODES,
  activationLauncherPublicErrorRegistry
} from "../../packages/platform-node/src/activation-launcher-errors.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const QUALIFIED_TARGETS = Object.freeze([
  ["win32", "x64"],
  ["win32", "arm64"],
  ["linux", "x64"],
  ["linux", "arm64"],
  ["darwin", "x64"],
  ["darwin", "arm64"]
]);

test("the supported-host contract accepts exactly the qualified platform and architecture pairs", () => {
  for (const [platform, arch] of QUALIFIED_TARGETS) {
    assert.deepEqual(supportedLauncherHost({ platform, arch }), { platform, arch });
  }
});

test("an unsupported host is refused deterministically before any process or filesystem effect", () => {
  for (const candidate of [
    { platform: "aix", arch: "x64" },
    { platform: "linux", arch: "ia32" },
    { platform: "win32", arch: "" },
    { platform: "", arch: "" },
    { platform: "Win32", arch: "x64" }
  ]) {
    assert.throws(
      () => supportedLauncherHost(candidate),
      (error) => {
        assert.equal(error.name, "ActivationLauncherError");
        assert.equal(error.code, "VES_LAUNCHER_HOST_UNSUPPORTED");
        return true;
      },
      `${candidate.platform}-${candidate.arch} must be refused`
    );
  }
});

test("the unsupported-host message names only the declared target, never a machine-local path", () => {
  try {
    supportedLauncherHost({ platform: "aix", arch: "ppc64" });
    assert.fail("an unsupported host must throw");
  } catch (error) {
    assert.match(error.message, /aix-ppc64/u);
    assert.equal(isAbsolute(error.message), false);
    assert.doesNotMatch(error.message, /[A-Za-z]:[\\/]|\/(?:home|Users|root|tmp)\//u);
  }
});

test("the health protocol is one fixed argument", () => {
  assert.equal(ACTIVATION_HEALTH_ARGUMENT, "--activation-health");
});

test("process budgets must be positive whole numbers", () => {
  for (const options of [
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { outputLimitBytes: 0 },
    { outputLimitBytes: -8 },
    { outputLimitBytes: Number.NaN }
  ]) {
    assert.throws(() => new NodeActivationHealthGate(options), { code: "VES_LAUNCHER_ARGUMENT_INVALID" });
  }
  assert.doesNotThrow(() => new NodeActivationHealthGate({ timeoutMs: 1, outputLimitBytes: 1 }));
  assert.doesNotThrow(() => new NodeActivationHealthGate());
});

test("the handoff refuses a relative executable, a relative launcher, and an unclean argument vector", async () => {
  const handoff = new NodeVerifiedLauncherHandoff();
  const absolute = process.execPath;
  await assert.rejects(handoff.execute({ runtimeExecutable: "node", launcherPath: absolute, args: [] }), {
    code: "VES_LAUNCHER_PATH_INVALID"
  });
  await assert.rejects(handoff.execute({ runtimeExecutable: absolute, launcherPath: "bin/vestra.mjs", args: [] }), {
    code: "VES_LAUNCHER_PATH_INVALID"
  });
  await assert.rejects(
    handoff.execute({ runtimeExecutable: absolute, launcherPath: absolute, args: ["ok", "bad\0value"] }),
    { code: "VES_LAUNCHER_ARGUMENT_INVALID" }
  );
  await assert.rejects(handoff.execute({ runtimeExecutable: absolute, launcherPath: absolute, args: [1] }), {
    code: "VES_LAUNCHER_ARGUMENT_INVALID"
  });
});

test("the activation launcher public error contract is closed and schema-valid", async () => {
  assert.deepEqual(activationLauncherPublicErrorRegistry.codes, [...ACTIVATION_LAUNCHER_ERROR_CODES]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of activationLauncherPublicErrorRegistry.codes) {
    const envelope = schemas.validate("public-error", "1", activationLauncherPublicErrorRegistry.create(code, {}));
    assert.equal(envelope.code, code);
    assert.equal(envelope.component, "activation-launcher");
  }
});
