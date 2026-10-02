import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import type {
  ContextFragmentInput,
  ContextSourceObservation,
  ContextSourcePort,
  ContextSourceQuery
} from "@verchestra/application";
import type { DataClassificationValue } from "@verchestra/domain";

import { runGitBytes } from "./task-worktree.ts";

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;
const TREE_ENTRY = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40}|[a-f0-9]{64}) +(-|\d+)\t(.+)$/su;
// invariant: only ordinary committed files are context; symlinks (120000) and
// submodules (160000) would point outside the reviewed revision.
const FILE_MODES = new Set(["100644", "100755"]);

export type GitContextErrorCode =
  | "VES_GIT_CONTEXT_INPUT_INVALID"
  | "VES_GIT_CONTEXT_LIMIT"
  | "VES_GIT_CONTEXT_PATH_MISSING"
  | "VES_GIT_CONTEXT_COMMAND_FAILED";

export class GitContextError extends Error {
  readonly code: GitContextErrorCode;

  constructor(code: GitContextErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitContextError";
    this.code = code;
  }
}

function fail(code: GitContextErrorCode, message: string, options?: ErrorOptions): never {
  throw new GitContextError(code, message, options);
}

function positive(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) fail("VES_GIT_CONTEXT_INPUT_INVALID", `${label} is invalid`);
  return selected;
}

function within(path: string, scope: string): boolean {
  return scope === "." || path === scope || path.startsWith(`${scope}/`);
}

function validScope(scope: unknown): scope is string {
  return typeof scope === "string" && (scope === "." || LOGICAL_PATH.test(scope));
}

function validPaths(paths: unknown, scope: string, maximum: number): paths is readonly string[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > maximum) return false;
  if (new Set(paths).size !== paths.length) return false;
  return paths.every((path) => typeof path === "string" && LOGICAL_PATH.test(path) && within(path, scope));
}

function treeFile(entry: string, scope: string): GitTreeFile | undefined {
  const match = TREE_ENTRY.exec(entry);
  if (match === null) fail("VES_GIT_CONTEXT_COMMAND_FAILED", "Git returned an unreadable tree entry");
  const [, mode = "", type, objectId = "", size, path = ""] = match;
  if (type !== "blob" || !FILE_MODES.has(mode)) return undefined;
  if (!LOGICAL_PATH.test(path) || !within(path, scope)) return undefined;
  return Object.freeze({ path, objectId, sizeBytes: Number(size) });
}

