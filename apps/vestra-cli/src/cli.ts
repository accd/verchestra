import type { CliCommand, CommandBus, InvocationContext } from "@verchestra/application";
import type { CliOutput } from "@verchestra/contracts";
import { PublicErrorException, type PublicErrorEnvelope } from "@verchestra/domain";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";

export interface CliOptionManifest {
  readonly name: string;
  readonly kind: "boolean" | "string";
  readonly values?: readonly string[];
}

export interface CliCommandManifest {
  readonly name: string;
  readonly summary: string;
  readonly supportsJson: boolean;
  readonly mutating: boolean;
  readonly options: readonly CliOptionManifest[];
}

export interface InstalledCliManifest {
  readonly schemaVersion: 1;
  readonly semanticVersion: string;
  // null in source mode: no verified release artifact exists to bind a digest to.
  readonly releaseDigest: string | null;
  // The 40-hex revision a sealed build was sealed at; null or absent from source.
  readonly revision?: string | null;
  readonly minimumCliVersion: string;
  readonly commands: readonly CliCommandManifest[];
}

export interface ParsedCliArguments {
  readonly mode: "help" | "version" | "command" | "command-help";
  readonly output: "human" | "json";
  readonly command?: CliCommand;
  readonly help?: CliCommandManifest;
}

interface CliRunOptions {
  readonly argv: readonly string[];
  readonly invokedAs: string;
  readonly installedManifest: InstalledCliManifest;
  readonly installedCliVersion: string;
  readonly commandBus: CommandBus;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
// Shown instead of a digest when no verified release artifact backs this build.
const SOURCE_BUILD = "source build, no verified release artifact";
const NAME = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*$/u;
const OPTION = /^[a-z][a-z0-9-]*$/u;

function argumentError(argument: string, message: string): PublicErrorException {
  return cliError("VES_CLI_ARGUMENT_INVALID", { argument }, message);
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/u).slice(0, 3).map(Number);
  const b = right.split(/[.-]/u).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const REVISION = /^[0-9a-f]{40}$/u;

function validIdentity(manifest: InstalledCliManifest): boolean {
  const revision = manifest.revision ?? null;
  return (
    manifest.schemaVersion === 1 &&
    SEMVER.test(manifest.semanticVersion) &&
    SEMVER.test(manifest.minimumCliVersion) &&
    (manifest.releaseDigest === null || DIGEST.test(manifest.releaseDigest)) &&
    (revision === null || REVISION.test(revision))
  );
}

function assertManifest(manifest: InstalledCliManifest): void {
  const names = new Set<string>();
  if (!validIdentity(manifest) || manifest.commands.length === 0) {
    throw cliError(
      "VES_CLI_RELEASE_INCOMPATIBLE",
      { minimumRelease: manifest.minimumCliVersion || "unknown" },
      "Installed release manifest is invalid"
    );
  }
  for (const command of manifest.commands) {
    if (names.has(command.name) || !NAME.test(command.name) || command.summary.trim().length === 0) {
      throw cliError(
        "VES_CLI_RELEASE_INCOMPATIBLE",
        { minimumRelease: manifest.minimumCliVersion },
        "Installed command manifest is ambiguous"
      );
    }
    names.add(command.name);
    const options = new Set<string>();
    for (const option of command.options) {
      if (
        options.has(option.name) ||
        !OPTION.test(option.name) ||
        !(["boolean", "string"] as const).includes(option.kind) ||
        (option.values !== undefined && (option.kind !== "string" || option.values.length === 0))
      ) {
        throw cliError(
          "VES_CLI_RELEASE_INCOMPATIBLE",
          { minimumRelease: manifest.minimumCliVersion },
          "Installed option manifest is ambiguous"
        );
      }
      options.add(option.name);
    }
  }
}

function extractOutput(argv: readonly string[]): { readonly output: "human" | "json"; readonly rest: string[] } {
  const rest: string[] = [];
  let output: "human" | "json" = "human";
  let seen = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output") {
      rest.push(argv[index] as string);
      continue;
    }
    if (seen) throw argumentError("--output", "Output option may appear only once");
    const value = argv[index + 1];
    if (value !== "json" && value !== "human") throw argumentError("--output", "Output must be json or human");
    output = value;
    seen = true;
    index += 1;
  }
  return { output, rest };
}

