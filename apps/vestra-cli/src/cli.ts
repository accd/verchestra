import type { CliCommand, CommandBus, InvocationContext } from "@verchestra/application";
import type { CliOutput } from "@verchestra/contracts";
import { PublicErrorException, type PublicErrorEnvelope } from "@verchestra/domain";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";

export interface CliOptionManifest {
  readonly name: string;
  readonly kind: "boolean" | "string";
  readonly values?: readonly string[];
  // why: a repeatable option collects every value it is given, in order, and
  // takes the next token as given, so `--arg --no-warnings` passes a flag.
  // `--output`, `--help` and `--version` are read before any command option,
  // so none of them can be such a value.
  readonly repeatable?: boolean;
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
  readonly mode: "help" | "version" | "command" | "command-help" | "family-help";
  readonly output: "human" | "json";
  readonly command?: CliCommand;
  readonly help?: CliCommandManifest;
  readonly family?: CliCommandFamily;
}

// why: `vestra <family> --help` lists the commands that share a first word
// (`extension`, `task`), read from the same manifest as every other help.
export interface CliCommandFamily {
  readonly name: string;
  readonly commands: readonly CliCommandManifest[];
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

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
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

function optionDeclarationValid(option: CliOptionManifest): boolean {
  return (
    OPTION.test(option.name) &&
    (["boolean", "string"] as const).includes(option.kind) &&
    (option.values === undefined || (option.kind === "string" && option.values.length > 0)) &&
    (option.repeatable !== true || option.kind === "string")
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
      if (options.has(option.name) || !optionDeclarationValid(option)) {
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

// why: `--version` is the global flag unless the command declares an option
// of that name, as `extension add` declares the version of the worker it locks.
function refuseMixedVersion(rest: readonly string[], command: CliCommandManifest | undefined): void {
  const declared = command?.options.some((option) => option.name === "version") === true;
  if (rest.includes("--version") && !declared)
    throw argumentError("--version", "Global flag cannot be mixed with a command");
}

// why: only a family of commands answers `--help` without a command of its
// own; any other unknown first word is still an argument error.
function familyHelp(rest: readonly string[], manifest: InstalledCliManifest, output: "human" | "json") {
  const name = rest[0] ?? "command";
  const commands = manifest.commands.filter((entry) => entry.name.startsWith(`${name} `));
  if (commands.length === 0 || rest.length !== 2 || rest[1] !== "--help")
    throw argumentError(name, "Command is not installed");
  return Object.freeze({ mode: "family-help" as const, output, family: Object.freeze({ name, commands }) });
}

function optionValue(option: CliOptionManifest, token: string, value: string | undefined): string {
  if (value === undefined || (option.repeatable !== true && value.startsWith("--")))
    throw argumentError(token, "Option value is missing");
  if (option.values !== undefined && !option.values.includes(value))
    throw argumentError(token, "Option value is invalid");
  return value;
}

// why: returns how many tokens after the option it consumed.
function assignOption(
  values: Record<string, string | boolean | readonly string[]>,
  option: CliOptionManifest,
  token: string,
  next: string | undefined
): number {
  const repeatable = option.repeatable === true;
  if (Object.hasOwn(values, option.name) && !repeatable) throw argumentError(token, "Option is unknown or duplicated");
  if (option.kind === "boolean") {
    values[option.name] = true;
    return 0;
  }
  const value = optionValue(option, token, next);
  const earlier = values[option.name];
  values[option.name] = repeatable ? Object.freeze([...(Array.isArray(earlier) ? earlier : []), value]) : value;
  return 1;
}

export function parseCliArguments(argv: readonly string[], manifest: InstalledCliManifest): ParsedCliArguments {
  assertManifest(manifest);
  const { output, rest } = extractOutput(argv);
  if (rest.length === 0 || (rest.length === 1 && rest[0] === "--help")) return { mode: "help", output };
  if (rest.length === 1 && rest[0] === "--version") return { mode: "version", output };
  const commandManifest = findCommandManifest(manifest, rest);
  refuseMixedVersion(rest, commandManifest);
  if (commandManifest === undefined) return familyHelp(rest, manifest, output);
  // why: help names the command's options from the manifest it parses with,
  // so the listed options are exactly the accepted ones.
  if (rest.includes("--help")) return { mode: "command-help", output, help: commandManifest };
  if (output === "json" && !commandManifest.supportsJson) {
    throw argumentError("--output", "Command does not support JSON output");
  }
  const values = parseCommandOptions(commandManifest, rest);
  return Object.freeze({
    mode: "command",
    output,
    command: Object.freeze({ name: commandManifest.name, options: Object.freeze(values) })
  });
}

function findCommandManifest(
  manifest: InstalledCliManifest,
  rest: readonly string[]
): CliCommandManifest | undefined {
  return [...manifest.commands]
    .sort((left, right) => right.name.split(" ").length - left.name.split(" ").length)
    .find((candidate) => {
      const words = candidate.name.split(" ");
      return words.every((word, index) => rest[index] === word);
    });
}

function parseCommandOptions(
  commandManifest: CliCommandManifest,
  rest: readonly string[]
): Record<string, string | boolean | readonly string[]> {
  const values: Record<string, string | boolean | readonly string[]> = {};
  const declared = new Map(commandManifest.options.map((entry) => [entry.name, entry]));
  for (let index = commandManifest.name.split(" ").length; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (!token.startsWith("--")) throw argumentError(token, "Unexpected positional argument");
    const option = declared.get(token.slice(2));
    if (option === undefined) throw argumentError(token, "Option is unknown or duplicated");
    index += assignOption(values, option, token, rest[index + 1]);
  }
  return values;
}

function renderHelp(manifest: InstalledCliManifest): string {
  const width = Math.max(...manifest.commands.map((entry) => entry.name.length));
  const commands = manifest.commands.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`).join("\n");
  return `Verchestra ${manifest.semanticVersion}\nCanonical CLI: vestra\n\nUsage: vestra <command> [options]\n\nCommands:\n${commands}\n`;
}

function optionLine(option: CliOptionManifest): string {
  if (option.kind === "boolean") return `  --${option.name}`;
  const value = option.values === undefined ? "value" : option.values.join("|");
  return `  --${option.name} <${value}>`;
}

function renderCommandHelp(command: CliCommandManifest): string {
  const options = command.options.map(optionLine);
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
  const pairs = keys.map((key) => `${key}=${String(details[key])}`).join(", ");
  const named = keys.length === 0 ? "" : ` (${pairs})`;
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
    commandName = parsedName(parsed);
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
  if (parsed.mode === "family-help") return familyOutput(parsed.family as CliCommandFamily, json);
  if (parsed.mode !== "command-help") return undefined;
  const help = parsed.help as CliCommandManifest;
  return json ? jsonOutput(help.name, true, commandHelpData(help)) : renderCommandHelp(help);
}

function parsedName(parsed: ParsedCliArguments): string {
  return parsed.help?.name ?? parsed.family?.name ?? parsed.mode;
}

function familyOutput(family: CliCommandFamily, json: boolean): string {
  const names = family.commands.map((entry) => entry.name);
  if (json) return jsonOutput(family.name, true, { family: family.name, commands: names });
  const width = Math.max(...names.map((name) => name.length));
  const commands = family.commands.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`).join("\n");
  return (
    `Usage: vestra ${family.name} <command> [options]\n\nCommands:\n${commands}\n\n` +
    `Add --help after a command for its options.\n`
  );
}
