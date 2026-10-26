import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CORE_PUBLIC_ERROR_DEFINITIONS,
  PublicErrorException,
  PublicErrorRegistry,
  WORKFLOW_PUBLIC_ERROR_DEFINITIONS
} from "../../packages/domain/src/index.ts";
import { TASK_PUBLIC_ERROR_DEFINITIONS } from "../../apps/vestra-cli/src/task/task-errors.ts";
import { BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS } from "../../packages/application/src/bootstrap/bootstrap-errors.ts";
import { EFFECT_PUBLIC_ERROR_DEFINITIONS } from "../../packages/effects/src/effect-errors.ts";
import { ACTIVATION_LAUNCHER_PUBLIC_ERROR_DEFINITIONS } from "../../packages/platform-node/src/activation-launcher-errors.ts";
import { PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS } from "../../packages/platform-node/src/platform-security-errors.ts";
import { RUNTIME_PUBLIC_ERROR_DEFINITIONS } from "../../packages/platform-node/src/runtime-store/runtime-errors.ts";
import { INIT_PUBLIC_ERROR_DEFINITIONS } from "../../packages/workspace/src/init/init-errors.ts";
import { PLACEMENT_PUBLIC_ERROR_DEFINITIONS } from "../../packages/workspace/src/placement/placement-errors.ts";
import { WORKSPACE_PUBLIC_ERROR_DEFINITIONS } from "../../packages/workspace/src/scanner/workspace-errors.ts";
import {
  CLI_PUBLIC_ERROR_DEFINITIONS,
  cliPublicErrorRegistry,
  installedReleaseManifest,
  parseCliArguments,
  runCli
} from "../../apps/vestra-cli/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import { PROBE_SCAFFOLD_ENGINES, PROBE_SCAFFOLD_LANGUAGES } from "../../packages/workspace/src/index.ts";
import { RecordingBus, io, manifest, releaseDigest } from "../helpers/cli-fixture.mjs";

async function execute(argv, options = {}) {
  const bus = options.bus ?? new RecordingBus();
  const streams = io();
  const exitCode = await runCli({
    argv,
    invokedAs: options.invokedAs ?? "vestra",
    installedManifest: options.installedManifest ?? manifest(),
    installedCliVersion: options.installedCliVersion ?? "1.0.0",
    commandBus: bus,
    ...streams.ports
  });
  return { bus, streams, exitCode };
}

