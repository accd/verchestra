import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { SkillLock } from "@verchestra/agent-runtime";

import { workspaceTrustRoot } from "../task/task-signing.ts";
import type { TaskWorkspace } from "../task/task-workspace.ts";
import { ExtensionApprovalStore } from "./extension-approval-store.ts";
import { extensionError } from "./extension-errors.ts";

const MAXIMUM_ENTRY_BYTES = 16 * 1024 * 1024;

// invariant: AC 13. The out-of-process probe host is qualified on POSIX only
// (AD-037), so the commands that measure or admit a launch refuse Windows
// before they read anything, with the code the host itself raises.
export function refuseUnsupportedPlatform(platform: string): void {
  if (platform === "win32")
    throw extensionError(
      "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
      {},
      "The out-of-process probe host is qualified on POSIX hosts only"
    );
}

// invariant: door 3. Approvals live in the Workspace state root that holds
// the evidence key, and verify against its pinned anchor; with no anchor
// there is nothing to verify against, so no approval verifies.
export function approvalStore(workspace: TaskWorkspace): ExtensionApprovalStore {
  return new ExtensionApprovalStore({
    directory: join(workspace.layout.workspaceRoot, "extension-approvals"),
    trust: async () => workspaceTrustRoot(workspace).catch(() => undefined)
  });
}

export function fileDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function entryInvalid(): never {
  throw extensionError("VES_EXTENSION_ENTRY_INVALID", {}, "The entry is not a regular file inside the Workspace");
}

function absent(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === "ENOENT";
}

// why: each component from the Workspace root down is read with lstat, so a
// link anywhere on the path is seen instead of followed. A component that does
// not exist ends the walk, since nothing below it exists either.
async function requireNoLink(root: string, parts: readonly string[], refuse: () => never): Promise<boolean> {
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const metadata = await lstat(current).catch((error: unknown) => (absent(error) ? undefined : refuse()));
    if (metadata === undefined) return false;
    if (metadata.isSymbolicLink()) refuse();
    const last = index === parts.length - 1;
    const expected = last ? metadata.isFile() && metadata.size <= MAXIMUM_ENTRY_BYTES : metadata.isDirectory();
    if (!expected) refuse();
  }
  return true;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly absolute: string;
  readonly exists: boolean;
}

// invariant: AC 3, the one rule for where a Workspace entry may live, shared by
// the commands that register it and the one that writes it (door 1 of
// .specs/features/sqlite-probe-worker/plan.md). The path lies strictly inside
// the Workspace, no component of it from the Workspace root down is a link,
// each existing directory on it is a directory and an existing file a regular
// one. Anything else is refused with the caller's own code.
export async function resolveWorkspaceFile(
  repositoryRoot: string,
  entry: string,
  refuse: () => never
): Promise<WorkspaceFile> {
  const absolute = resolve(repositoryRoot, entry);
  const inside = relative(repositoryRoot, absolute);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) refuse();
  const parts = inside.split(sep);
  const exists = await requireNoLink(repositoryRoot, parts, refuse);
  return Object.freeze({ path: parts.join("/"), absolute, exists });
}

// invariant: AC 3. An entry is a regular file strictly inside the Workspace,
// and no component of its path from the Workspace root down is a link, so
// what is locked is what a reviewer reads in the repository.
export async function resolveEntry(
  repositoryRoot: string,
  entry: string
): Promise<{ readonly path: string; readonly absolute: string; readonly digest: string }> {
  const { path, absolute, exists } = await resolveWorkspaceFile(repositoryRoot, entry, entryInvalid);
  if (!exists) entryInvalid();
  return Object.freeze({ path, absolute, digest: fileDigest(await readFile(absolute)) });
}

type Row = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value: unknown): readonly Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function carries(skill: Row, approvalRef: string): boolean {
  const reference = skill["extensionRef"];
  return isRow(reference) && reference["approvalRef"] === approvalRef;
}

// why: the request admission resolves for an approval reference: the locked
// skill whose extension carries it, with its executable entry. The lock is
// read as untrusted data here; admission's registry judges it.
export function lockedRequest(lock: unknown, approvalRef: string) {
  const skill = rows(isRow(lock) ? lock["skills"] : undefined).find((candidate) => carries(candidate, approvalRef));
  const entry = rows(skill?.["contents"]).find((content) => content["declaredClass"] === "executable");
  const reference = skill?.["extensionRef"];
  if (skill === undefined || entry === undefined || !isRow(reference)) return undefined;
  return Object.freeze({
    skillId: String(skill["id"]),
    extensionId: String(reference["id"]),
    entryPath: String(entry["path"])
  });
}

export function lockSkills(lock: SkillLock | undefined): readonly Row[] {
  return rows(lock?.skills);
}
