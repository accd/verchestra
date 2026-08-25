import { constants } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import type { ActivationClosurePort, LauncherHandoffOutcome, VerifiedLauncherTarget } from "./activation-closure.ts";
import { loadPinnedInputs, type PinnedLauncherInputs } from "./pinned-inputs.ts";
import { LauncherBootstrapError, diagnosticCodeOf, exitCodeFor, renderPublicError } from "./public-errors.ts";
import { supportedHost, type LauncherHost } from "./supported-host.ts";

// AD-016. Ambient Node is a bootstrap boundary and nothing else: it validates
// the host, loads the pinned public release inputs, drives the activation
// closure, and then transfers control to the activated hermetic release. This
// module imports only Node built-ins and its own siblings — never a workspace
// package, never a TypeScript source, never anything resolved at install or run
// time. The qualified TUF and activation code reaches it through
// `ActivationClosurePort`, which the build inlines at bundle time.
//
// Every step before the handoff is fail-closed. A build that carries no closure
// resolves nothing and executes nothing; an activation that cannot complete
// reports a stable public code and the canonical diagnostic code, never a path,
// a URL, or an upstream message.

const MAXIMUM_EXIT_STATUS = 255;
const SIGNAL_EXIT_BASE = 128;

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

function assertArgumentVector(args: readonly string[]): readonly string[] {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string"))
    throw new LauncherBootstrapError("VES_VESTRA_INPUTS_INVALID", "vestra arguments must be a string vector");
  if (args.some((argument) => argument.includes("\0")))
    throw new LauncherBootstrapError("VES_VESTRA_INPUTS_INVALID", "a vestra argument contains a null byte");
  return args;
}

/** A closure result is trusted only after it names two absolute executables. */
function assertVerifiedTarget(target: VerifiedLauncherTarget): VerifiedLauncherTarget {
  const paths = [target?.runtimeExecutable, target?.launcherPath];
  if (paths.some((path) => typeof path !== "string" || path.length === 0 || !isAbsolute(path)))
    throw new LauncherBootstrapError(
      "VES_VESTRA_ACTIVATION_UNAVAILABLE",
      "the activation closure returned no verified launcher location"
    );
  return target;
}

async function activateVerifiedRelease(
  closure: ActivationClosurePort,
  plan: BootstrapPlan
): Promise<VerifiedLauncherTarget> {
  try {
    return assertVerifiedTarget(
      await closure.activate({ host: plan.host, source: plan.inputs.source, trustedRoot: plan.inputs.trustedRoot })
    );
  } catch (error) {
    if (error instanceof LauncherBootstrapError) throw error;
    throw new LauncherBootstrapError(
      "VES_VESTRA_ACTIVATION_UNAVAILABLE",
      "vestra could not resolve and activate its pinned verified release",
      diagnosticCodeOf(error)
    );
  }
}

async function transferControl(
  closure: ActivationClosurePort,
  target: VerifiedLauncherTarget,
  args: readonly string[]
): Promise<LauncherHandoffOutcome> {
  try {
    return await closure.handoff({ target, args });
  } catch (error) {
    if (error instanceof LauncherBootstrapError) throw error;
    throw new LauncherBootstrapError(
      "VES_VESTRA_LAUNCH_FAILED",
      "vestra could not transfer control to the activated launcher",
      diagnosticCodeOf(error)
    );
  }
}

/**
 * The activated child's result becomes this process's result. A signal is
 * reported the way a shell reports one, so a terminated launcher is never
 * mistaken for a clean exit.
 */
export function exitStatusOf(outcome: LauncherHandoffOutcome): number {
  if (outcome?.signal != null) {
    const number = (constants.signals as unknown as Readonly<Record<string, number | undefined>>)[outcome.signal];
    return SIGNAL_EXIT_BASE + (typeof number === "number" ? number : 0);
  }
  const status = outcome?.exitCode;
  if (!Number.isSafeInteger(status) || (status as number) < 0 || (status as number) > MAXIMUM_EXIT_STATUS)
    throw new LauncherBootstrapError(
      "VES_VESTRA_LAUNCH_FAILED",
      "the activated launcher reported no usable termination status"
    );
  return status as number;
}

export async function runBootstrap(
  args: readonly string[],
  context: BootstrapContext = {
    platform: process.platform,
    arch: process.arch,
    packageRoot: packageRootOf(import.meta.url)
  },
  write: (line: string) => void = (line) => process.stderr.write(line),
  closure?: ActivationClosurePort
): Promise<number> {
  try {
    const argv = assertArgumentVector(args);
    const plan = await planBootstrap(context);
    if (closure === undefined)
      throw new LauncherBootstrapError(
        "VES_VESTRA_ACTIVATION_UNAVAILABLE",
        "this build carries no activation closure, so no release can be resolved or executed"
      );
    const target = await activateVerifiedRelease(closure, plan);
    return exitStatusOf(await transferControl(closure, target, argv));
  } catch (error) {
    write(`${renderPublicError(error)}\n`);
    return exitCodeFor(error);
  }
}