test("vestra version prints semantic version and release digest", async () => {
  const result = await execute(["--version"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.streams.stdout[0], `Verchestra 1.0.0 (${releaseDigest})\n`);
  assert.equal(result.bus.calls.length, 0);
});

test("verchestra alias version is byte-identical", async () => {
  const left = await execute(["--version"], { invokedAs: "vestra" });
  const right = await execute(["--version"], { invokedAs: "verchestra" });
  assert.deepEqual(right.streams.stdout, left.streams.stdout);
  assert.deepEqual(right.streams.stderr, left.streams.stderr);
  assert.equal(right.exitCode, left.exitCode);
});

test("JSON version output validates against cli-output@1", async () => {
  const result = await execute(["--version", "--output", "json"]);
  const output = JSON.parse(result.streams.stdout[0]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  assert.equal(schemas.validate("cli-output", "1", output).data.releaseDigest, releaseDigest);
  assert.equal(result.streams.stderr.length, 0);
});

test("help identifies product and canonical executable", async () => {
  const result = await execute(["--help"]);
  assert.match(result.streams.stdout[0], /Verchestra/u);
  assert.match(result.streams.stdout[0], /Canonical CLI: vestra/u);
});

for (const command of ["init", "bootstrap", "sync", "workspace reconcile", "doctor"]) {
  test(`help lists installed command ${command}`, async () => {
    const result = await execute(["--help"]);
    assert.match(result.streams.stdout[0], new RegExp(command.replace(" ", "\\s+"), "u"));
  });
}

test("help excludes a command absent from the installed manifest", async () => {
  const installedManifest = manifest({ commands: manifest().commands.filter((entry) => entry.name !== "doctor") });
  const result = await execute(["--help"], { installedManifest });
  assert.equal(result.streams.stdout[0].includes("doctor"), false);
});

test("the source manifest advertises the composed init, self-test, doctor, secret, and task slice", () => {
  assert.deepEqual(
    installedReleaseManifest.commands.map((command) => command.name),
    [
      "init",
      "self-test",
      "doctor",
      "secret set",
      "secret status",
      "secret delete",
      "task check",
      "task plan",
      "task approve",
      "task start",
      "task status",
      "task resume",
      "task cancel",
      "task review"
    ]
  );
  assert.deepEqual(
    installedReleaseManifest.commands[0].options.map((option) => option.name),
    ["dry-run", "workspace-id", "name", "placement", "probe-engine", "probe-language", "probe-dir"]
  );
  assert.deepEqual(
    installedReleaseManifest.commands[1].options.map((option) => option.name),
    ["profile"]
  );
  assert.deepEqual(
    installedReleaseManifest.commands[2].options.map((option) => option.name),
    ["deep", "keychain"]
  );
  for (const index of [3, 4, 5]) {
    assert.deepEqual(
      installedReleaseManifest.commands[index].options.map((option) => [option.name, option.kind]),
      [
        ["name", "string"],
        ["keychain", "string"]
      ]
    );
  }
  assert.deepEqual(
    installedReleaseManifest.commands.slice(3, 6).map((command) => [command.name, command.mutating]),
    [
      ["secret set", true],
      ["secret status", false],
      ["secret delete", true]
    ]
  );
});

// #234: the manifest spells the probe option values as literals so the doctor's
// read-only closure never imports @verchestra/workspace; this pins them to the
// generator's own lists.
test("the init probe options advertise exactly the generator's engines and languages", () => {
  const options = new Map(installedReleaseManifest.commands[0].options.map((option) => [option.name, option]));
  assert.deepEqual(options.get("probe-engine"), {
    name: "probe-engine",
    kind: "string",
    values: [...PROBE_SCAFFOLD_ENGINES]
  });
  assert.deepEqual(options.get("probe-language"), {
    name: "probe-language",
    kind: "string",
    values: [...PROBE_SCAFFOLD_LANGUAGES]
  });
  assert.deepEqual(options.get("probe-dir"), { name: "probe-dir", kind: "string" });
  const parsed = parseCliArguments(
    ["init", "--probe-engine", "sap-ase", "--probe-dir", ".verchestra/probes/ase"],
    installedReleaseManifest
  );
  assert.deepEqual(parsed.command.options, { "probe-engine": "sap-ase", "probe-dir": ".verchestra/probes/ase" });
  assert.throws(
    () => parseCliArguments(["init", "--probe-engine", "db2"], installedReleaseManifest),
    (error) => error.envelope.code === "VES_CLI_ARGUMENT_INVALID"
  );
});

test("the task slice takes no positional argument, a run ID, and the keychain where credentials are read", () => {
  const task = Object.fromEntries(
    installedReleaseManifest.commands
      .filter((command) => command.name.startsWith("task "))
      .map((command) => [command.name, command.options.map((option) => [option.name, option.kind])])
  );
  assert.deepEqual(task, {
    "task check": [
      ["request", "string"],
      ["keychain", "string"]
    ],
    "task plan": [
      ["request", "string"],
      ["dry-run", "boolean"],
      ["keychain", "string"]
    ],
    "task approve": [
      ["run-id", "string"],
      ["binding-digest", "string"],
      ["confirm-stdin", "boolean"],
      ["keychain", "string"]
    ],
    "task start": [
      ["run-id", "string"],
      ["keychain", "string"]
    ],
    "task status": [
      ["run-id", "string"],
      ["keychain", "string"]
    ],
    "task resume": [
      ["run-id", "string"],
      ["reconcile", "string"],
      ["keychain", "string"]
    ],
    "task cancel": [
      ["run-id", "string"],
      ["keychain", "string"]
    ],
    "task review": [
      ["run-id", "string"],
      ["outcome", "string"],
      ["surface-digest", "string"],
      ["confirm-stdin", "boolean"],
      ["keychain", "string"]
    ]
  });
  const review = installedReleaseManifest.commands.find((command) => command.name === "task review");
  assert.deepEqual(review.options.find((option) => option.name === "outcome").values, ["accepted", "rejected"]);
  assert.deepEqual(
    installedReleaseManifest.commands.slice(6).map((command) => [command.name, command.mutating]),
    [
      ["task check", false],
      ["task plan", true],
      ["task approve", true],
      ["task start", true],
      ["task status", false],
      ["task resume", true],
      ["task cancel", true],
      ["task review", true]
    ]
  );
});

test("empty arguments select canonical help without dispatch", async () => {
  const result = await execute([]);
  assert.match(result.streams.stdout[0], /Usage:/u);
  assert.equal(result.bus.calls.length, 0);
});

for (const [argv, name] of [
  [["init", "--dry-run"], "init"],
  [["bootstrap"], "bootstrap"],
  [["sync"], "sync"],
  [["workspace", "reconcile"], "workspace reconcile"],
  [["doctor"], "doctor"]
]) {
  test(`${name} dispatches one typed canonical command`, async () => {
    const result = await execute(argv);
    assert.equal(result.exitCode, 0);
    assert.equal(result.bus.calls.length, 1);
    assert.equal(result.bus.calls[0].command.name, name);
  });
}

test("alias spelling cannot enter dispatched command or context", async () => {
  const result = await execute(["sync"], { invokedAs: "verchestra" });
  assert.equal(JSON.stringify(result.bus.calls).includes("verchestra"), false);
  assert.equal(result.bus.calls[0].context.canonicalExecutable, "vestra");
});

test("canonical and alias invocations dispatch identical semantic input", async () => {
  const canonical = await execute(["init", "--dry-run", "--output", "json"], { invokedAs: "vestra" });
  const alias = await execute(["init", "--dry-run", "--output", "json"], { invokedAs: "verchestra" });
  assert.deepEqual(alias.bus.calls, canonical.bus.calls);
  assert.deepEqual(alias.streams.stdout, canonical.streams.stdout);
  assert.deepEqual(alias.streams.stderr, canonical.streams.stderr);
  assert.equal(alias.exitCode, canonical.exitCode);
});

test("boolean option is represented as exact true", async () => {
  const result = await execute(["init", "--dry-run"]);
  assert.deepEqual(result.bus.calls[0].command.options, { "dry-run": true });
});

test("string option is represented under its manifest name", async () => {
  const result = await execute(["init", "--placement", "centralized"]);
  assert.deepEqual(result.bus.calls[0].command.options, { placement: "centralized" });
});

test("manifest enum permits every declared placement", () => {
  for (const value of ["colocated", "centralized", "mixed", "external-control"]) {
    assert.equal(parseCliArguments(["init", "--placement", value], manifest()).command.options.placement, value);
  }
});

test("JSON command output is a single clean stdout document", async () => {
  const result = await execute(["sync", "--output", "json"]);
  assert.equal(result.streams.stdout.length, 1);
  assert.equal(JSON.parse(result.streams.stdout[0]).data.status, "ok");
  assert.equal(result.streams.stdout[0].endsWith("\n"), true);
});

test("human diagnostics go to stderr while JSON remains clean", async () => {
  const bus = new RecordingBus();
  bus.result = { data: { status: "ok" }, diagnostics: ["rebuild scheduled"] };
  const result = await execute(["sync", "--output", "json"], { bus });
  assert.equal(JSON.parse(result.streams.stdout[0]).ok, true);
  assert.deepEqual(result.streams.stderr, ["rebuild scheduled\n"]);
});

test("default human result renders data without JSON envelope", async () => {
  const result = await execute(["sync"]);
  assert.equal(result.streams.stdout[0], "status: ok\n");
});

test("human output keeps nested values readable without becoming the JSON envelope", async () => {
  const bus = {
    calls: [],
    async execute(command, context) {
      bus.calls.push([command, context]);
      return { data: { changes: [{ path: "a" }], status: "ok" }, diagnostics: [] };
    }
  };
  const result = await execute(["sync"], { bus });
  // Sorted key: value lines, with the nested value compact rather than
  // "[object Object]" and without the schemaVersion/command/ok envelope.
  assert.equal(result.streams.stdout[0], 'changes: [{"path":"a"}]\nstatus: ok\n');
  assert.doesNotMatch(result.streams.stdout[0], /schemaVersion|"ok":/u);
});

for (const [name, argv] of [
  ["unknown command", ["destroy"]],
  ["unknown option", ["sync", "--force"]],
  ["missing option value", ["init", "--placement"]],
  ["invalid enum value", ["init", "--placement", "sideways"]],
  ["duplicate option", ["init", "--dry-run", "--dry-run"]],
  ["unexpected positional", ["sync", "extra"]],
  ["help for an uninstalled command", ["destroy", "--help"]],
  ["mixed version and command", ["sync", "--version"]]
]) {
  test(`${name} fails with stable validation exit before dispatch`, async () => {
    const result = await execute(argv);
    assert.equal(result.exitCode, 2);
    assert.equal(result.bus.calls.length, 0);
    assert.equal(result.streams.stdout.length, 0);
    assert.match(result.streams.stderr[0], /VES_CLI_ARGUMENT_INVALID/u);
  });
}

test("JSON request on unsupported command fails before dispatch", async () => {
  const commands = manifest().commands.map((entry) =>
    entry.name === "doctor" ? { ...entry, supportsJson: false } : entry
  );
  const result = await execute(["doctor", "--output", "json"], { installedManifest: manifest({ commands }) });
  assert.equal(result.exitCode, 2);
  assert.equal(result.bus.calls.length, 0);
});

test("incompatible installed release fails before mutable dispatch", async () => {
  const result = await execute(["init", "--dry-run"], {
    installedManifest: manifest({ minimumCliVersion: "2.0.0" })
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.bus.calls.length, 0);
  assert.match(result.streams.stderr[0], /VES_CLI_RELEASE_INCOMPATIBLE/u);
});

test("installed CLI identity must exactly match the manifest it executes", async () => {
  const result = await execute(["init", "--dry-run"], { installedCliVersion: "1.0.1" });
  assert.equal(result.exitCode, 3);
  assert.equal(result.bus.calls.length, 0);
  assert.match(result.streams.stderr[0], /VES_CLI_RELEASE_INCOMPATIBLE/u);
});

for (const [name, installedManifest] of [
  ["duplicate commands", manifest({ commands: [...manifest().commands, manifest().commands[0]] })],
  [
    "duplicate options",
    manifest({
      commands: manifest().commands.map((entry) =>
        entry.name === "init" ? { ...entry, options: [...entry.options, entry.options[0]] } : entry
      )
    })
  ],
  ["invalid release digest", manifest({ releaseDigest: "sha256:bad" })]
]) {
  test(`${name} in installed manifest fails before dispatch`, async () => {
    const result = await execute(["sync"], { installedManifest });
    assert.equal(result.exitCode, 3);
    assert.equal(result.bus.calls.length, 0);
  });
}

test("public validation command failure preserves its stable exit and JSON schema", async () => {
  const bus = new RecordingBus();
  bus.error = new PublicErrorException(
    cliPublicErrorRegistry.create("VES_CLI_ARGUMENT_INVALID", { argument: "request" }),
    "private parser detail"
  );
  const result = await execute(["sync", "--output", "json"], { bus });
  const output = JSON.parse(result.streams.stdout[0]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  assert.equal(schemas.validate("cli-output", "1", output).error.code, "VES_CLI_ARGUMENT_INVALID");
  assert.equal(result.exitCode, 2);
  assert.equal(result.streams.stdout[0].includes("private parser detail"), false);
});

test("unexpected private command failure becomes sanitized internal error", async () => {
  const bus = new RecordingBus();
  bus.error = new Error("C:\\private token=sentinel");
  const result = await execute(["sync", "--output", "json"], { bus });
  assert.equal(result.exitCode, 70);
  assert.equal(result.streams.stdout[0].includes("sentinel"), false);
  assert.equal(JSON.parse(result.streams.stdout[0]).error.code, "VES_CLI_INTERNAL");
});

test("human command failure writes only stderr", async () => {
  const bus = new RecordingBus();
  bus.error = new PublicErrorException(
    cliPublicErrorRegistry.create("VES_CLI_ARGUMENT_INVALID", { argument: "request" }),
    "private"
  );
  const result = await execute(["sync"], { bus });
  assert.equal(result.streams.stdout.length, 0);
  assert.match(result.streams.stderr[0], /VES_CLI_ARGUMENT_INVALID/u);
});

test("CLI public error catalog is exact and safe", async () => {
  assert.equal(CLI_PUBLIC_ERROR_DEFINITIONS.length, 4);
  assert.deepEqual(cliPublicErrorRegistry.codes, [
    "VES_CLI_ARGUMENT_INVALID",
    "VES_CLI_COMMAND_FAILED",
    "VES_CLI_INTERNAL",
    "VES_CLI_RELEASE_INCOMPATIBLE"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of cliPublicErrorRegistry.codes) {
    const definition = CLI_PUBLIC_ERROR_DEFINITIONS.find((entry) => entry.code === code);
    const details = Object.fromEntries(
      Object.entries(definition.safeDetails).map(([key, type]) => [
        key,
        type === "boolean" ? false : type === "number" ? 0 : "safe"
      ])
    );
    assert.equal(schemas.validate("public-error", "1", cliPublicErrorRegistry.create(code, details)).code, code);
  }
});

// invariant: the human refusal line names what the envelope already makes
// safe to show, so a tester reads the requirement without --output json.
const DETAILED = new PublicErrorRegistry([
  {
    code: "VES_TEST_DETAILED",
    category: "external",
    component: "test",
    retryability: "after-change",
    recovery: "Provision it and retry.",
    documentationVersion: "1",
    safeDetails: { zeta: "string", alpha: "string", count: "number" }
  }
]);

test("human refusal line carries the safe details in key order", async () => {
  const bus = new RecordingBus();
  bus.error = new PublicErrorException(
    DETAILED.create("VES_TEST_DETAILED", { zeta: "z", alpha: "gate-allowlist", count: 2 }),
    "private"
  );
  const result = await execute(["sync"], { bus });
  assert.deepEqual(result.streams.stderr, [
    "VES_TEST_DETAILED (alpha=gate-allowlist, count=2, zeta=z): Provision it and retry.\n"
  ]);
  assert.equal(result.streams.stdout.length, 0);
});

test("json refusal envelope is unchanged by the human detail line", async () => {
  const bus = new RecordingBus();
  const envelope = DETAILED.create("VES_TEST_DETAILED", { zeta: "z", alpha: "a", count: 1 });
  bus.error = new PublicErrorException(envelope, "private");
  const result = await execute(["sync", "--output", "json"], { bus });
  assert.deepEqual(JSON.parse(result.streams.stdout[0]).error, JSON.parse(JSON.stringify(envelope)));
  assert.equal(result.streams.stderr.length, 0);
});

test("an internal failure names the VES code of its cause", async () => {
  const coded = new RecordingBus();
  coded.error = Object.assign(new Error("C:\private token=sentinel"), { code: "VES_TUF_SOURCE_HTTP" });
  const human = await execute(["sync"], { bus: coded });
  assert.deepEqual(human.streams.stderr, [
    "VES_CLI_INTERNAL (cause=VES_TUF_SOURCE_HTTP, incident=cli-unexpected-failure): " +
      "Record the incident reference and run a safe diagnostic.\n"
  ]);
  assert.equal(human.exitCode, 70);
  const json = await execute(["sync", "--output", "json"], { bus: coded });
  assert.deepEqual(
    JSON.parse(json.streams.stdout[0]).error,
    JSON.parse(
      JSON.stringify(cliPublicErrorRegistry.create("VES_CLI_INTERNAL", { incident: "cli-unexpected-failure" }))
    )
  );
  for (const code of [undefined, "ENOENT", "VES_lowercase", 7]) {
    const bus = new RecordingBus();
    bus.error = Object.assign(new Error("private"), code === undefined ? {} : { code });
    const result = await execute(["sync"], { bus });
    assert.deepEqual(result.streams.stderr, [
      "VES_CLI_INTERNAL (incident=cli-unexpected-failure): Record the incident reference and run a safe diagnostic.\n"
    ]);
  }
});

const COMPOSED_ERROR_DEFINITIONS = Object.freeze({
  cli: CLI_PUBLIC_ERROR_DEFINITIONS,
  task: TASK_PUBLIC_ERROR_DEFINITIONS,
  bootstrap: BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS,
  core: CORE_PUBLIC_ERROR_DEFINITIONS,
  workflow: WORKFLOW_PUBLIC_ERROR_DEFINITIONS,
  effects: EFFECT_PUBLIC_ERROR_DEFINITIONS,
  activation: ACTIVATION_LAUNCHER_PUBLIC_ERROR_DEFINITIONS,
  platformSecurity: PLATFORM_SECURITY_PUBLIC_ERROR_DEFINITIONS,
  runtime: RUNTIME_PUBLIC_ERROR_DEFINITIONS,
  init: INIT_PUBLIC_ERROR_DEFINITIONS,
  placement: PLACEMENT_PUBLIC_ERROR_DEFINITIONS,
  workspace: WORKSPACE_PUBLIC_ERROR_DEFINITIONS
});

test("no recovery text names a repository-relative docs path", () => {
  let checked = 0;
  for (const [registry, definitions] of Object.entries(COMPOSED_ERROR_DEFINITIONS)) {
    for (const definition of definitions) {
      checked += 1;
      const withoutUrls = definition.recovery.replaceAll(/https:\/\/\S+/gu, "");
      assert.doesNotMatch(withoutUrls, /docs\/|\.md\b/u, `${registry} ${definition.code}`);
      for (const url of definition.recovery.match(/https:\/\/\S+/gu) ?? [])
        assert.ok(url.startsWith("https://github.com/accd/verchestra/blob/main/docs/"), `${definition.code} ${url}`);
    }
  }
  assert.ok(checked > 50, `only ${checked} definitions were read`);
  const notConfigured = TASK_PUBLIC_ERROR_DEFINITIONS.find((entry) => entry.code === "VES_TASK_NOT_CONFIGURED");
  assert.match(notConfigured.recovery, /https:\/\/github\.com\/accd\/verchestra\/blob\/main\/docs\/quick-start\.md/u);
});

// invariant: `--help` after a command answers with that command's own options,
// read from the installed manifest, so no option list is maintained twice.
async function commandHelp(command, output) {
  const argv = [...command.name.split(" "), "--help", ...(output === "json" ? ["--output", "json"] : [])];
  return execute(argv, {
    installedManifest: installedReleaseManifest,
    installedCliVersion: installedReleaseManifest.semanticVersion
  });
}

function optionLine(option) {
  if (option.kind === "boolean") return `  --${option.name}`;
  return `  --${option.name} <${option.values === undefined ? "value" : option.values.join("|")}>`;
}

test("every command answers --help with its declared options", async () => {
  assert.equal(installedReleaseManifest.commands.length, 14);
  for (const command of installedReleaseManifest.commands) {
    const result = await commandHelp(command, "human");
    assert.equal(result.exitCode, 0, command.name);
    assert.equal(result.bus.calls.length, 0, command.name);
    assert.equal(result.streams.stderr.length, 0, command.name);
    const lines = result.streams.stdout.join("").split("\n");
    assert.equal(lines[0], `Usage: vestra ${command.name} [options]`, command.name);
    assert.deepEqual(
      lines.filter((line) => line.startsWith("  --")),
      command.options.map(optionLine),
      command.name
    );
  }
});

test("command help in json lists the declared options", async () => {
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const command of installedReleaseManifest.commands.filter((entry) => entry.supportsJson)) {
    const result = await commandHelp(command, "json");
    assert.equal(result.exitCode, 0, command.name);
    const output = schemas.validate("cli-output", "1", JSON.parse(result.streams.stdout[0]));
    assert.deepEqual(output.data, {
      command: command.name,
      options: command.options.map((option) => ({
        name: option.name,
        kind: option.kind,
        ...(option.values === undefined ? {} : { values: [...option.values] })
      }))
    });
  }
});

test("help for an uninstalled command is an argument error", async () => {
  const result = await execute(["no-such-command", "--help"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.streams.stdout.length, 0);
  assert.match(result.streams.stderr[0], /^VES_CLI_ARGUMENT_INVALID /u);
  assert.equal(result.bus.calls.length, 0);
});
