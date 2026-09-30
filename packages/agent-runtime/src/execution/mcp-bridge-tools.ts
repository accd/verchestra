import type { Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { codeUnitCompare } from "../context/code-unit-compare.ts";

const LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;
const MAXIMUM_READ_BYTES = 262_144;
const MAXIMUM_LIST_ENTRIES = 1_000;
const MAXIMUM_SEARCH_MATCHES = 100;
const MAXIMUM_SEARCH_FILES = 5_000;
const MAXIMUM_SEARCH_FILE_BYTES = 1_048_576;
const MAXIMUM_MATCH_TEXT = 240;

export class BridgeToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeToolError";
    this.code = code;
  }
}

function deny(code: string, message: string): never {
  throw new BridgeToolError(code, message);
}

function under(path: string, root: string): boolean {
  return root === "." || path === root || path.startsWith(`${root}/`);
}

// Splits and validates a model-supplied logical path. `.` names the worktree
// root. Git metadata is refused at any depth and in any letter case.
export function logicalSegments(value: unknown): readonly string[] {
  if (value === ".") return [];
  if (typeof value !== "string" || !LOGICAL_PATH.test(value))
    deny("VES_BRIDGE_PATH_INVALID", "Path is not a repository-relative logical path");
  const segments = value.replace(/\/+$/u, "").split("/");
  if (segments.some((segment) => segment === "" || segment === "."))
    deny("VES_BRIDGE_PATH_INVALID", "Path is not normalized");
  if (segments.some((segment) => segment.toLowerCase() === ".git"))
    deny("VES_BRIDGE_PATH_PROTECTED", "Git metadata is not readable");
  return segments;
}

export interface WorktreeReadViewOptions {
  readonly root: string;
  readonly readScope: readonly string[];
  readonly protectedPaths: readonly string[];
}

// Read-only view of one worktree, limited to the approved read scope minus
// protected paths. Every component is lstat-checked; links are never followed.
function entryKind(entry: Dirent): "file" | "directory" | undefined {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return undefined;
}

export class WorktreeReadView {
  readonly #root: string;
  readonly #scope: readonly string[];
  readonly #protected: readonly string[];

  private constructor(root: string, scope: readonly string[], protectedPaths: readonly string[]) {
    this.#root = root;
    this.#scope = scope;
    this.#protected = protectedPaths;
  }

  static async open(options: WorktreeReadViewOptions): Promise<WorktreeReadView> {
    const root = await realpath(options.root);
    if (root !== options.root) deny("VES_BRIDGE_ROOT_INVALID", "Worktree root must be its own real path");
    const scope = options.readScope.map((entry) => {
      if (entry !== ".") logicalSegments(entry);
      return entry;
    });
    if (scope.length === 0) deny("VES_BRIDGE_SCOPE_INVALID", "Read scope is empty");
    const protectedPaths = options.protectedPaths.map((entry) => {
      if (!LOGICAL_PATH.test(entry)) deny("VES_BRIDGE_SCOPE_INVALID", "Protected path is not a logical path");
      return entry.toLowerCase();
    });
    return new WorktreeReadView(root, Object.freeze(scope), Object.freeze(protectedPaths));
  }

