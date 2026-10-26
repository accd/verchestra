import type { CliCommand, CommandBus } from "@verchestra/application";
import { PublicErrorException } from "@verchestra/domain";
import {
  SafeInitService,
  buildCanonicalInitFiles,
  buildProbeScaffoldFiles,
  defaultProbeScaffoldDirectory,
  isProbeScaffoldDirectory,
  isProbeScaffoldEngine,
  type ProbeScaffoldEngine
} from "@verchestra/workspace";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";
import { installedReleaseManifest } from "./release-manifest.ts";

// why: ARQ-005 (#597). The command bus has its own module because both the
// entry point and the self-test composition build one; when it lived in
// main.ts the two modules imported each other.
// why: the probe scaffold rides the same preview/apply transaction as the
// canonical files, so --dry-run, path safety, the ownership manifest, and the
// receipt cover it without a second writer. Its options are validated here so
// a mistake is an argument error, not an internal one.
function probeScaffoldDirectory(options: CliCommand["options"], engine: ProbeScaffoldEngine): string {
  const directory = options["probe-dir"];
  if (directory === undefined) return defaultProbeScaffoldDirectory(engine);
  if (typeof directory !== "string" || !isProbeScaffoldDirectory(directory))
    throw cliError(
      "VES_CLI_ARGUMENT_INVALID",
      { argument: "--probe-dir" },
      "Probe directory must be a lowercase path under .verchestra/probes/"
    );
  return directory;
}

function probeScaffoldFiles(options: CliCommand["options"]): Readonly<Record<string, string>> {
  const engine = options["probe-engine"];
  if (engine === undefined) {
    for (const name of ["probe-language", "probe-dir"])
      if (options[name] !== undefined)
        throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${name}` }, "Probe option needs --probe-engine");
    return {};
  }
  if (typeof engine !== "string" || !isProbeScaffoldEngine(engine))
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--probe-engine" }, "Probe engine is not supported");
  const language = options["probe-language"];
  if (language !== undefined && language !== "typescript")
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--probe-language" }, "Probe language is not supported");
  return buildProbeScaffoldFiles({
    engine,
    language: "typescript",
    directory: probeScaffoldDirectory(options, engine)
  });
}

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
        const files = {
          ...buildCanonicalInitFiles({
            workspaceId,
            displayName,
            placementMode: placement,
            generatorVersion: installedReleaseManifest.semanticVersion
          }),
          ...probeScaffoldFiles(command.options)
        };
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
