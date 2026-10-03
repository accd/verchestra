// invariant: the registry reader the composition root hands the Claude Code
// driver for its Windows policy keys (SSI-74). Node has no registry interface,
// so it asks the System32 `reg.exe`, never one found on PATH, whether a key
// exists in the 64-bit view, and reads nothing of what the key holds.
import { tmpdir } from "node:os";

import { runBoundedChild } from "./bounded-child-run.ts";
import { systemRoot } from "./os-secret-backends/windows-credential-manager.ts";

const REGISTRY_KEY = /^HK(?:LM|CU)\\SOFTWARE(?:\\[A-Za-z0-9 ._-]{1,64}){1,8}$/u;
const QUERY_TIMEOUT_MS = 10_000;
const MAXIMUM_QUERY_OUTPUT = 256 * 1024;
// why: `reg query` exits 1 when the key does not exist, and when this user
// may not read it; Claude Code runs as the same user, so it cannot read that
// key either.
const KEY_ABSENT = 1;

// invariant: resolves with the exit status, or null when the query did not run
// to an exit of its own.
export type RegistryQueryRunner = (args: readonly string[]) => Promise<number | null>;

export function regExecutable(): string {
  return `${systemRoot()}\\System32\\reg.exe`;
}

export function registryQueryArguments(key: string): readonly string[] {
  if (!REGISTRY_KEY.test(key)) throw new TypeError("not a registry key under SOFTWARE");
  return Object.freeze(["query", key, "/reg:64"]);
}

export const nodeRegistryQueryRunner: RegistryQueryRunner = async (args) => {
  const root = systemRoot();
  const observation = await runBoundedChild({
    executable: regExecutable(),
    args,
    cwd: tmpdir(),
    env: { SystemRoot: root, windir: root },
    timeoutMs: QUERY_TIMEOUT_MS,
    outputLimitBytes: MAXIMUM_QUERY_OUTPUT,
    incomplete: () => {
      throw new Error("reg.exe outlived its termination");
    }
  });
  if (observation.ended !== "exited" || observation.timedOut || observation.outputLimitExceeded) return null;
  return observation.exitCode;
};

// invariant: a key counts as absent only when the query ran and said so; a
// query that could not run, timed out, or ended any other way leaves it present.
export async function registryKeyPresent(
  key: string,
  runner: RegistryQueryRunner = nodeRegistryQueryRunner
): Promise<boolean> {
  const args = registryQueryArguments(key);
  try {
    return (await runner(args)) !== KEY_ABSENT;
  } catch {
    return true;
  }
}
