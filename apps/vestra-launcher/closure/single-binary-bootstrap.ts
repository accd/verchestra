import { getAsset } from "node:sea";

import { planBootstrap, runBootstrap, type BootstrapContext } from "../src/bootstrap.ts";
import type { ActivationClosurePort } from "../src/activation-closure.ts";
import type { PinnedConfigReader } from "../src/pinned-inputs.ts";
import { LauncherBootstrapError, exitCodeFor, renderPublicError } from "../src/public-errors.ts";
import { NodeActivationClosure, machineLocalEnvironment } from "./node-activation-closure.ts";

// why: #236 ships a second launcher channel, and a second channel is only as
// trustworthy as its difference from the first. This build input, bundled by
// scripts/build-vestra-binary.mjs into the single executable's main script,
// composes exactly what the npm channel composes — the shared bootstrap, the
// same activation closure, the same machine-local environment — and differs in
// two places only: the pinned inputs are read from the executable's own
// embedded assets instead of a package directory, and a lone `--version` is
// answered from those inputs without activating anything.

export const EMBEDDED_CONFIG_KEYS = Object.freeze({
  "release-source.json": "config/release-source.json",
  "root.json": "config/root.json"
} as const);

export type EmbeddedAssetReader = (key: string) => ArrayBuffer;

/**
 * invariant: an embedded input that cannot be read is reported with the same
 * public code a missing packaged input gets, so both channels fail closed
 * identically and no asset-lookup message ever reaches the user.
 */
export function embeddedConfigReader(readAsset: EmbeddedAssetReader = getAsset): PinnedConfigReader {
  return (name) => {
    try {
      return Promise.resolve(new Uint8Array(readAsset(EMBEDDED_CONFIG_KEYS[name])));
    } catch {
      return Promise.reject(
        new LauncherBootstrapError(
          "VES_VESTRA_INPUTS_MISSING",
          `the embedded release configuration ${name} is not present`
        )
      );
    }
  };
}

export interface SingleBinaryIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const processIo: SingleBinaryIo = Object.freeze({
  stdout: (line: string) => process.stdout.write(line),
  stderr: (line: string) => process.stderr.write(line)
});

/**
 * why: an air-gapped operator must be able to identify a binary before it has
 * ever reached a release source, so a lone `--version` is answered from the
 * pinned inputs after the same host and input validation every run performs.
 * Any other argument vector, including `--version` beside other arguments, is
 * handed to the activated release unchanged.
 */
async function reportVersion(context: BootstrapContext, io: SingleBinaryIo): Promise<number> {
  try {
    const plan = await planBootstrap(context);
    io.stdout(
      `vestra ${plan.inputs.source.semanticVersion} (single binary; ` +
        `${plan.host.platform}-${plan.host.arch}; node ${process.version})\n`
    );
    return 0;
  } catch (error) {
    io.stderr(`${renderPublicError(error)}\n`);
    return exitCodeFor(error);
  }
}

const embeddedContext = (): BootstrapContext => ({
  platform: process.platform,
  arch: process.arch,
  readPinnedConfig: embeddedConfigReader()
});

export async function runSingleBinary(
  args: readonly string[],
  context: BootstrapContext = embeddedContext(),
  io: SingleBinaryIo = processIo,
  closure: ActivationClosurePort = new NodeActivationClosure(machineLocalEnvironment)
): Promise<number> {
  if (args.length === 1 && args[0] === "--version") return await reportVersion(context, io);
  return await runBootstrap(args, context, io.stderr, closure);
}
