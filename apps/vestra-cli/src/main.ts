import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliCommand, CommandBus, CommandResult } from "@verchestra/application";
import { doctorExitCode } from "@verchestra/application";
import { PublicErrorException } from "@verchestra/domain";
import { SafeInitService, buildCanonicalInitFiles } from "@verchestra/workspace";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";
import { runCli } from "./cli.ts";
import { runDoctorDeep } from "./doctor-composition.ts";
import { installedReleaseManifest, isSealedRelease } from "./release-manifest.ts";
import { runSelfTestProfile } from "./self-test-composition.ts";

// The command bus is parameterized by controlRoot so the exact same
// controller path this function drives in production can be reused by the
// T70 self-test smoke profile against a disposable root, instead of the
// real repository root.
export function createCommandBus(controlRoot: string): CommandBus {
  return {
    async execute(command) {
      if (command.name === "init") {
        const workspaceId = command.options["workspace-id"];
        const displayName = command.options["name"];
        const placement = command.options["placement"];
        if (workspaceId === undefined || typeof workspaceId !== "string")
          throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--workspace-id" }, "Workspace identity is required");
        if (displayName === undefined || typeof displayName !== "string")
          throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--name" }, "Workspace name is required");
        if (placement !== "centralized" && placement !== "colocated")
          throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--placement" }, "Workspace placement is required");
        const files = buildCanonicalInitFiles({
          workspaceId,
          displayName,
          placementMode: placement,
          generatorVersion: installedReleaseManifest.semanticVersion
        });
        const service = new SafeInitService();
        const preview = await service.preview({ controlRoot, files });
        if (command.options["dry-run"] === true) return { data: preview, diagnostics: [] };
        return { data: { preview, receipt: await service.apply(preview) }, diagnostics: [] };
      }
      throw new PublicErrorException(
        cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command: command.name }),
        "Command composition is not available in this release slice"
      );
    }
  };
}

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
    run = await runDoctorDeep({
      controlRoot: process.cwd(),
      live: installRoot === undefined ? {} : { installRoot }
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
      execute: (command, context) =>
        command.name === "self-test"
          ? executeSelfTest(command)
          : command.name === "doctor"
            ? executeDoctor(command)
            : commandBus.execute(command, context)
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value)
  });
}
