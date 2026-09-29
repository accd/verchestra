// hazard: this throwaway macOS keychain serves the real-keychain qualification
// suite (`pnpm qualify:keychain`, #379) and never a gate suite,
// and a keychain operation that can raise a GUI dialog (an unlock prompt,
// an access-control prompt) hangs an unattended run and asks the owner for a
// password they do not know. Every rule below exists to make that impossible:
// - the keychain is created with an explicit random password, unlocked with
//   it, and set to never auto-lock before anything touches it;
// - every `security` call names the disposable keychain file explicitly; no
//   test reads or writes the login keychain, the search list, or the default
//   keychain, not even read-only (a CI machine or a locked session makes any
//   such call fragile);
// - items are written with `-T /usr/bin/security` (the product backend does
//   this), so reads never ask for access approval;
// - every `security` call carries a hard timeout, so a hidden prompt fails the
//   test in seconds instead of hanging it;
// - the keychain is deleted in the caller's `finally`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeSecurityRunner } from "../../../packages/platform-node/src/index.ts";

export const SECURITY = "/usr/bin/security";
export const SECURITY_TIMEOUT_MS = 10_000;

function security(args) {
  const result = spawnSync(SECURITY, args, {
    encoding: "utf8",
    timeout: SECURITY_TIMEOUT_MS,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL")
    throw new Error(`security ${args[0]} timed out — a keychain prompt may have been raised`);
  return result;
}

export async function createDisposableKeychain() {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-keychain-"));
  const path = join(directory, "verchestra-test.keychain-db");
  // hazard: this password is in argv, which is acceptable only because it
  // guards a random, disposable keychain that holds test values alone.
  const password = randomBytes(24).toString("hex");
  const steps = [
    ["create-keychain", "-p", password, path],
    ["unlock-keychain", "-p", password, path],
    ["set-keychain-settings", path]
  ];
  for (const step of steps) {
    const result = security(step);
    if (result.status !== 0) {
      await destroy(path, directory);
      throw new Error(`disposable keychain setup failed at ${step[0]} (exit ${result.status})`);
    }
  }
  return Object.freeze({
    path,
    directory,
    // invariant: attributes only (no -d), from this file only. Returns the
    // sorted `service\0account` pairs so a test can prove exactly which items
    // its commands left in the keychain they named.
    items() {
      const result = security(["dump-keychain", path]);
      if (result.status !== 0) throw new Error(`dump-keychain failed (exit ${result.status})`);
      const items = [];
      for (const block of result.stdout.split(/^keychain: /mu).slice(1)) {
        const service = /"svce"<blob>="([^"]*)"/u.exec(block)?.[1];
        const account = /"acct"<blob>="([^"]*)"/u.exec(block)?.[1];
        if (service !== undefined && account !== undefined) items.push(`${service}\u0000${account}`);
      }
      return items.sort();
    },
    async dispose() {
      await destroy(path, directory);
    }
  });
}

async function destroy(path, directory) {
  try {
    security(["delete-keychain", path]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// invariant: a runner that refuses, before spawning, any `security` call that
// does not name the disposable keychain — the last argv entry for a direct
// command, the last token of the stdin line for `security -i`. It records argv
// only, never stdin, so the log can hold no credential.
export function keychainBoundRunner(path) {
  const commands = [];
  async function runner(invocation) {
    const bound =
      invocation.args[0] === "-i"
        ? Buffer.from(invocation.stdin ?? [])
            .toString("latin1")
            .endsWith(` ${path}\n`)
        : invocation.args.at(-1) === path;
    if (!bound) throw new Error(`security ${invocation.args[0]} does not name the disposable keychain`);
    commands.push(invocation.args[0] === "-i" ? "-i add-generic-password" : invocation.args[0]);
    return nodeSecurityRunner(invocation);
  }
  return Object.freeze({ runner, commands });
}