// A deterministic, v4-shaped identifier: the fragment ID grammar requires a
// canonical UUID, and a digest keeps the same file at the same revision stable.
function fragmentId(revision: string, path: string): string {
  const hex = createHash("sha256").update(`${revision}\0${path}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `fragment_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface GitTreeFile {
  readonly path: string;
  readonly objectId: string;
  readonly sizeBytes: number;
}

export interface NodeGitContextSourceOptions {
  readonly repositoryRoot: string;
  readonly sourceId: string;
  readonly classification?: DataClassificationValue;
  readonly maximumEntries?: number;
  readonly maximumFiles?: number;
  readonly maximumFileBytes?: number;
  readonly maximumTotalBytes?: number;
  readonly now?: () => string;
}

// Repository context at an exact revision, read from Git objects only: never
// the working tree, never filters or textconv, and never past a declared bound.
export class NodeGitContextSource implements ContextSourcePort {
  readonly #repositoryRoot: string;
  readonly #sourceId: string;
  readonly #classification: DataClassificationValue;
  readonly #maximumEntries: number;
  readonly #maximumFiles: number;
  readonly #maximumFileBytes: number;
  readonly #maximumTotalBytes: number;
  readonly #now: () => string;

  constructor(options: NodeGitContextSourceOptions) {
    if (!isAbsolute(options.repositoryRoot)) fail("VES_GIT_CONTEXT_INPUT_INVALID", "Repository root must be absolute");
    if (!SAFE.test(options.sourceId)) fail("VES_GIT_CONTEXT_INPUT_INVALID", "Source ID is invalid");
    this.#repositoryRoot = resolve(options.repositoryRoot);
    this.#sourceId = options.sourceId;
    this.#classification = options.classification ?? "internal";
    this.#maximumEntries = positive(options.maximumEntries, 5_000, "maximumEntries");
    this.#maximumFiles = positive(options.maximumFiles, 200, "maximumFiles");
    this.#maximumFileBytes = positive(options.maximumFileBytes, 262_144, "maximumFileBytes");
    this.#maximumTotalBytes = positive(options.maximumTotalBytes, 2_097_152, "maximumTotalBytes");
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async resolve(query: ContextSourceQuery): Promise<ContextSourceObservation | undefined> {
    if (query.sourceKind !== "repository")
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context serves only the repository source kind");
    if (query.sourceId !== this.#sourceId) return undefined;
    const revision = query.expectedRevision;
    if (revision === undefined || !OBJECT_ID.test(revision))
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context requires an exact expected revision");
    const { scope, paths } = this.#selector(query.query);
    const files = await this.listTree(revision, scope);
    const selected = paths === undefined ? files : this.#select(files, paths);
    if (selected.length > this.#maximumFiles) fail("VES_GIT_CONTEXT_LIMIT", "Context scope exceeds its file bound");
    const totalBytes = selected.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalBytes > this.#maximumTotalBytes) fail("VES_GIT_CONTEXT_LIMIT", "Context scope exceeds its byte bound");
    const fragments: ContextFragmentInput[] = [];
    for (const file of selected) {
      const text = await this.readBlob(file);
      if (text === undefined) continue;
      fragments.push(
        Object.freeze({
          fragmentId: fragmentId(revision, file.path),
          content: `path: ${file.path}\n\n${text}`,
          classification: this.#classification,
          trust: "untrusted-data"
        })
      );
    }
    return Object.freeze({
      source: Object.freeze({ kind: "repository", identity: this.#sourceId, revision }),
      retrievedAt: this.#now(),
      scope,
      fragments: Object.freeze(fragments)
    });
  }

  // Ordinary files under `scope` at `revision`, bounded by the entry limit.
  async listTree(revision: string, scope: string): Promise<readonly GitTreeFile[]> {
    if (!OBJECT_ID.test(revision) || !validScope(scope))
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Revision or scope is not exact");
    const resolved = (await this.#git(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], 4_096))
      .toString("utf8")
      .trim();
    if (resolved !== revision) fail("VES_GIT_CONTEXT_INPUT_INVALID", "Revision does not resolve to itself");
    const listing = await this.#git(
      [
        "--literal-pathspecs",
        "ls-tree",
        "-r",
        "-z",
        "--long",
        "--full-tree",
        revision,
        ...(scope === "." ? [] : ["--", scope])
      ],
      this.#maximumEntries * 4_400
    );
    const entries = listing.toString("utf8").split("\0").filter(Boolean);
    if (entries.length > this.#maximumEntries) fail("VES_GIT_CONTEXT_LIMIT", "Context scope exceeds its entry bound");
    const files: GitTreeFile[] = [];
    for (const entry of entries) {
      const file = treeFile(entry, scope);
      if (file !== undefined) files.push(file);
    }
    return Object.freeze(files);
  }

  // UTF-8 text of one listed file, or undefined for binary content. A file
  // above the per-file bound fails closed instead of being truncated.
  async readBlob(file: GitTreeFile): Promise<string | undefined> {
    if (!OBJECT_ID.test(file.objectId)) fail("VES_GIT_CONTEXT_INPUT_INVALID", "Object ID is invalid");
    if (file.sizeBytes > this.#maximumFileBytes) fail("VES_GIT_CONTEXT_LIMIT", "Context file exceeds its byte bound");
    const bytes = await this.#git(["cat-file", "blob", file.objectId], this.#maximumFileBytes + 1);
    if (bytes.byteLength !== file.sizeBytes) fail("VES_GIT_CONTEXT_COMMAND_FAILED", "Git blob size changed");
    if (bytes.includes(0)) return undefined;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }

  #selector(value: unknown): { readonly scope: string; readonly paths: readonly string[] | undefined } {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context query must be an object");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== "scope" && key !== "paths"))
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context query contains unknown fields");
    const scope = row["scope"];
    if (!validScope(scope)) fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context scope is not a logical path");
    const paths = row["paths"];
    if (paths === undefined) return { scope, paths: undefined };
    if (!validPaths(paths, scope, this.#maximumFiles))
      fail("VES_GIT_CONTEXT_INPUT_INVALID", "Git context paths must be unique logical paths inside the scope");
    return { scope, paths };
  }

  #select(files: readonly GitTreeFile[], paths: readonly string[]): readonly GitTreeFile[] {
    const byPath = new Map(files.map((file) => [file.path, file]));
    return paths.map((path) => byPath.get(path) ?? fail("VES_GIT_CONTEXT_PATH_MISSING", "Context path is absent"));
  }

  async #git(args: readonly string[], maxBuffer: number): Promise<Buffer> {
    try {
      return await runGitBytes(this.#repositoryRoot, args, maxBuffer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        fail("VES_GIT_CONTEXT_LIMIT", "Git output exceeded its bound", { cause: error });
      fail("VES_GIT_CONTEXT_COMMAND_FAILED", "Git context command failed", { cause: error });
    }
  }
}
