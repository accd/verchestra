import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { NodeActivationHealthGate } from "../../packages/platform-node/src/activation-launcher-adapters.ts";
import {
  disposeHealthFixtures,
  executableReleaseRoot,
  healthReport,
  reportingLauncherSource
} from "../helpers/activation-health-fixture.mjs";

after(async () => {
  await disposeHealthFixtures();
});

const bothLaunchers = (source) => ({ "launcher:vestra": source, "launcher:verchestra": source });

const runtimePathOf = (releaseRoot, bundle) =>
  join(releaseRoot, ...bundle.components.find((component) => component.kind === "node-runtime").logicalPath.split("/"));

async function rejectsWith(options, code, gateOptions = {}) {
  const { bundle, releaseRoot } = await executableReleaseRoot(options);
  await assert.rejects(new NodeActivationHealthGate(gateOptions).evaluate({ releaseRoot, bundle }), (error) => {
    assert.equal(error.name, "ActivationLauncherError");
    assert.equal(error.code, code);
    return true;
  });
  return { bundle, releaseRoot };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function readPid(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((settle) => setTimeout(settle, 20));
  }
  throw new Error("the hanging launcher never reported its descendant PID");
}

test("a launcher that exits non-zero never becomes passing health evidence", async () => {
  await rejectsWith(
    { launchers: bothLaunchers('process.stdout.write("{}");\nprocess.exit(9);\n') },
    "VES_LAUNCHER_EXIT_NONZERO"
  );
});

test("a launcher that terminates abnormally never becomes passing health evidence", async () => {
  // POSIX reports the terminating signal on the close event. Windows has no
  // signal delivery: TerminateProcess surfaces as exit status 1 with a null
  // signal, so the same fault is refused through the non-zero exit path.
  const expected = process.platform === "win32" ? "VES_LAUNCHER_EXIT_NONZERO" : "VES_LAUNCHER_SIGNAL_TERMINATED";
  await rejectsWith({ launchers: bothLaunchers('process.kill(process.pid, "SIGKILL");\n') }, expected);
});

test("a launcher that never returns is stopped at the health budget", async () => {
  await rejectsWith({ launchers: bothLaunchers("setInterval(() => {}, 1000);\n") }, "VES_LAUNCHER_TIMEOUT", {
    timeoutMs: 500
  });
});

test("a timed-out launcher leaves no descendant process behind", async (t) => {
  const hanging = [
    `import { spawn } from "node:child_process";`,
    `import { writeFileSync } from "node:fs";`,
    `import { dirname, join } from "node:path";`,
    `import { fileURLToPath } from "node:url";`,
    `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });`,
    `writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "descendant.pid"), String(child.pid));`,
    `setInterval(() => {}, 1000);`,
    ""
  ].join("\n");
  const { bundle, releaseRoot } = await executableReleaseRoot({ launchers: bothLaunchers(hanging) });
  let descendantPid;
  t.after(() => {
    if (descendantPid === undefined) return;
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });

  const evaluation = new NodeActivationHealthGate({ timeoutMs: 2_000 }).evaluate({ releaseRoot, bundle });
  descendantPid = await readPid(join(releaseRoot, "bin", "descendant.pid"));
  await assert.rejects(evaluation, { code: "VES_LAUNCHER_TIMEOUT" });

  assert.equal(isAlive(descendantPid), false, "the launcher's descendant must not outlive the health gate");
});

test("a launcher that floods its output is stopped at the output bound", async () => {
  await rejectsWith(
    { launchers: bothLaunchers('for (let index = 0; index < 200; index += 1) console.log("x".repeat(4096));\n') },
    "VES_LAUNCHER_OUTPUT_EXCEEDED",
    { outputLimitBytes: 1_024 }
  );
});

test("a launcher whose report is unreadable or incomplete never becomes evidence", async () => {
  const cases = [
    ["", 'process.stdout.write("");\n'],
    ["not JSON", 'process.stdout.write("activation health: fine\\n");\n'],
    ["truncated", 'process.stdout.write("{\\"schemaVersion\\": 1");\n'],
    ["array", 'process.stdout.write("[]");\n'],
    [
      "unknown field",
      `process.stdout.write(JSON.stringify({ ...${JSON.stringify(healthReport("launcher:vestra"))}, extra: 1 }));\n`
    ],
    [
      "wrong schema version",
      `process.stdout.write(JSON.stringify(${JSON.stringify(healthReport("launcher:vestra", { schemaVersion: 2 }))}));\n`
    ],
    [
      "missing a check",
      `process.stdout.write(JSON.stringify(${JSON.stringify(
        healthReport("launcher:vestra", {
          checks: [
            { name: "migration", status: "pass", observation: {} },
            { name: "native", status: "pass", observation: {} }
          ]
        })
      )}));\n`
    ],
    [
      "duplicated check",
      `process.stdout.write(JSON.stringify(${JSON.stringify(
        healthReport("launcher:vestra", {
          checks: [
            { name: "migration", status: "pass", observation: {} },
            { name: "migration", status: "pass", observation: {} },
            { name: "native", status: "pass", observation: {} }
          ]
        })
      )}));\n`
    ],
    [
      "no behavior projection",
      `process.stdout.write(JSON.stringify(${JSON.stringify(
        healthReport("launcher:vestra", { behavior: "fine" })
      )}));\n`
    ]
  ];
  for (const [label, source] of cases) {
    const { bundle, releaseRoot } = await executableReleaseRoot({ launchers: bothLaunchers(source) });
    await assert.rejects(
      new NodeActivationHealthGate().evaluate({ releaseRoot, bundle }),
      (error) => {
        assert.equal(error.code, "VES_LAUNCHER_HEALTH_REPORT_INVALID", label);
        return true;
      },
      label
    );
  }
});

test("a release whose hermetic runtime cannot start fails closed instead of falling back", async () => {
  const { bundle, releaseRoot } = await executableReleaseRoot({
    launchers: bothLaunchers(reportingLauncherSource(healthReport("launcher:vestra")))
  });
  await rm(runtimePathOf(releaseRoot, bundle), { force: true });

  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle }), {
    code: "VES_LAUNCHER_PROCESS_FAILED"
  });
});
