import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import {
  NodeActivationHealthGate,
  NodeVerifiedLauncherHandoff
} from "../../packages/platform-node/src/activation-launcher-adapters.ts";
import {
  disposeHealthFixtures,
  dualModeLauncherSource,
  executableReleaseRoot,
  healthReport,
  reportingLauncherSource,
  stagedExecutableRelease
} from "../helpers/activation-health-fixture.mjs";

after(async () => {
  await disposeHealthFixtures();
});

const runtimePathOf = (releaseRoot, bundle) => {
  const runtime = bundle.components.find((component) => component.kind === "node-runtime");
  return join(releaseRoot, ...runtime.logicalPath.split("/"));
};

const releaseRootFor = (installRoot, bundle) =>
  join(installRoot, "releases", bundle.releaseDigest.slice("sha256:".length));

async function activatedRelease(options = {}) {
  const staged = await stagedExecutableRelease(options);
  const manager = new TransactionalActivationManager({
    installRoot: staged.installRoot,
    stagingRoot: staged.stagingRoot,
    platform: staged.bundle.target.platform,
    arch: staged.bundle.target.arch,
    healthGate: new NodeActivationHealthGate()
  });
  const receipt = await manager.activate(staged.receipt);
  return { ...staged, manager, receipt };
}

test("the observed health gate runs both canonical launchers from the staged bytes", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot();
  const evidence = await new NodeActivationHealthGate().evaluate({ releaseRoot, bundle });

  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(
    evidence.checks.map((check) => check.name),
    ["migration", "native", "driver"]
  );
  for (const check of evidence.checks) {
    assert.equal(check.status, "pass");
    assert.match(check.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.deepEqual(
    evidence.launchers.map((launcher) => launcher.componentId),
    ["launcher:vestra", "launcher:verchestra"]
  );
  for (const launcher of evidence.launchers) {
    assert.equal(launcher.exitCode, 0);
    assert.equal(launcher.semanticVersion, bundle.semanticVersion);
    assert.equal(launcher.releaseDigest, bundle.releaseDigest);
  }
  assert.equal(
    evidence.launchers[0].normalizedBehaviorDigest,
    evidence.launchers[1].normalizedBehaviorDigest,
    "equivalent launchers must normalize to one behavior digest"
  );
});

test("the behavior digest is derived from launcher output, not from the manifest", async () => {
  const baseline = await executableReleaseRoot();
  const changed = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": reportingLauncherSource(
        healthReport("launcher:vestra", { behavior: { commands: ["help"], runtimeResolver: false } })
      ),
      "launcher:verchestra": reportingLauncherSource(
        healthReport("launcher:verchestra", { behavior: { commands: ["help"], runtimeResolver: false } })
      )
    }
  });
  const gate = new NodeActivationHealthGate();
  const first = await gate.evaluate({ releaseRoot: baseline.releaseRoot, bundle: baseline.bundle });
  const second = await gate.evaluate({ releaseRoot: changed.releaseRoot, bundle: changed.bundle });

  assert.notEqual(
    first.launchers[0].normalizedBehaviorDigest,
    second.launchers[0].normalizedBehaviorDigest,
    "a launcher that reports different behavior must not produce the same digest"
  );
});

test("the same observed launcher output produces the same evidence twice", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot();
  const gate = new NodeActivationHealthGate();
  const first = await gate.evaluate({ releaseRoot, bundle });
  const second = await gate.evaluate({ releaseRoot, bundle });
  assert.deepEqual(second, first);
});

test("transactional activation accepts the observed evidence and records it with the release", async () => {
  const { bundle, installRoot, manager, receipt } = await activatedRelease({
    launchers: {
      "launcher:vestra": dualModeLauncherSource(healthReport("launcher:vestra")),
      "launcher:verchestra": dualModeLauncherSource(healthReport("launcher:verchestra"))
    }
  });

  assert.equal(receipt.operation, "activate");
  assert.equal(receipt.active.releaseDigest, bundle.releaseDigest);
  assert.equal(await manager.active().then((pointer) => pointer.releaseDigest), bundle.releaseDigest);

  const record = JSON.parse(await readFile(join(releaseRootFor(installRoot, bundle), "release.json"), "utf8"));
  assert.equal(record.health.schemaVersion, 1);
  assert.deepEqual(record.health.checks.map((check) => check.name).sort(), ["driver", "migration", "native"]);
  assert.deepEqual(record.health.launchers.map((launcher) => launcher.componentId).sort(), [
    "launcher:verchestra",
    "launcher:vestra"
  ]);
  for (const launcher of record.health.launchers) {
    assert.equal(launcher.exitCode, 0);
    assert.equal(launcher.releaseDigest, bundle.releaseDigest);
  }
});

test("the verified handoff preserves the argument vector and propagates the launcher's exact exit status", async () => {
  const { bundle, installRoot, manager } = await activatedRelease({
    launchers: {
      "launcher:vestra": dualModeLauncherSource(healthReport("launcher:vestra")),
      "launcher:verchestra": dualModeLauncherSource(healthReport("launcher:verchestra"))
    }
  });
  const resolution = await manager.resolveActiveLauncher();
  const releaseRoot = releaseRootFor(installRoot, bundle);
  const handoff = new NodeVerifiedLauncherHandoff();
  const runtimeExecutable = runtimePathOf(releaseRoot, bundle);
  const observedArgv = async () => JSON.parse(await readFile(join(releaseRoot, "bin", "observed-argv.json"), "utf8"));

  const succeeded = await handoff.execute({
    runtimeExecutable,
    launcherPath: resolution.executablePath,
    args: ["--help"]
  });
  assert.deepEqual(succeeded, { exitCode: 0, signal: null });
  assert.deepEqual(await observedArgv(), ["--help"]);

  const args = ["--exit=3", "plain", "with space", "$(id)", "a&b", "c|d", "e;f", 'quote"inside', "trailing\\"];
  const failed = await handoff.execute({ runtimeExecutable, launcherPath: resolution.executablePath, args });
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.signal, null);
  assert.deepEqual(await observedArgv(), args, "user arguments must cross the process boundary verbatim");
});
