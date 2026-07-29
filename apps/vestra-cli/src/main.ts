import { PublicErrorException } from "@verchestra/domain";

import { cliPublicErrorRegistry } from "./cli-errors.ts";
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
