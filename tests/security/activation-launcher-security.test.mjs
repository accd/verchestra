import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { NodeActivationHealthGate, NodeVerifiedLauncherHandoff } from "../../packages/platform-node/src/index.ts";
import {
  disposeHealthFixtures,
  dualModeLauncherSource,
  executableReleaseRoot,
  healthReport,
  reportingLauncherSource
} from "../helpers/activation-health-fixture.mjs";

after(async () => {
  await disposeHealthFixtures();
});

const adapterSource = await readFile(
  new URL("../../packages/platform-node/src/activation-launcher-adapters.ts", import.meta.url),
  "utf8"
);

const runtimePathOf = (releaseRoot, bundle) =>
  join(releaseRoot, ...bundle.components.find((component) => component.kind === "node-runtime").logicalPath.split("/"));

const launcherPair = (overrides, options) => ({
  "launcher:vestra": reportingLauncherSource(healthReport("launcher:vestra", overrides), options),
  "launcher:verchestra": reportingLauncherSource(healthReport("launcher:verchestra", overrides), options)
});

test("the launcher adapters never open a shell and never build a command string", () => {
  const contains = (pattern) => pattern.test(adapterSource);
  assert.equal(contains(/shell\s*:\s*true/u), false, "no adapter may spawn through a shell");
  assert.equal(contains(/shell:\s*false/u), true, "every spawn must declare shell: false");
  assert.equal(contains(/\bexecSync\b|\bspawnSync\b|[^F]\bexec\s*\(/u), false, "no adapter may run a command string");
  // execFile is allowed only for the Windows process-tree termination call,
  // which takes a fixed executable and a fixed argument array.
  assert.equal([...adapterSource.matchAll(/execFileAsync\(/gu)].length, 1);
  assert.equal(contains(/execFileAsync\(\s*"taskkill",\s*\["\/pid", String\(pid\), "\/T", "\/F"\]/u), true);
  // Every process argument list in this module is an array literal, never a
  // string built by concatenation or interpolation.
  assert.equal(contains(/spawn\([^)]*\+/u), false);
});

test("the observed behavior digest is computed over exactly what the launcher printed", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot({ launchers: launcherPair({}, { includeArgv: true }) });
  const evidence = await new NodeActivationHealthGate().evaluate({ releaseRoot, bundle });
  const expected = {
    commands: ["help", "version", "portability"],
    runtimeResolver: false,
    observedRuntime: process.version,
    observedArgv: ["--activation-health"]
  };
  const digest = `sha256:${createHash("sha256").update(canonicalizeJsonV2(expected)).digest("hex")}`;

  assert.equal(evidence.launchers[0].normalizedBehaviorDigest, digest);
  assert.equal(evidence.launchers[1].normalizedBehaviorDigest, digest);
});

test("a launcher component path that escapes the release root is refused before any process starts", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot();
  const tampered = {
    ...bundle,
    components: bundle.components.map((component) =>
      component.componentId === "launcher:vestra" ? { ...component, logicalPath: "../outside/vestra.mjs" } : component
    )
  };
  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle: tampered }), {
    code: "VES_LAUNCHER_PATH_INVALID"
  });
});

test("a runtime component path that escapes the release root is refused", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot();
  const tampered = {
    ...bundle,
    components: bundle.components.map((component) =>
      component.kind === "node-runtime" ? { ...component, logicalPath: "../../node" } : component
    )
  };
  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle: tampered }), {
    code: "VES_LAUNCHER_PATH_INVALID"
  });
});

test("a release without a unique runtime or both canonical launchers is refused", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot();
  const gate = new NodeActivationHealthGate();
  const without = (predicate) => ({ ...bundle, components: bundle.components.filter((entry) => !predicate(entry)) });

  await assert.rejects(gate.evaluate({ releaseRoot, bundle: without((entry) => entry.kind === "node-runtime") }), {
    code: "VES_LAUNCHER_RELEASE_INVALID"
  });
  await assert.rejects(
    gate.evaluate({ releaseRoot, bundle: without((entry) => entry.componentId === "launcher:verchestra") }),
    { code: "VES_LAUNCHER_RELEASE_INVALID" }
  );
  const runtime = bundle.components.find((entry) => entry.kind === "node-runtime");
  await assert.rejects(
    gate.evaluate({
      releaseRoot,
      bundle: { ...bundle, components: [...bundle.components, { ...runtime, componentId: "runtime:node-shadow" }] }
    }),
    { code: "VES_LAUNCHER_RELEASE_INVALID" }
  );
  await assert.rejects(gate.evaluate({ releaseRoot, bundle: { ...bundle, components: "all" } }), {
    code: "VES_LAUNCHER_RELEASE_INVALID"
  });
});

