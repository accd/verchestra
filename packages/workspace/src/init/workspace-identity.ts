import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { StableId, WORKSPACE_ROOT_DIRNAME } from "@verchestra/domain";

import { WorkspaceScanError } from "../scanner/scanner-primitives.ts";

const MAX_IDENTITY_BYTES = 64 * 1024;

export interface WorkspaceIdentity {
  readonly workspaceId: string;
}

function invalid(cause?: unknown): WorkspaceScanError {
  return new WorkspaceScanError(
    "VES_INIT_IDENTITY_INVALID",
    "Workspace identity file is malformed",
    cause === undefined ? {} : { cause }
  );
}

// why: Workspace-scoped commands (credential binding, deep doctor) need the
// identity `init` wrote, and nothing else. This reads it without writing,
// locking, or recovering anything; an uninitialized control root is
// `undefined`, and a present but unreadable identity fails closed.
// invariant: the parsed shape is the one buildCanonicalInitFiles emits
// (`schemaVersion: 1` and one top-level `workspaceId: <StableId>` line).
export async function readWorkspaceIdentity(controlRoot: string): Promise<WorkspaceIdentity | undefined> {
  const path = join(controlRoot, WORKSPACE_ROOT_DIRNAME, "workspace.yaml");
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw invalid(error);
  }
  if (!stats.isFile() || stats.size > MAX_IDENTITY_BYTES) throw invalid();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw invalid(error);
  }
  return parseIdentity(text);
}

function parseIdentity(text: string): WorkspaceIdentity {
  const lines = text.split(/\r?\n/u);
  if (!lines.includes("schemaVersion: 1")) throw invalid();
  const identities = lines.filter((line) => line.startsWith("workspaceId:"));
  const match = identities.length === 1 ? /^workspaceId: (\S+)$/u.exec(identities[0] as string) : null;
  if (match === null) throw invalid();
  try {
    return Object.freeze({ workspaceId: StableId.parse(match[1] as string, "workspace").value });
  } catch (error) {
    throw invalid(error);
  }
}
