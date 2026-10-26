import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliCommand, CommandResult } from "@verchestra/application";
import { doctorExitCode } from "@verchestra/application";
import { PublicErrorException } from "@verchestra/domain";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";
import { runCli } from "./cli.ts";
import { createCommandBus } from "./command-bus.ts";
import { runDoctorDeep } from "./doctor-composition.ts";
import { installedReleaseManifest, isSealedRelease } from "./release-manifest.ts";
import { runSelfTestProfile } from "./self-test-composition.ts";

// The self-test command is composed here, not inside createCommandBus:
// createCommandBus is also reused by the T69/T70 trust domain itself (its
// scenarios drive `init` through it), and the self-test command's own
// TEST-ONLY signing identity must never be reachable from inside a run it
// composes.
async function executeSelfTest(command: CliCommand): Promise<CommandResult> {
  const profileId = command.options["profile"];
  if (profileId !== "smoke" && profileId !== "workspace" && profileId !== "full" && profileId !== "drivers")
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--profile" }, "Self-test profile is required");
  let sealed: Awaited<ReturnType<typeof runSelfTestProfile>>;
  try {
    sealed = await runSelfTestProfile(profileId, { controlRoot: process.cwd() });
  } catch (error) {
    throw new PublicErrorException(
      cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command: command.name }),
      "Self-test could not complete",
      { cause: error }
    );
  }
  if (sealed.result.payload["self_test.verdict"] !== "PASS") {
    throw new PublicErrorException(
      cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command: command.name }),
      "Self-test reported a non-PASS verdict"
    );
  }
  return { data: sealed.result.payload, diagnostics: [] };
}

// Composed here, not in createCommandBus, for the same reason as self-test: the
// diagnostic's TEST-ONLY signing identity must not be reachable from the
// mutating command path. A non-PASS verdict is a health signal, not a command
// error, so the report is still rendered and the exit code carries the state.
// The install root of the release this process is actually part of, derived
// from the sealed bundle's own location — the launcher activates a release to
// <installRoot>/releases/<digest>/bin/vestra.mjs (node-activation-closure.ts),
// which this file is bundled into, so three levels up from that bin directory
// is the install root that also holds active.json. Deriving it from the running
// bundle rather than the machine's canonical state root keeps the observation
// about THIS release, and keeps a staged or relocated bundle honestly blocked
// instead of borrowing an unrelated install's activation record. A source
// checkout has no install to inspect, so the native-asset probe stays honestly
// blocked there (#18, L2).
function activeInstallRoot(): string | undefined {
  if (!isSealedRelease()) return undefined;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  } catch {
    return undefined;
  }
}

async function executeDoctor(command: CliCommand): Promise<CommandResult> {
  let run: Awaited<ReturnType<typeof runDoctorDeep>>;
  try {
    const installRoot = activeInstallRoot();
    const keychain = command.options["keychain"];
    // why: a dynamic import, like self-test's scenarios, so commands that never
    // touch a credential store never load it.
    const { composeDoctorSecretProbe } = await import("./secret-composition.ts");
    const secretProbe = await composeDoctorSecretProbe({
      controlRoot: process.cwd(),
      platform: process.platform,
      env: process.env,
      homeDirectory: homedir(),
      ...(typeof keychain === "string" ? { keychainPath: keychain } : {})
    });
    run = await runDoctorDeep({
      controlRoot: process.cwd(),
      live: { ...(installRoot === undefined ? {} : { installRoot }), ...secretProbe }
    });
  } catch (error) {
    throw new PublicErrorException(
      cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command: command.name }),
      "Doctor could not complete",
      { cause: error }
    );
  }
  return { data: run.payload, diagnostics: [], exitCode: doctorExitCode(run.verdict) };
}

async function executeSecret(command: CliCommand): Promise<CommandResult> {
  const { executeSecretCommand } = await import("./secret-composition.ts");
  return executeSecretCommand(command, {
    controlRoot: process.cwd(),
    platform: process.platform,
    stdin: process.stdin,
    stderr: (value) => process.stderr.write(value)
  });
}

async function executeTask(command: CliCommand): Promise<CommandResult> {
  // why: a dynamic import, like secret and self-test, so only `vestra task`
  // loads the governed task composition and the runtime store it opens.
  const { executeTaskCommand } = await import("./task/task-command.ts");
  return executeTaskCommand(command, {
    controlRoot: process.cwd(),
    platform: process.platform,
    env: process.env,
    stdin: process.stdin,
    stderr: (value) => process.stderr.write(value),
    pid: process.pid
  });
}

export async function main(invokedAs: string, argv: readonly string[]): Promise<number> {
  const commandBus = createCommandBus(process.cwd());
  return runCli({
    argv,
    invokedAs,
    installedManifest: installedReleaseManifest,
    // The running executable and the manifest it ships with are the same build,
    // so they cannot disagree about which version this is.
    installedCliVersion: installedReleaseManifest.semanticVersion,
    commandBus: {
      execute: (command, context) => {
        if (command.name === "self-test") return executeSelfTest(command);
        if (command.name === "doctor") return executeDoctor(command);
        if (command.name.startsWith("secret ")) return executeSecret(command);
        if (command.name.startsWith("task ")) return executeTask(command);
        return commandBus.execute(command, context);
      }
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value)
  });
}