test("a launcher that reports another identity or another release version is refused", async () => {
  const impostor = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": reportingLauncherSource(healthReport("launcher:verchestra")),
      "launcher:verchestra": reportingLauncherSource(healthReport("launcher:verchestra"))
    }
  });
  await assert.rejects(
    new NodeActivationHealthGate().evaluate({ releaseRoot: impostor.releaseRoot, bundle: impostor.bundle }),
    { code: "VES_LAUNCHER_HEALTH_RELEASE_MISMATCH" }
  );

  const drifted = await executableReleaseRoot({
    launchers: launcherPair({ semanticVersion: "9.9.9" })
  });
  await assert.rejects(
    new NodeActivationHealthGate().evaluate({ releaseRoot: drifted.releaseRoot, bundle: drifted.bundle }),
    { code: "VES_LAUNCHER_HEALTH_RELEASE_MISMATCH" }
  );
});

test("canonical launchers that observe different behavior or different checks are refused", async () => {
  const behavior = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": reportingLauncherSource(healthReport("launcher:vestra")),
      "launcher:verchestra": reportingLauncherSource(
        healthReport("launcher:verchestra", { behavior: { commands: ["help"], runtimeResolver: false } })
      )
    }
  });
  await assert.rejects(
    new NodeActivationHealthGate().evaluate({ releaseRoot: behavior.releaseRoot, bundle: behavior.bundle }),
    { code: "VES_LAUNCHER_HEALTH_DIVERGED" }
  );

  const checks = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": reportingLauncherSource(healthReport("launcher:vestra")),
      "launcher:verchestra": reportingLauncherSource(
        healthReport("launcher:verchestra", {
          checks: ["migration", "native", "driver"].map((name) => ({
            name,
            status: "pass",
            observation: { check: name, applied: false }
          }))
        })
      )
    }
  });
  await assert.rejects(
    new NodeActivationHealthGate().evaluate({ releaseRoot: checks.releaseRoot, bundle: checks.bundle }),
    { code: "VES_LAUNCHER_HEALTH_DIVERGED" }
  );
});

test("a health check that did not pass never becomes passing evidence", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot({
    launchers: launcherPair({
      checks: [
        { name: "migration", status: "pass", observation: { check: "migration" } },
        { name: "native", status: "fail", observation: { check: "native" } },
        { name: "driver", status: "pass", observation: { check: "driver" } }
      ]
    })
  });
  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle }), {
    code: "VES_LAUNCHER_HEALTH_CHECK_FAILED"
  });
});

test("shell metacharacters in user arguments reach the launcher as data and expand nothing", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": dualModeLauncherSource(healthReport("launcher:vestra")),
      "launcher:verchestra": dualModeLauncherSource(healthReport("launcher:verchestra"))
    }
  });
  const args = [
    "& echo owned > owned.txt",
    "; touch owned.txt",
    "$(printf owned)",
    "`printf owned`",
    "| tee owned.txt",
    "%PATH%",
    "$HOME",
    "\n echo owned"
  ];

  const result = await new NodeVerifiedLauncherHandoff().execute({
    runtimeExecutable: runtimePathOf(releaseRoot, bundle),
    launcherPath: join(releaseRoot, "bin", "vestra.mjs"),
    args
  });

  assert.deepEqual(result, { exitCode: 0, signal: null });
  assert.deepEqual(JSON.parse(await readFile(join(releaseRoot, "bin", "observed-argv.json"), "utf8")), args);
  assert.equal((await readdir(join(releaseRoot, "bin"))).includes("owned.txt"), false);
  assert.equal((await readdir(releaseRoot)).includes("owned.txt"), false);
});

test("every observed launcher failure renders a public code without a machine-local path", async () => {
  const impostor = await executableReleaseRoot({
    launchers: {
      "launcher:vestra": reportingLauncherSource(healthReport("launcher:verchestra")),
      "launcher:verchestra": reportingLauncherSource(healthReport("launcher:verchestra"))
    }
  });
  const broken = await executableReleaseRoot({
    launchers: { "launcher:vestra": "process.exit(9);\n", "launcher:verchestra": "process.exit(9);\n" }
  });
  const gate = new NodeActivationHealthGate();
  const failures = [];
  for (const fixture of [impostor, broken]) {
    await gate
      .evaluate({ releaseRoot: fixture.releaseRoot, bundle: fixture.bundle })
      .then(() => assert.fail("the gate must refuse this release"))
      .catch((error) => failures.push(error));
  }

  assert.equal(failures.length, 2);
  for (const failure of failures) {
    assert.equal(failure.name, "ActivationLauncherError");
    assert.match(failure.code, /^VES_LAUNCHER_[A-Z_]+$/u);
    assert.doesNotMatch(failure.message, /[A-Za-z]:[\\/]|\/(?:home|Users|root|tmp|var)\//u);
    assert.equal(failure.message.includes(process.env["USERPROFILE"] ?? " absent"), false);
    assert.equal(failure.message.includes(process.env["HOME"] ?? " absent"), false);
  }
});
