import { PublicErrorException } from "@verchestra/domain";
import { SafeInitService, buildCanonicalInitFiles } from "@verchestra/workspace";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";
import { runCli } from "./cli.ts";
import { installedReleaseManifest } from "./release-manifest.ts";

export async function main(invokedAs: string, argv: readonly string[]): Promise<number> {
  return runCli({
    argv,
    invokedAs,
    installedManifest: installedReleaseManifest,
    // The running executable and the manifest it ships with are the same build,
    // so they cannot disagree about which version this is.
    installedCliVersion: installedReleaseManifest.semanticVersion,
    commandBus: {
      async execute(command) {
        if (command.name === "init") {
          const workspaceId = command.options["workspace-id"];
          const displayName = command.options["name"];
          const placement = command.options["placement"];
          if (workspaceId === undefined || typeof workspaceId !== "string")
            throw cliError(
              "VES_CLI_ARGUMENT_INVALID",
              { argument: "--workspace-id" },
              "Workspace identity is required"
            );
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
          const preview = await service.preview({ controlRoot: process.cwd(), files });
          if (command.options["dry-run"] === true) return { data: preview, diagnostics: [] };
          return { data: { preview, receipt: await service.apply(preview) }, diagnostics: [] };
        }
        throw new PublicErrorException(
          cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command: command.name }),
          "Command composition is not available in this release slice"
        );
      }
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value)
  });
}
