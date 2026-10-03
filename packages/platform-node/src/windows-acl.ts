// invariant: Windows ignores POSIX modes, so a per-run directory that holds
// bridge material is made owner-only through its ACL and then proven so by
// reading the ACL back (SSI-73, AD-074). Both programs are native System32
// tools reached by absolute path, never through PATH: `whoami` names the
// current user's SID, and `icacls` restores the directory's whole DACL from a
// file that holds one protected, inheritable full-control entry for that SID,
// then saves the result as SDDL. Anything short of exactly that DACL is no proof.
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { runBoundedChild } from "./bounded-child-run.ts";
import { systemRoot } from "./os-secret-backends/windows-credential-manager.ts";

export type WindowsAclTool = "whoami" | "icacls";

// invariant: resolves with the tool's standard output when it exits 0 and
// rejects otherwise; no output text ever reaches an error.
export type WindowsAclToolRunner = (tool: WindowsAclTool, args: readonly string[]) => Promise<string>;

export type OwnerOnlyProof =
  | { readonly proven: true; readonly sid: string; readonly dacl: string }
  | { readonly proven: false; readonly step: "identity" | "replace" | "read-back" | "verify" };

export const WHOAMI_ARGUMENTS = Object.freeze(["/user", "/fo", "csv", "/nh"]);
// why: the saved DACL is written inside the directory it describes, so it
// inherits the owner-only entry the moment it exists.
const SAVED_ACL = "owner-only.acl";
// why: the DACL to restore lives beside the per-run directory, never inside
// it, so it cannot be taken for bridge material, and it is removed whatever
// the restore does.
const RESTORE_SUFFIX = ".owner-only-restore.acl";
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

// why: measured on a hosted Windows runner, `/inheritance:r /grant:r` added the
// owner but left SYSTEM and Administrators as explicit entries, so the DACL
// is replaced whole instead of edited.
export function ownerOnlyDacl(sid: string): string {
  if (!SID.test(sid)) throw new TypeError("not a SID");
  return `D:PAI(A;OICI;FA;;;${sid})`;
}

export interface OwnerOnlyRestore {
  readonly file: string;
  readonly contents: Buffer;
  readonly args: readonly string[];
}

// invariant: the file is in the `/save` format `/restore` reads: UTF-16LE with
// no byte-order mark (icacls would read one as part of the name), the
// directory's base name on the first line, its DACL on the second. `/restore`
// applies it to that name inside the parent directory.
export function ownerOnlyRestore(directory: string, sid: string): OwnerOnlyRestore {
  const parent = dirname(directory);
  const name = basename(directory);
  const file = join(parent, `${name}${RESTORE_SUFFIX}`);
  return Object.freeze({
    file,
    contents: Buffer.from(`${name}\r\n${ownerOnlyDacl(sid)}\r\n`, "utf16le"),
    args: Object.freeze([parent, "/restore", file])
  });
}

// why: `icacls /save` writes Unicode (UTF-16LE) by default, one line naming
// the entry and one line with its DACL in SDDL.
export function savedDacl(saved: Uint8Array): string | undefined {
  const bytes = Buffer.from(saved);
  const wide = bytes.length > 1 && (bytes[1] === 0 || (bytes[0] === 0xff && bytes[1] === 0xfe));
  const text = bytes.toString(wide ? "utf16le" : "utf8").replace(/^﻿/u, "");
  return text.split(/\r?\n/u).find((line) => line.startsWith("D:"));
}

const MACHINE_RELATIVE = /^S-1-5-21-\d{1,10}-\d{1,10}-\d{1,10}-(\d{1,10})$/u;

// why: SDDL writes some SIDs as two-letter aliases, so the owner's one entry
// may read back as an alias rather than the SID whoami printed: the local
// Administrator (RID 500 of the account domain) as LA, the local Guest (RID
// 501) as LG, and LocalSystem, LocalService, and NetworkService as SY, LS, and
// NS. LA and LG are accepted only for a SID of that shape with that RID. A
// domain account with RID 500 shares the shape; an LA entry could stand for it
// only if a process of the same user changed the DACL between the restore and
// the read-back, which the threat model's assumptions (D7) put out of scope,
// and the local Administrator is an administrator, outside the protection
// boundary in any case. No other alias names the owner: BA, SY, or any group
// beside the user is never accepted.
const OWNER_ALIASES: Readonly<Record<string, (sid: string) => boolean>> = Object.freeze({
  LA: (sid: string) => MACHINE_RELATIVE.exec(sid)?.[1] === "500",
  LG: (sid: string) => MACHINE_RELATIVE.exec(sid)?.[1] === "501",
  SY: (sid: string) => sid === "S-1-5-18",
  LS: (sid: string) => sid === "S-1-5-19",
  NS: (sid: string) => sid === "S-1-5-20"
});

function namesOwner(trustee: string, sid: string): boolean {
  if (trustee === sid) return true;
  const alias = Object.hasOwn(OWNER_ALIASES, trustee) ? OWNER_ALIASES[trustee] : undefined;
  return alias?.(sid) === true;
}

// invariant: owner-only means a protected DACL holding exactly one entry: an
// allow of full access to `sid` (or the alias SDDL writes for it), inherited
// by files and subdirectories, with no object type and no other trustee.
export function isOwnerOnlyDacl(dacl: string, sid: string): boolean {
  const match = DACL.exec(dacl);
  if (match === null || !(match[1] ?? "").includes("P")) return false;
  const entry = /^A;(?:OICI|CIOI);FA;;;([A-Z0-9-]+)$/u.exec((match[2] ?? "").slice(1, -1));
  return entry?.[1] !== undefined && namesOwner(entry[1], sid);
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

async function replaceDacl(directory: string, sid: string, runner: WindowsAclToolRunner): Promise<boolean> {
  const restore = ownerOnlyRestore(directory, sid);
  try {
    const written = await attempt(async () => {
      await writeFile(restore.file, restore.contents, { flag: "wx", mode: 0o600 });
      return true;
    });
    if (written === undefined) return false;
    return (await attempt(() => runner("icacls", restore.args))) !== undefined;
  } finally {
    await rm(restore.file, { force: true });
  }
}

export async function proveOwnerOnlyDirectory(
  directory: string,
  runner: WindowsAclToolRunner = nodeWindowsAclToolRunner
): Promise<OwnerOnlyProof> {
  const identity = await attempt(() => runner("whoami", WHOAMI_ARGUMENTS));
  const sid = identity === undefined ? undefined : currentUserSid(identity);
  if (sid === undefined) return Object.freeze({ proven: false, step: "identity" });
  if (!(await replaceDacl(directory, sid, runner))) return Object.freeze({ proven: false, step: "replace" });
  const dacl = await readDirectoryDacl(directory, runner);
  if (dacl === undefined) return Object.freeze({ proven: false, step: "read-back" });
  if (!isOwnerOnlyDacl(dacl, sid)) return Object.freeze({ proven: false, step: "verify" });
  return Object.freeze({ proven: true, sid, dacl });
}
