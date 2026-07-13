import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FileHandle } from "node:fs/promises";

import { LogicalPath, StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "./platform-security-errors.ts";

export interface ProtectedPathHandle {
  readonly handleId: string;
  readonly workspaceId: string;
  readonly rootId: string;
  readonly logicalPath: string;
  toJSON(): Readonly<Record<string, string>>;
}

interface HandleRecord {
  readonly broker: object;
  readonly candidate: string;
  readonly expectedRealPath: string;
  readonly file: FileHandle;
  readonly device: bigint;
  readonly inode: bigint;
}

const records = new WeakMap<object, HandleRecord>();

class OpaquePathHandle implements ProtectedPathHandle {
  readonly handleId: string;
  readonly workspaceId: string;
  readonly rootId: string;
  readonly logicalPath: string;

  constructor(handleId: string, workspaceId: string, rootId: string, logicalPath: string, record: HandleRecord) {
    this.handleId = handleId;
    this.workspaceId = workspaceId;
    this.rootId = rootId;
    this.logicalPath = logicalPath;
    records.set(this, record);
    Object.freeze(this);
  }

  toJSON(): Readonly<Record<string, string>> {
    return Object.freeze({
      handleId: this.handleId,
      workspaceId: this.workspaceId,
      rootId: this.rootId,
      logicalPath: this.logicalPath
    });
  }
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(comparable(root), comparable(candidate));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function resolveExisting(candidate: string, code: "VES_PATH_NOT_FOUND" | "VES_PATH_CHANGED"): Promise<string> {
  try {
    return await realpath(candidate);
  } catch (error) {
    throw new PlatformSecurityError(code, "Protected path is unavailable", {}, { cause: error });
  }
}

interface PathBrokerHooks {
  readonly afterInitialResolution?: () => Promise<void> | void;
  readonly afterOpen?: () => Promise<void> | void;
  readonly beforeRead?: () => Promise<void> | void;
}

export class ProtectedPathBroker {
  readonly #workspaceId: string;
  readonly #roots: ReadonlyMap<string, string>;
  readonly #idSource: () => string;
  readonly #hooks: PathBrokerHooks;
  readonly #identity = Object.freeze({});

  static async create(options: {
    readonly workspaceId: string;
    readonly roots: readonly { readonly rootId: string; readonly path: string }[];
    readonly idSource?: () => string;
    readonly hooks?: PathBrokerHooks;
  }): Promise<ProtectedPathBroker> {
    try {
      StableId.parse(options.workspaceId, "workspace");
    } catch (error) {
      throw new PlatformSecurityError("VES_WORKSPACE_ID_INVALID", "Workspace ID is invalid", {}, { cause: error });
    }
    if (options.roots.length === 0) {
      throw new PlatformSecurityError("VES_PATH_ROOT_INVALID", "At least one protected root is required");
    }
    const roots = new Map<string, string>();
    for (const root of options.roots) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(root.rootId) || roots.has(root.rootId)) {
        throw new PlatformSecurityError("VES_PATH_ROOT_INVALID", "Protected root ID is invalid or duplicated");
      }
      try {
        const resolved = await realpath(root.path);
        if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
        roots.set(root.rootId, resolved);
      } catch (error) {
        throw new PlatformSecurityError(
          "VES_PATH_ROOT_INVALID",
          "Protected root is not an existing directory",
          {},
          {
            cause: error
          }
        );
      }
    }
    return new ProtectedPathBroker(options.workspaceId, roots, options.idSource, options.hooks);
  }

  private constructor(
    workspaceId: string,
    roots: ReadonlyMap<string, string>,
    idSource: (() => string) | undefined,
    hooks: PathBrokerHooks | undefined
  ) {
    this.#workspaceId = workspaceId;
    this.#roots = roots;
    this.#idSource = idSource ?? crypto.randomUUID;
    this.#hooks = hooks ?? {};
  }

  async openExisting(request: {
    readonly workspaceId: string;
    readonly rootId: string;
    readonly logicalPath: string;
  }): Promise<ProtectedPathHandle> {
    if (request.workspaceId !== this.#workspaceId) {
      throw new PlatformSecurityError("VES_PATH_WORKSPACE_MISMATCH", "Path request belongs to another Workspace");
    }
    const root = this.#roots.get(request.rootId);
    if (root === undefined) throw new PlatformSecurityError("VES_PATH_ROOT_UNKNOWN", "Protected root is not granted");
    let logicalPath: string;
    try {
      logicalPath = LogicalPath.parse(request.logicalPath).value;
    } catch (error) {
      throw new PlatformSecurityError("VES_PATH_LOGICAL_INVALID", "Logical path is invalid", {}, { cause: error });
    }
    const candidate = join(root, ...logicalPath.split("/"));
    const initial = await resolveExisting(candidate, "VES_PATH_NOT_FOUND");
    if (!isWithin(root, initial)) {
      throw new PlatformSecurityError("VES_PATH_OUTSIDE_ROOT", "Resolved path is outside the protected root");
    }
    await this.#hooks.afterInitialResolution?.();
    let file: FileHandle;
    try {
      file = await open(candidate, "r");
    } catch (error) {
      throw new PlatformSecurityError(
        "VES_PATH_CHANGED",
        "Path changed before its handle could be opened",
        {},
        {
          cause: error
        }
      );
    }
    try {
      const opened = await file.stat({ bigint: true });
      await this.#hooks.afterOpen?.();
      const after = await resolveExisting(candidate, "VES_PATH_CHANGED");
      let current;
      try {
        current = await stat(after, { bigint: true });
      } catch (error) {
        throw new PlatformSecurityError(
          "VES_PATH_CHANGED",
          "Path changed during identity verification",
          {},
          {
            cause: error
          }
        );
      }
      if (comparable(initial) !== comparable(after) || opened.dev !== current.dev || opened.ino !== current.ino) {
        throw new PlatformSecurityError("VES_PATH_CHANGED", "Path identity changed while opening");
      }
      if (!isWithin(root, after)) {
        throw new PlatformSecurityError("VES_PATH_OUTSIDE_ROOT", "Resolved path is outside the protected root");
      }
      const record = Object.freeze({
        broker: this.#identity,
        candidate,
        expectedRealPath: after,
        file,
        device: opened.dev,
        inode: opened.ino
      });
      return new OpaquePathHandle(this.#idSource(), this.#workspaceId, request.rootId, logicalPath, record);
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async readFile(handle: ProtectedPathHandle, encoding?: BufferEncoding): Promise<string | Buffer> {
    const record = this.#record(handle);
    await this.#hooks.beforeRead?.();
    await this.#verify(record);
    const fileStat = await record.file.stat();
    const buffer = Buffer.alloc(fileStat.size);
    await record.file.read(buffer, 0, buffer.length, 0);
    await this.#verify(record);
    return encoding === undefined ? buffer : buffer.toString(encoding);
  }

  async close(handle: ProtectedPathHandle): Promise<void> {
    const record = this.#record(handle);
    records.delete(handle as object);
    await record.file.close();
  }

  #record(handle: ProtectedPathHandle): HandleRecord {
    const record = records.get(handle as object);
    if (record === undefined || record.broker !== this.#identity) {
      throw new PlatformSecurityError("VES_PATH_HANDLE_INVALID", "Path handle is not authentic for this broker");
    }
    return record;
  }

  async #verify(record: HandleRecord): Promise<void> {
    let currentPath: string;
    try {
      currentPath = await realpath(record.candidate);
    } catch (error) {
      throw new PlatformSecurityError("VES_PATH_CHANGED", "Path disappeared after opening", {}, { cause: error });
    }
    const [opened, current] = await Promise.all([
      record.file.stat({ bigint: true }),
      stat(currentPath, { bigint: true })
    ]);
    if (
      comparable(currentPath) !== comparable(record.expectedRealPath) ||
      opened.dev !== record.device ||
      opened.ino !== record.inode ||
      current.dev !== record.device ||
      current.ino !== record.inode
    ) {
      throw new PlatformSecurityError("VES_PATH_CHANGED", "Path identity changed after opening");
    }
  }
}
