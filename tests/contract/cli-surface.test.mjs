import assert from "node:assert/strict";
import { test } from "node:test";

import { PublicErrorException } from "../../packages/domain/src/index.ts";
import {
  CLI_PUBLIC_ERROR_DEFINITIONS,
  cliPublicErrorRegistry,
  installedReleaseManifest,
  parseCliArguments,
  runCli
} from "../../apps/vestra-cli/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
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

test("the source manifest advertises only the composed init slice", () => {
  assert.deepEqual(
    installedReleaseManifest.commands.map((command) => command.name),
    ["init"]
  );
  assert.deepEqual(
    installedReleaseManifest.commands[0].options.map((option) => option.name),
    ["dry-run", "workspace-id", "name", "placement"]
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

for (const [name, argv] of [
  ["unknown command", ["destroy"]],
  ["unknown option", ["sync", "--force"]],
  ["missing option value", ["init", "--placement"]],
  ["invalid enum value", ["init", "--placement", "sideways"]],
  ["duplicate option", ["init", "--dry-run", "--dry-run"]],
  ["unexpected positional", ["sync", "extra"]],
  ["mixed help and command", ["sync", "--help"]],
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
