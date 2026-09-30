// hazard: Windows Credential Manager has no disposable instance; the only
// store is the invoking user's own. This helper therefore confines the
// real-store qualification suite (`pnpm qualify:keychain`, #379) to targets
// under a fresh random Workspace ID, so no case can name, overwrite, or delete
// a credential it did not create, and every case deletes its targets in
// `finally`. It never runs in a gate suite.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createOsCredentialStore, powershellExecutable } from "../../../packages/platform-node/src/index.ts";

export const TARGET_TIMEOUT_MS = 30_000;

export function randomWorkspaceId() {
  return `workspace_${randomUUID()}`;
}

function cmdkey() {
  return powershellExecutable().replace(/WindowsPowerShell\\v1\.0\\powershell\.exe$/u, "cmdkey.exe");
}

// invariant: an independent witness. `cmdkey /list:<target>` reads Credential
// Manager through a different program than the backend and prints the target,
// its type, user, and persistence, never the value.
export function describeTarget(target) {
  const result = spawnSync(cmdkey(), [`/list:${target}`], {
    encoding: "utf8",
    timeout: TARGET_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`cmdkey /list failed (exit ${result.status})`);
  return result.stdout;
}

// why: measured — `cmdkey /list:<target>` prints a generic credential written
// through CredWriteW as `Target: <target>`, with no `LegacyGeneric:` prefix.
export function isListed(target) {
  return describeTarget(target)
    .split(/\r?\n/u)
    .some((line) => line.trim() === `Target: ${target}`);
}

// invariant: every name the caller used under the random Workspace is deleted
// through the product backend, and the witness then confirms it is gone.
export async function withRandomTargets(names, body, options = {}) {
  const workspaceId = randomWorkspaceId();
  const store = createOsCredentialStore({ platform: "win32", ...options });
  try {
    await body({ workspaceId, store, target: (name) => `verchestra/${workspaceId}/${name}` });
  } finally {
    const cleanup = createOsCredentialStore({ platform: "win32" });
    for (const name of names) await cleanup.delete(workspaceId, name);
    for (const name of names)
      if (isListed(`verchestra/${workspaceId}/${name}`)) throw new Error(`cleanup left ${name} behind`);
  }
}
