import type { Dirent } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isProtectedTaskPath,
  isTaskPath,
  isWithinTaskPath,
  isWithinTaskScope,
  namesGitMetadata
} from "@verchestra/domain";

import { codeUnitCompare } from "../context/code-unit-compare.ts";

const MAXIMUM_READ_BYTES = 262_144;
const MAXIMUM_LIST_ENTRIES = 1_000;
const MAXIMUM_SEARCH_MATCHES = 100;
const MAXIMUM_SEARCH_FILES = 5_000;
const MAXIMUM_SEARCH_FILE_BYTES = 1_048_576;
const MAXIMUM_MATCH_TEXT = 240;
const READ_ONLY_FILE = 0o400;
const READ_ONLY_DIRECTORY = 0o500;

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

// hazard: a model-supplied path is trimmed by a linear scan, never by a regex
// that can backtrack over a long run of separators.
function withoutTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

// Splits and validates a model-supplied logical path. `.` names the worktree
// root. Git metadata is refused at any depth and in any letter case.
export function logicalSegments(value: unknown): readonly string[] {
  if (value === ".") return [];
  if (!isTaskPath(value)) deny("VES_BRIDGE_PATH_INVALID", "Path is not a repository-relative logical path");
  const segments = withoutTrailingSeparators(value).split("/");
  if (segments.some((segment) => segment === "" || segment === "."))
    deny("VES_BRIDGE_PATH_INVALID", "Path is not normalized");
  if (namesGitMetadata(value)) deny("VES_BRIDGE_PATH_PROTECTED", "Git metadata is not readable");
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
      if (!isTaskPath(entry)) deny("VES_BRIDGE_SCOPE_INVALID", "Protected path is not a logical path");
      return entry;
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

  // invariant: SSI-42 and TM-004 for a reader the bridge cannot hold (a Codex
  // node): this view written out under `target`, an empty directory the
  // caller owns. It holds exactly the text files a read through the bridge
  // reaches, each resolved as a read is (every component lstat-checked, a link
  // never followed), and leaves them and their directories read-only. It is
  // bounded as the bridge's search is: a listing the bridge would truncate,
  // more than MAXIMUM_SEARCH_FILES files, or a file over
  // MAXIMUM_SEARCH_FILE_BYTES refuses the whole view, never copies a part.
  async materialize(target: string): Promise<void> {
    const directories = [target];
    await this.#materializeDirectory(".", target, { files: 0, directories });
    for (const directory of directories) await chmod(directory, READ_ONLY_DIRECTORY);
  }

  async #materializeDirectory(
    logical: string,
    target: string,
    state: { files: number; readonly directories: string[] }
  ): Promise<void> {
    const listing = await this.listDir(logical);
    if (listing.truncated) deny("VES_BRIDGE_VIEW_LIMIT", "A directory of the read scope exceeds the listing bound");
    for (const entry of listing.entries) {
      const child = logical === "." ? entry.name : `${logical}/${entry.name}`;
      const destination = join(target, entry.name);
      if (entry.type === "directory") {
        await mkdir(destination, { mode: 0o700 });
        state.directories.push(destination);
        await this.#materializeDirectory(child, destination, state);
        continue;
      }
      state.files += 1;
      if (state.files > MAXIMUM_SEARCH_FILES) deny("VES_BRIDGE_VIEW_LIMIT", "The read scope exceeds the file bound");
      await this.#materializeFile(child, destination);
    }
  }

  // why: a binary file is not readable through the bridge, so it is not in
  // the view either.
  async #materializeFile(logical: string, destination: string): Promise<void> {
    const handle = await open(await this.#resolve(logical, "file"), "r");
    let bytes: Buffer;
    try {
      if ((await handle.stat()).size > MAXIMUM_SEARCH_FILE_BYTES)
        deny("VES_BRIDGE_VIEW_LIMIT", "A file of the read scope exceeds the file size bound");
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (bytes.byteLength > MAXIMUM_SEARCH_FILE_BYTES)
      deny("VES_BRIDGE_VIEW_LIMIT", "A file of the read scope exceeds the file size bound");
    if (!bytes.includes(0)) await writeFile(destination, bytes, { mode: READ_ONLY_FILE, flag: "wx" });
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
    if (namesGitMetadata(logical) || isProtectedTaskPath(logical, this.#protected)) return false;
    if (isWithinTaskScope(logical, this.#scope)) return true;
    return kind === "directory" && this.#scope.some((root) => isWithinTaskPath(root, logical));
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

// invariant: a materialized view is removed whole: its read-only entries are
// made writable for their owner first, which a removal needs on every
// platform. A view that was never written leaves nothing to do.
export async function removeMaterializedView(target: string): Promise<void> {
  const entries = await readdir(target, { recursive: true, withFileTypes: true }).catch(() => []);
  await chmod(target, 0o700).catch(() => undefined);
  for (const entry of entries) await chmod(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o700 : 0o600);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
}