  async readFile(path: unknown, offset = 0, length = MAXIMUM_READ_BYTES) {
    const logical = this.#logical(path, "file");
    const absolute = await this.#resolve(logical, "file");
    const handle = await open(absolute, "r");
    try {
      const size = (await handle.stat()).size;
      const start = Math.min(offset, size);
      const count = Math.min(length, MAXIMUM_READ_BYTES, size - start);
      const buffer = Buffer.alloc(count);
      const { bytesRead } = await handle.read(buffer, 0, count, start);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) deny("VES_BRIDGE_BINARY_FILE", "File is not text");
      const nextOffset = start + bytesRead;
      return { path: logical, size, nextOffset, text: bytes.toString("utf8"), truncated: nextOffset < size };
    } finally {
      await handle.close();
    }
  }

  async listDir(path: unknown) {
    const logical = this.#logical(path, "directory");
    const absolute = await this.#resolve(logical, "directory");
    const entries: { name: string; type: "file" | "directory" }[] = [];
    let truncated = false;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((left, right) =>
      codeUnitCompare(left.name, right.name)
    )) {
      const child = logical === "." ? entry.name : `${logical}/${entry.name}`;
      const kind = entryKind(entry);
      if (kind === undefined || !this.#visible(child, kind)) continue;
      if (entries.length === MAXIMUM_LIST_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({ name: entry.name, type: kind });
    }
    return { path: logical, entries, truncated };
  }

  async search(query: unknown, path: unknown = ".") {
    if (typeof query !== "string" || query.length === 0 || query.length > 200 || query.includes("\n"))
      deny("VES_BRIDGE_ARGUMENTS_INVALID", "Search query is invalid");
    const start = this.#logical(path, "directory");
    const state = { files: 0, truncated: false, matches: [] as { path: string; line: number; text: string }[] };
    await this.#searchDirectory(start, query, state);
    return { query, path: start, matches: state.matches, truncated: state.truncated };
  }

  async #searchDirectory(
    logical: string,
    query: string,
    state: { files: number; truncated: boolean; matches: { path: string; line: number; text: string }[] }
  ): Promise<void> {
    const absolute = await this.#resolve(logical, "directory");
    const entries = (await readdir(absolute, { withFileTypes: true })).sort((left, right) =>
      codeUnitCompare(left.name, right.name)
    );
    for (const entry of entries) {
      if (state.truncated) return;
      const child = logical === "." ? entry.name : `${logical}/${entry.name}`;
      if (entry.isDirectory() && this.#visible(child, "directory")) await this.#searchDirectory(child, query, state);
      else if (entry.isFile() && this.#visible(child, "file"))
        await this.#searchFile(child, join(absolute, entry.name), query, state);
    }
  }

  async #searchFile(
    logical: string,
    absolute: string,
    query: string,
    state: { files: number; truncated: boolean; matches: { path: string; line: number; text: string }[] }
  ): Promise<void> {
    state.files += 1;
    if (state.files > MAXIMUM_SEARCH_FILES) {
      state.truncated = true;
      return;
    }
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.size > MAXIMUM_SEARCH_FILE_BYTES) return;
    const handle = await open(absolute, "r");
    let bytes: Buffer;
    try {
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (bytes.includes(0)) return;
    const lines = bytes.toString("utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (!line.includes(query)) continue;
      if (state.matches.length === MAXIMUM_SEARCH_MATCHES) {
        state.truncated = true;
        return;
      }
      state.matches.push({ path: logical, line: index + 1, text: line.slice(0, MAXIMUM_MATCH_TEXT) });
    }
  }

  #logical(value: unknown, kind: "file" | "directory"): string {
    const segments = logicalSegments(value);
    const logical = segments.length === 0 ? "." : segments.join("/");
    if (!this.#visible(logical, kind)) deny("VES_BRIDGE_SCOPE_DENIED", "Path is outside the approved read scope");
    return logical;
  }

  // A file must be inside the read scope. A directory may also be an ancestor
  // of a scope root, so the model can navigate to it, but listings still show
  // only scope roots' ancestors and scoped entries.
  #visible(logical: string, kind: "file" | "directory"): boolean {
    const folded = logical.toLowerCase();
    if (folded.split("/").includes(".git")) return false;
    if (this.#protected.some((root) => under(folded, root))) return false;
    if (this.#scope.some((root) => under(logical, root))) return true;
    return kind === "directory" && this.#scope.some((root) => logical === "." || root.startsWith(`${logical}/`));
  }

  async #resolve(logical: string, kind: "file" | "directory"): Promise<string> {
    let current = this.#root;
    for (const segment of logical === "." ? [] : logical.split("/")) {
      current = join(current, segment);
      const metadata = await lstat(current).catch(() => deny("VES_BRIDGE_PATH_MISSING", "Path does not exist"));
      if (metadata.isSymbolicLink()) deny("VES_BRIDGE_SYMLINK_DENIED", "Path crosses a symbolic link");
    }
    const metadata = await lstat(current);
    if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory())
      deny("VES_BRIDGE_PATH_INVALID", `Path is not a ${kind}`);
    return current;
  }
}
