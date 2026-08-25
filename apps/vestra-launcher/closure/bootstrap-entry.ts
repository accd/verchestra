import { runBootstrap as runVerifiedBootstrap, type BootstrapContext } from "../src/bootstrap.ts";
import { NodeActivationClosure, machineLocalEnvironment } from "./node-activation-closure.ts";

// The bundle entry point, and the only wiring the published `bin/vestra.mjs`
// ever reaches. It exists so the published bootstrap can stay free of every
// workspace import while still shipping a real activation closure: the build
// bundles this module, and `lib/bootstrap.js` is the result.
//
// The wiring is deliberately one expression with no configuration, no branch,
// and no environment read. `machineLocalEnvironment` is named here in full so
// the composition a published tarball performs is greppable in one line.

export async function runBootstrap(
  args: readonly string[],
  context?: BootstrapContext,
  write?: (line: string) => void
): Promise<number> {
  return await runVerifiedBootstrap(args, context, write, new NodeActivationClosure(machineLocalEnvironment));
}
