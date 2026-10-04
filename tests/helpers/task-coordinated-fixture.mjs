// DETERMINISTIC FIXTURE support for the coordinated-run journeys (Task Request
// v2) through the real `vestra` binary: one execution per mode over the labelled
// fake `claude` and `codex` executables (tests/helpers/task-cli-fakes), and the
// readers of what a run leaves behind (fake logs, the sealed node ledger). The
// journeys run on macOS, Linux, and Windows, each with its own credential
// store answered from the fixture's store (tests/helpers/task-cli-fixture.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { confirmExtraUsage } from "./task-billing-fixture.mjs";
import { approveArguments, taskFixture, taskRequest } from "./task-cli-fixture.mjs";

export const TIMEOUT = { timeout: 300_000 };
export const CLAUDE = Object.freeze({ driverId: "claude-code", model: "claude-sonnet-5" });
export const CODEX = Object.freeze({ driverId: "codex", model: "gpt-5.2-codex" });

export function node(nodeId, driver, writeScope, inputs, instructions) {
  return {
    nodeId,
    driver: { ...driver },
    description: `The ${nodeId} step of the value change`,
    instructions,
    readScope: ["src"],
    writeScope,
    inputs
  };
}

export const EXECUTIONS = Object.freeze({
  agent: { mode: "agent", nodes: [node("build", CLAUDE, ["src/value.txt"], [], "Set the value.")] },
  graph: {
    mode: "graph",
    nodes: [
      node("plan", CODEX, [], [], "Read the scope and plan the change."),
      node("build", CLAUDE, ["src/value.txt"], ["plan"], "Set the value as planned."),
      node("review", CODEX, [], ["plan", "build"], "Review the change.")
    ],
    edges: [
      { from: "plan", to: "build" },
      { from: "build", to: "review" }
    ]
  },
  swarm: {
    mode: "swarm",
    nodes: [
      node("writer", CLAUDE, ["src/value.txt"], [], "Set the value, then hand it on. next:reviewer"),
      node("reviewer", CODEX, [], [], "Review the value and end the work. next:<complete>")
    ],
    start: "writer",
    handoffs: [
      { from: "writer", to: ["reviewer"] },
      { from: "reviewer", to: ["writer"] }
    ]
  }
});

// why: a step that fails on a host it cannot be debugged on says, in the
// assertion itself, how each Windows provider placeholder ended and which Git
// command failed (the witnesses of tests/helpers/fake-windows-spawn.mjs).
const WITNESSES = ["claude.exe.witness.log", "codex.exe.witness.log", "git-witness.log"];

function witnessed(fixture) {
  const tail = (name) => {
    const path = join(fixture.scratch, name);
    return existsSync(path) ? readFileSync(path, "utf8").slice(-4096) : "none";
  };
  return WITNESSES.map((name) => `${name}: ${tail(name)}`).join("\n");
}

export function ok(result, label, fixture) {
  if (result.status !== 0)
    assert.fail(
      `${label} exited ${result.status}: ${result.stderr}\n${result.stdout}\n${fixture === undefined ? "" : witnessed(fixture)}`
    );
  return result.json.data;
}

// why: a coordinated run needs the owner's extra-usage confirmation (D3); a
// journey that tests its absence passes `confirmed: false`. On Linux the
// credentials come from the Secret Service stand-in.
export async function coordinatedFixture(execution, options = {}) {
  const { confirmed = true, ...fixtureOptions } = options;
  const fixture = await taskFixture({ secretService: true, ...fixtureOptions });
  const { driver, ...request } = taskRequest(fixture.revision);
  assert.equal(driver.driverId, "claude-code");
  await writeFile(fixture.requestPath, JSON.stringify({ ...request, schemaVersion: 2, execution }));
  if (confirmed) await confirmExtraUsage(fixture.stateRoot);
  return fixture;
}

export async function approved(fixture) {
  const plan = ok(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan",
    fixture
  );
  ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve", fixture);
  return plan;
}

export const startArguments = (fixture, runId) => [
  "task",
  "start",
  "--run-id",
  runId,
  ...fixture.keychainArgs,
  "--output",
  "json"
];
export const status = (fixture, runId) =>
  ok(fixture.launch(["task", "status", "--run-id", runId, "--output", "json"]), "status", fixture);

const jsonLines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

export const logLines = (fixture, name) => jsonLines(join(fixture.scratch, name));

// invariant: what each platform's credential backend ran, as the fake keychain
// preload and fake-windows-spawn.mjs record it: the program or command and the
// logical name, never a value. The last entry of each list is the read.
export const CREDENTIAL_PROGRAMS = Object.freeze({
  darwin: Object.freeze(["find-generic-password"]),
  linux: Object.freeze(["SearchItems", "lookup"]),
  win32: Object.freeze(["cmdkey", "Read"])
});
export const credentialReads = (fixture) => jsonLines(`${fixture.store}.log`);

export function ledger(fixture, runId) {
  const sealed = JSON.parse(
    readFileSync(join(fixture.stateRoot, "tasks", runId, "coordination", "ledger.json"), "utf8")
  );
  return sealed.record;
}

export function visits(fixture, runId) {
  return ledger(fixture, runId).visits.map((entry) => `${entry.nodeId}#${entry.visit}:${entry.state}`);
}

export function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function waitFor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition was not reached in time");
}

export function reviewed(fixture, runId, digest) {
  return ok(
    fixture.launch(
      [
        "task",
        "review",
        "--run-id",
        runId,
        "--outcome",
        "accepted",
        "--surface-digest",
        digest,
        "--confirm-stdin",
        ...fixture.keychainArgs,
        "--output",
        "json"
      ],
      `${digest}\n`
    ),
    "review"
  );
}
