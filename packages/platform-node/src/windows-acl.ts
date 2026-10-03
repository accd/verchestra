// invariant: Windows ignores POSIX modes, so a per-run directory that holds
// bridge material is made owner-only through its ACL and then proven so by
// reading the ACL back (SSI-73, AD-074). Both programs are native System32
// tools reached by absolute path, never through PATH: `whoami` names the
// current user's SID, and `icacls` replaces the DACL with one inheritable
// full-control entry for that SID, inheritance from the parent removed, and
// saves the result as SDDL. Anything short of exactly that DACL is no proof.
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBoundedChild } from "./bounded-child-run.ts";
import { systemRoot } from "./os-secret-backends/windows-credential-manager.ts";

export type WindowsAclTool = "whoami" | "icacls";

// invariant: resolves with the tool's standard output when it exits 0 and
// rejects otherwise; no output text ever reaches an error.
export type WindowsAclToolRunner = (tool: WindowsAclTool, args: readonly string[]) => Promise<string>;

export type OwnerOnlyProof =
  | { readonly proven: true; readonly sid: string; readonly dacl: string }
  | { readonly proven: false; readonly step: "identity" | "grant" | "read-back" | "verify" };

export const WHOAMI_ARGUMENTS = Object.freeze(["/user", "/fo", "csv", "/nh"]);
// why: the saved DACL is written inside the directory it describes, so it
// inherits the owner-only entry the moment it exists.
const SAVED_ACL = "owner-only.acl";
const TOOL_TIMEOUT_MS = 10_000;
const MAXIMUM_TOOL_OUTPUT = 64 * 1024;
const SID = /^S-1-\d{1,10}(?:-\d{1,10}){1,15}$/u;
const DACL = /^D:([A-Z]*)((?:\([^()]*\))+)$/u;

export function windowsAclToolExecutable(tool: WindowsAclTool): string {
  return `${systemRoot()}\\System32\\${tool}.exe`;
}

// why: through the one routine that bounds a child of platform-node in time
// and output and stops its whole tree at either bound.
export const nodeWindowsAclToolRunner: WindowsAclToolRunner = async (tool, args) => {
  const root = systemRoot();
  const stdout: Buffer[] = [];
  const observation = await runBoundedChild({
    executable: windowsAclToolExecutable(tool),
    args,
    cwd: tmpdir(),
    env: { SystemRoot: root, windir: root },
    timeoutMs: TOOL_TIMEOUT_MS,
    outputLimitBytes: MAXIMUM_TOOL_OUTPUT,
    observe: (stream, chunk) => {
      if (stream === "stdout") stdout.push(chunk);
    },
    incomplete: () => {
      throw new Error(`${tool} outlived its termination`);
    }
  });
  if (
    observation.ended !== "exited" ||
    observation.exitCode !== 0 ||
    observation.timedOut ||
    observation.outputLimitExceeded
  )
    throw new Error(`${tool} did not succeed`);
  return Buffer.concat(stdout).toString("utf8");
};

// invariant: `whoami /user /fo csv /nh` prints one row, `"<account>","<SID>"`;
// the account name may be localized, the SID never is.
export function currentUserSid(whoamiOutput: string): string | undefined {
  const rows = whoamiOutput.trim().split(/\r?\n/u);
  if (rows.length !== 1) return undefined;
  const sid = /,"([^"]+)"$/u.exec(rows[0] ?? "")?.[1];
  return sid !== undefined && SID.test(sid) ? sid : undefined;
}

export function ownerOnlyGrantArguments(directory: string, sid: string): readonly string[] {
  if (!SID.test(sid)) throw new TypeError("not a SID");
  return Object.freeze([directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
}

// why: `icacls /save` writes Unicode (UTF-16LE) by default, one line naming
// the entry and one line with its DACL in SDDL.
export function savedDacl(saved: Uint8Array): string | undefined {
  const bytes = Buffer.from(saved);
  const wide = bytes.length > 1 && (bytes[1] === 0 || (bytes[0] === 0xff && bytes[1] === 0xfe));
  const text = bytes.toString(wide ? "utf16le" : "utf8").replace(/^﻿/u, "");
  return text.split(/\r?\n/u).find((line) => line.startsWith("D:"));
}

// invariant: owner-only means a protected DACL holding exactly one entry: an
// allow of full access to `sid`, inherited by files and subdirectories, with
// no object type and no other trustee.
export function isOwnerOnlyDacl(dacl: string, sid: string): boolean {
  const match = DACL.exec(dacl);
  if (match === null || !(match[1] ?? "").includes("P")) return false;
  const entry = (match[2] ?? "").slice(1, -1);
  return entry === `A;OICI;FA;;;${sid}` || entry === `A;CIOI;FA;;;${sid}`;
}

async function attempt<T>(step: () => Promise<T>): Promise<T | undefined> {
  try {
    return await step();
  } catch {
    return undefined;
  }
}

// invariant: reads the directory's DACL as the system stores it, through the
// same tool that set it, and leaves no saved file behind.
export async function readDirectoryDacl(
  directory: string,
  runner: WindowsAclToolRunner = nodeWindowsAclToolRunner
): Promise<string | undefined> {
  const saved = join(directory, SAVED_ACL);
  try {
    if ((await attempt(() => runner("icacls", [directory, "/save", saved]))) === undefined) return undefined;
    const bytes = await attempt(() => readFile(saved));
    return bytes === undefined ? undefined : savedDacl(bytes);
  } finally {
    await rm(saved, { force: true });
  }
}

export async function proveOwnerOnlyDirectory(
  directory: string,
  runner: WindowsAclToolRunner = nodeWindowsAclToolRunner
): Promise<OwnerOnlyProof> {
  const identity = await attempt(() => runner("whoami", WHOAMI_ARGUMENTS));
  const sid = identity === undefined ? undefined : currentUserSid(identity);
  if (sid === undefined) return Object.freeze({ proven: false, step: "identity" });
  if ((await attempt(() => runner("icacls", ownerOnlyGrantArguments(directory, sid)))) === undefined)
    return Object.freeze({ proven: false, step: "grant" });
  const dacl = await readDirectoryDacl(directory, runner);
  if (dacl === undefined) return Object.freeze({ proven: false, step: "read-back" });
  if (!isOwnerOnlyDacl(dacl, sid)) return Object.freeze({ proven: false, step: "verify" });
  return Object.freeze({ proven: true, sid, dacl });
}
