import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPinnedInputs, type PinnedLauncherInputs } from "./pinned-inputs.ts";
import { LauncherBootstrapError, exitCodeFor, renderPublicError } from "./public-errors.ts";
import { supportedHost, type LauncherHost } from "./supported-host.ts";

// AD-016. Ambient Node is a bootstrap boundary and nothing else: it validates
// the host, loads the pinned public release inputs, and then transfers control
// to the activated hermetic closure. This module therefore imports only Node
// built-ins and its own siblings — never a workspace package, never a
// TypeScript source, never anything resolved at install or run time.
//
// The transfer step is not implemented yet, and it fails closed rather than
// approximating one. It needs two things this repository does not have: T76's
// real trust root, source URLs, and executable candidate release, and an owner
// decision on how the qualified TUF and activation code is emitted into a
// public tarball without a workspace import. Until both exist, `npx vestra`
// must say so with a stable public code instead of resolving anything.

export interface BootstrapContext {
  readonly platform: string;
  readonly arch: string;
  readonly packageRoot: string;
}

export interface BootstrapPlan {
  readonly host: LauncherHost;
  readonly inputs: PinnedLauncherInputs;
}

/** The installed package root, derived from this module's own location. */
export function packageRootOf(moduleUrl: string): string {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/**
 * Everything the bootstrap can decide before control leaves ambient Node.
 * Exported so the decision is testable without spawning anything.
 */
export async function planBootstrap(context: BootstrapContext): Promise<BootstrapPlan> {
  const host = supportedHost({ platform: context.platform, arch: context.arch });
  const inputs = await loadPinnedInputs(context.packageRoot);
  return Object.freeze({ host, inputs });
}

export async function runBootstrap(
  args: readonly string[],
  context: BootstrapContext = {
    platform: process.platform,
    arch: process.arch,
    packageRoot: packageRootOf(import.meta.url)
  },
  write: (line: string) => void = (line) => process.stderr.write(line)
): Promise<number> {
  try {
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string"))
      throw new LauncherBootstrapError("VES_VESTRA_INPUTS_INVALID", "vestra arguments must be a string vector");
    await planBootstrap(context);
    throw new LauncherBootstrapError(
      "VES_VESTRA_ACTIVATION_UNAVAILABLE",
      "this build carries no activation closure, so no release can be resolved or executed"
    );
  } catch (error) {
    write(`${renderPublicError(error)}\n`);
    return exitCodeFor(error);
  }
}
