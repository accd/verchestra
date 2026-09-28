// hazard: this throwaway macOS keychain serves credential-store tests (#379),
// and a keychain operation that can raise a GUI dialog (an unlock prompt,
// an access-control prompt) hangs an unattended run and asks the owner for a
// password they do not know. Every rule below exists to make that impossible:
// - the keychain is created with an explicit random password, unlocked with
//   it, and set to never auto-lock before anything touches it;
// - it is never added to the user's search list or made the default, and the
//   helper proves both stayed byte-identical;
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

export const SECURITY = "/usr/bin/security";
export const SECURITY_TIMEOUT_MS = 10_000;

export function security(args, options = {}) {
  const result = spawnSync(SECURITY, args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? SECURITY_TIMEOUT_MS,
    killSignal: "SIGKILL",
    ...(options.input === undefined ? { stdio: ["ignore", "pipe", "pipe"] } : { input: options.input })
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL")
    throw new Error(`security ${args[0]} timed out — a keychain prompt may have been raised`);
  return result;
}

function userKeychainState() {
  return {
    searchList: security(["list-keychains", "-d", "user"]).stdout,
    defaultKeychain: security(["default-keychain", "-d", "user"]).stdout
  };
}

export async function createDisposableKeychain() {
  const before = userKeychainState();
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
  const after = userKeychainState();
  if (after.searchList !== before.searchList || after.defaultKeychain !== before.defaultKeychain) {
    await destroy(path, directory);
    throw new Error("creating the disposable keychain changed the user's keychain search list or default");
  }
  return Object.freeze({
    path,
    directory,
    userState: before,
    async dispose() {
      await destroy(path, directory);
      const final = userKeychainState();
      if (final.searchList !== before.searchList || final.defaultKeychain !== before.defaultKeychain)
        throw new Error("the user's keychain search list or default changed during the test");
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

// invariant: an attribute-only lookup of a service across the user's search
// list. It never retrieves a value; exit 44 proves no item with that service name exists in
// the login keychain (or any other searched keychain).
export function searchListLookupStatus(service) {
  return security(["find-generic-password", "-s", service]).status;
}