export function parseCliArguments(argv: readonly string[], manifest: InstalledCliManifest): ParsedCliArguments {
  assertManifest(manifest);
  const { output, rest } = extractOutput(argv);
  if (rest.length === 0 || (rest.length === 1 && rest[0] === "--help")) return { mode: "help", output };
  if (rest.length === 1 && rest[0] === "--version") return { mode: "version", output };
  if (rest.includes("--version")) throw argumentError("--version", "Global flag cannot be mixed with a command");
  const commandManifest = [...manifest.commands]
    .sort((left, right) => right.name.split(" ").length - left.name.split(" ").length)
    .find((candidate) => {
      const words = candidate.name.split(" ");
      return words.every((word, index) => rest[index] === word);
    });
  if (commandManifest === undefined) throw argumentError(rest[0] ?? "command", "Command is not installed");
  // why: help names the command's options from the manifest it parses with,
  // so the listed options are exactly the accepted ones.
  if (rest.includes("--help")) return { mode: "command-help", output, help: commandManifest };
  if (output === "json" && !commandManifest.supportsJson) {
    throw argumentError("--output", "Command does not support JSON output");
  }
  const commandWords = commandManifest.name.split(" ").length;
  const values: Record<string, string | boolean> = {};
  const declared = new Map(commandManifest.options.map((entry) => [entry.name, entry]));
  for (let index = commandWords; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (!token.startsWith("--")) throw argumentError(token, "Unexpected positional argument");
    const name = token.slice(2);
    const option = declared.get(name);
    if (option === undefined || Object.hasOwn(values, name))
      throw argumentError(token, "Option is unknown or duplicated");
    if (option.kind === "boolean") {
      values[name] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw argumentError(token, "Option value is missing");
    if (option.values !== undefined && !option.values.includes(value))
      throw argumentError(token, "Option value is invalid");
    values[name] = value;
    index += 1;
  }
  return Object.freeze({
    mode: "command",
    output,
    command: Object.freeze({ name: commandManifest.name, options: Object.freeze(values) })
  });
}

function renderHelp(manifest: InstalledCliManifest): string {
  const width = Math.max(...manifest.commands.map((entry) => entry.name.length));
  const commands = manifest.commands.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`).join("\n");
  return `Verchestra ${manifest.semanticVersion}\nCanonical CLI: vestra\n\nUsage: vestra <command> [options]\n\nCommands:\n${commands}\n`;
}

function renderCommandHelp(command: CliCommandManifest): string {
  const options = command.options.map((option) =>
    option.kind === "boolean"
      ? `  --${option.name}`
      : `  --${option.name} <${option.values === undefined ? "value" : option.values.join("|")}>`
  );
  const json = command.supportsJson ? "\nAdd --output json for a JSON result.\n" : "";
  return (
    `Usage: vestra ${command.name} [options]\n\n${command.summary}\n\n` +
    (options.length === 0 ? "This command takes no options.\n" : `Options:\n${options.join("\n")}\n`) +
    json
  );
}

function commandHelpData(command: CliCommandManifest) {
  return {
    command: command.name,
    options: command.options.map((option) => ({
      name: option.name,
      kind: option.kind,
      ...(option.values === undefined ? {} : { values: [...option.values] })
    }))
  };
}

function humanData(data: unknown): string {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return `${String(data)}\n`;
  return `${Object.entries(data as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    // A nested value has to stay readable without turning human output into the
    // JSON envelope that `--output json` exists to provide, so it is rendered
    // compactly rather than as "[object Object]".
    .map(
      ([key, value]) => `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`
    )
    .join("\n")}\n`;
}

function jsonOutput(command: string, ok: boolean, data: unknown, error?: PublicErrorEnvelope): string {
  const output: CliOutput = {
    schemaVersion: "1",
    command,
    ok,
    data,
    ...(error === undefined ? {} : { error })
  };
  return `${JSON.stringify(output)}\n`;
}

const DIAGNOSTIC_CODE = /^VES_[A-Z0-9_]+$/u;

// invariant: only a bare `VES_` code is read from an unexpected failure, so no
// upstream message, path, or stack reaches the terminal through it.
function causeCode(error: unknown): string | undefined {
  if (error instanceof PublicErrorException) return undefined;
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && DIAGNOSTIC_CODE.test(code) ? code : undefined;
}

// why: the safe details are the named requirement a tester has to provision;
// the human line shows them, in a stable order, and the JSON envelope keeps
// its own shape. An unexpected failure's cause code is shown here only.
function humanError(envelope: PublicErrorEnvelope, cause: string | undefined): string {
  const details: Record<string, unknown> = { ...envelope.safeDetails };
  if (cause !== undefined) details["cause"] = cause;
  const keys = Object.keys(details).sort((left, right) => Number(left > right) - Number(left < right));
  const named = keys.length === 0 ? "" : ` (${keys.map((key) => `${key}=${String(details[key])}`).join(", ")})`;
  return `${envelope.code}${named}: ${envelope.recovery}\n`;
}

function exitCode(error: PublicErrorEnvelope): number {
  if (error.code === "VES_CLI_ARGUMENT_INVALID") return 2;
  if (error.code === "VES_CLI_RELEASE_INCOMPATIBLE") return 3;
  if (error.code === "VES_CLI_INTERNAL") return 70;
  return 5;
}

// A command may signal a non-zero exit while still rendering its data (a
// diagnostic reporting FAIL or BLOCKED); an omitted code keeps success at 0.
function successExit(result: { readonly exitCode?: number }): number {
  return result.exitCode ?? 0;
}

function requestedJson(argv: readonly string[]): boolean {
  return argv.some((entry, index) => entry === "--output" && argv[index + 1] === "json");
}

export async function runCli(options: CliRunOptions): Promise<number> {
  void options.invokedAs;
  let commandName = "cli";
  let output: "human" | "json" = requestedJson(options.argv) ? "json" : "human";
  try {
    assertManifest(options.installedManifest);
    if (
      options.installedCliVersion !== options.installedManifest.semanticVersion ||
      compareVersions(options.installedCliVersion, options.installedManifest.minimumCliVersion) < 0
    ) {
      throw cliError(
        "VES_CLI_RELEASE_INCOMPATIBLE",
        { minimumRelease: options.installedManifest.minimumCliVersion },
        "Installed CLI cannot read the active release"
      );
    }
    const parsed = parseCliArguments(options.argv, options.installedManifest);
    output = parsed.output;
    commandName = parsed.help?.name ?? parsed.mode;
    const shown = informationalOutput(parsed, options.installedManifest);
    if (shown !== undefined) {
      options.stdout(shown);
      return 0;
    }
    const command = parsed.command as CliCommand;
    commandName = command.name;
    const context: InvocationContext = Object.freeze({
      canonicalExecutable: "vestra",
      output,
      releaseDigest: options.installedManifest.releaseDigest
    });
    const result = await options.commandBus.execute(command, context);
    for (const diagnostic of result.diagnostics) options.stderr(`${diagnostic}\n`);
    options.stdout(output === "json" ? jsonOutput(command.name, true, result.data) : humanData(result.data));
    return successExit(result);
  } catch (error) {
    const envelope =
      error instanceof PublicErrorException
        ? error.envelope
        : cliPublicErrorRegistry.create("VES_CLI_INTERNAL", { incident: "cli-unexpected-failure" });
    if (output === "json") options.stdout(jsonOutput(commandName, false, null, envelope));
    else options.stderr(humanError(envelope, causeCode(error)));
    return exitCode(envelope);
  }
}

// invariant: a sealed build names the revision it was sealed at and never
// calls itself a source build; a source build has no revision to name.
function versionOutput(manifest: InstalledCliManifest, json: boolean): string {
  const revision = manifest.revision ?? null;
  const data = {
    product: "Verchestra",
    semanticVersion: manifest.semanticVersion,
    releaseDigest: manifest.releaseDigest,
    revision
  };
  if (json) return jsonOutput("version", true, data);
  const build = manifest.releaseDigest ?? (revision === null ? SOURCE_BUILD : `revision ${revision.slice(0, 12)}`);
  return `Verchestra ${data.semanticVersion} (${build})\n`;
}

// invariant: the global flags and per-command help answer from the installed
// manifest alone and never reach the command bus.
function informationalOutput(parsed: ParsedCliArguments, manifest: InstalledCliManifest): string | undefined {
  const json = parsed.output === "json";
  if (parsed.mode === "version") return versionOutput(manifest, json);
  if (parsed.mode === "help") {
    const data = {
      product: "Verchestra",
      canonicalExecutable: "vestra",
      commands: manifest.commands.map((entry) => entry.name)
    };
    return json ? jsonOutput("help", true, data) : renderHelp(manifest);
  }
  if (parsed.mode !== "command-help") return undefined;
  const help = parsed.help as CliCommandManifest;
  return json ? jsonOutput(help.name, true, commandHelpData(help)) : renderCommandHelp(help);
}
