import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { LogicalPath, StableId } from "@verchestra/domain";
import { editManagedGitignore } from "./managed-gitignore.ts";
import { WorkspaceScanError, buildInventoryFingerprint } from "../scanner/scanner-primitives.ts";
import { scanWorkspace } from "../scanner/workspace-scanner.ts";

const execute = promisify(execFile);
const MANIFEST_PATH = ".verchestra/generated-manifest.json";
const STAGING_NAME = /^\.staging-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function buildCanonicalInitFiles(input: {
  workspaceId: string;
  displayName: string;
  placementMode: "colocated" | "centralized" | "mixed" | "external-control";
  generatorVersion: string;
}): Readonly<Record<string, string>> {
  try {
    StableId.parse(input.workspaceId, "workspace");
  } catch (error) {
    throw new WorkspaceScanError("VES_INIT_INPUT_INVALID", "Workspace identity is invalid", { cause: error });
  }
  if ([input.displayName, input.generatorVersion].some((value) => value.trim().length === 0 || /[\r\n\0]/u.test(value)))
    throw new WorkspaceScanError("VES_INIT_INPUT_INVALID", "Canonical init metadata is invalid");
  return Object.freeze({
    ".verchestra/workspace.yaml": `schemaVersion: 1\nworkspaceId: ${input.workspaceId}\ndisplayName: ${JSON.stringify(input.displayName)}\nlanguage: en\nplacementMode: ${input.placementMode}\n`,
    ".verchestra/projects.yaml": "schemaVersion: 1\nprojects: []\n",
    ".verchestra/skills.yaml": "schemaVersion: 1\nskills: []\n",
    ".verchestra/skills.lock.json": '{\n  "schemaVersion": 1,\n  "skills": []\n}\n',
    ".verchestra/integrations.yaml": "schemaVersion: 1\nintegrations: []\n",
    ".verchestra/generated-manifest.json": `${JSON.stringify({ schemaVersion: 1, generator: "verchestra", generatorVersion: input.generatorVersion, files: [] }, null, 2)}\n`
  });
}

export interface InitChange {
  readonly logicalPath: string;
  readonly action: "create" | "update";
  readonly expectedDigest: string | null;
  readonly contentDigest: string;
}
export interface InitPreview {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly changes: readonly InitChange[];
}
export interface InitRecoveryReceipt {
  readonly recoveredTransactions: number;
  readonly restoredChanges: number;
}
interface Context {
  service: object;
  root: string;
  contents: ReadonlyMap<string, string>;
}
export interface InitHookContext {
  readonly index: number;
  readonly change: InitChange;
}
export interface InitTransactionHooks {
  readonly afterStage?: () => void | Promise<void>;
  readonly beforeApplyChange?: (context: InitHookContext) => void | Promise<void>;
  readonly afterApplyChange?: (context: InitHookContext) => void | Promise<void>;
  readonly afterRecoveryRemove?: (context: InitHookContext) => void | Promise<void>;
}
const contexts = new WeakMap<object, Context>();
const digest = (value: string) => buildInventoryFingerprint({ content: value });
async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function pendingStaging(root: string): Promise<readonly string[]> {
  const metadataRoot = join(root, ".verchestra");
  try {
    return Object.freeze(
      (await readdir(metadataRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && STAGING_NAME.test(entry.name))
        .map((entry) => join(metadataRoot, entry.name))
        .sort((left, right) => left.localeCompare(right))
    );
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
}

interface RecoveryJournal {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly changes: readonly InitChange[];
}

function recoveryConflict(message: string, cause?: unknown): WorkspaceScanError {
  return new WorkspaceScanError("VES_INIT_RECOVERY_CONFLICT", message, cause === undefined ? {} : { cause });
}

function parseRecoveryJournal(content: string): RecoveryJournal {
  try {
    const value = JSON.parse(content) as {
      readonly schemaVersion?: unknown;
      readonly planId?: unknown;
      readonly changes?: unknown;
    };
    if (value.schemaVersion !== 1 || typeof value.planId !== "string" || !DIGEST.test(value.planId)) {
      throw new Error("invalid journal envelope");
    }
    if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 100_000) {
      throw new Error("invalid journal changes");
    }
    const seen = new Set<string>();
    const changes = value.changes.map((raw) => {
      const change = raw as Partial<InitChange>;
      if (
        typeof change.logicalPath !== "string" ||
        (change.action !== "create" && change.action !== "update") ||
        (change.expectedDigest !== null &&
          (typeof change.expectedDigest !== "string" || !DIGEST.test(change.expectedDigest))) ||
        typeof change.contentDigest !== "string" ||
        !DIGEST.test(change.contentDigest) ||
        (change.action === "create") !== (change.expectedDigest === null) ||
        seen.has(change.logicalPath)
      ) {
        throw new Error("invalid journal change");
      }
      LogicalPath.parse(change.logicalPath);
      if (change.logicalPath !== ".gitignore" && !change.logicalPath.startsWith(".verchestra/")) {
        throw new Error("journal target is outside control metadata");
      }
      seen.add(change.logicalPath);
      return Object.freeze({
        logicalPath: change.logicalPath,
        action: change.action,
        expectedDigest: change.expectedDigest,
        contentDigest: change.contentDigest
      });
    });
    if (buildInventoryFingerprint({ changes }) !== value.planId) throw new Error("journal plan digest mismatch");
    return Object.freeze({ schemaVersion: 1, planId: value.planId, changes: Object.freeze(changes) });
  } catch (error) {
    throw recoveryConflict("Interrupted init journal is invalid", error);
  }
}

function generatorVersionOf(content: string | undefined): string {
  try {
    const parsed = JSON.parse(content ?? "null") as { readonly generatorVersion?: unknown } | null;
    if (
      parsed === null ||
      typeof parsed.generatorVersion !== "string" ||
      parsed.generatorVersion.trim().length === 0 ||
      /[\r\n\0]/u.test(parsed.generatorVersion)
    ) {
      throw new Error("missing generator version");
    }
    return parsed.generatorVersion;
  } catch (error) {
    throw new WorkspaceScanError("VES_INIT_INPUT_INVALID", "Canonical ownership manifest seed is invalid", {
      cause: error
    });
  }
}

async function gitIgnores(root: string, logicalPath: string): Promise<boolean> {
  try {
    await execute("git", ["-c", "core.fsmonitor=false", "check-ignore", "-q", "--no-index", "--", logicalPath], {
      cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      windowsHide: true
    });
    return true;
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === 1) return false;
    throw new WorkspaceScanError("VES_WORKSPACE_GIT_FAILED", "Read-only Git ignore inspection failed", {
      cause: error
    });
  }
}

function ownershipManifest(desired: ReadonlyMap<string, string>, generatorVersion: string, gitOwnerId: string): string {
  const paths = [...desired.keys(), MANIFEST_PATH].sort((left, right) => left.localeCompare(right));
  const files = paths.map((logicalPath) =>
    Object.freeze({
      logicalPath,
      gitOwnerId,
      contentDigest: logicalPath === MANIFEST_PATH ? null : digest(desired.get(logicalPath) as string),
      ...(logicalPath === MANIFEST_PATH ? { digestMode: "self-excluded" as const } : {}),
      lifecyclePolicy: "tracked" as const
    })
  );
  return `${JSON.stringify({ schemaVersion: 1, generator: "verchestra", generatorVersion, files }, null, 2)}\n`;
}

async function removeEmptyParents(root: string, targets: readonly string[]): Promise<void> {
  const metadataRoot = join(root, ".verchestra");
  const directories = new Set<string>();
  for (const target of targets) {
    let current = dirname(target);
    while (current.startsWith(metadataRoot) && current !== root) {
      directories.add(current);
      if (current === metadataRoot) break;
      current = dirname(current);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String((error as { readonly code?: unknown }).code))) throw error;
    }
  }
}

export class SafeInitService {
  readonly #identity = Object.freeze({});
  readonly #hooks: InitTransactionHooks;
  constructor(options: { readonly hooks?: InitTransactionHooks } = {}) {
    this.#hooks = Object.freeze({ ...(options.hooks ?? {}) });
  }
  async preview(input: { controlRoot: string; files: Readonly<Record<string, string>> }): Promise<InitPreview> {
    const root = await realpath(input.controlRoot);
    const inventory = await scanWorkspace({ controlRoot: root });
    if ((await pendingStaging(root)).length > 0)
      throw new WorkspaceScanError("VES_INIT_RECOVERY_REQUIRED", "Interrupted init transaction requires recovery");
    const controlOwner = inventory.repositories.find((repository) => repository.relation === "control");
    if (controlOwner === undefined)
      throw new WorkspaceScanError("VES_WORKSPACE_OWNER_AMBIGUOUS", "Control Git owner is unavailable");
    const desired = new Map<string, string>();
    for (const [path, content] of Object.entries(input.files)) {
      try {
        LogicalPath.parse(path);
      } catch (error) {
        throw new WorkspaceScanError("VES_INIT_INPUT_INVALID", "Init target is not portable", { cause: error });
      }
      if (!path.startsWith(".verchestra/") || typeof content !== "string")
        throw new WorkspaceScanError("VES_INIT_INPUT_INVALID", "Init target is outside control metadata");
      desired.set(path, content);
    }
    const generatorVersion = generatorVersionOf(desired.get(MANIFEST_PATH));
    desired.delete(MANIFEST_PATH);
    const currentIgnore = await optionalText(join(root, ".gitignore"));
    desired.set(".gitignore", editManagedGitignore(currentIgnore).content);
    for (const path of [...desired.keys(), MANIFEST_PATH]) {
      if (await gitIgnores(root, path))
        throw new WorkspaceScanError("VES_INIT_TARGET_IGNORED", "Canonical init target is ignored by Git");
    }
    desired.set(MANIFEST_PATH, ownershipManifest(desired, generatorVersion, controlOwner.repositoryId));
    const changes: InitChange[] = [];
    for (const [path, content] of [...desired].sort(([a], [b]) => a.localeCompare(b))) {
      const existing = await optionalText(join(root, ...path.split("/")));
      if (existing === content) continue;
      if (existing !== undefined && path !== ".gitignore" && path !== MANIFEST_PATH)
        throw new WorkspaceScanError("VES_INIT_TARGET_CONFLICT", "Canonical init target contains different content");
      changes.push(
        Object.freeze({
          logicalPath: path,
          action: existing === undefined ? "create" : "update",
          expectedDigest: existing === undefined ? null : digest(existing),
          contentDigest: digest(content)
        })
      );
    }
    const frozen = Object.freeze(changes);
    const preview = Object.freeze({
      schemaVersion: 1 as const,
      planId: buildInventoryFingerprint({ changes }),
      changes: frozen
    });
    contexts.set(preview, { service: this.#identity, root, contents: desired });
    return preview;
  }
  async apply(preview: InitPreview): Promise<{ readonly planId: string; readonly changed: number }> {
    const context = contexts.get(preview as object);
    if (context === undefined || context.service !== this.#identity)
      throw new WorkspaceScanError("VES_INIT_PREVIEW_INVALID", "Init preview is not authentic");
    if ((await pendingStaging(context.root)).length > 0)
      throw new WorkspaceScanError("VES_INIT_RECOVERY_REQUIRED", "Interrupted init transaction requires recovery");
    for (const change of preview.changes) {
      const current = await optionalText(join(context.root, ...change.logicalPath.split("/")));
      if ((current === undefined ? null : digest(current)) !== change.expectedDigest)
        throw new WorkspaceScanError("VES_INIT_PREVIEW_STALE", "Init target changed after preview");
    }
    if (preview.changes.length === 0) return Object.freeze({ planId: preview.planId, changed: 0 });
    const staging = join(context.root, ".verchestra", `.staging-${randomUUID()}`);
    const applied: { target: string; backup?: string }[] = [];
    const targets = preview.changes.map((change) => join(context.root, ...change.logicalPath.split("/")));
    try {
      await mkdir(staging, { recursive: true, mode: 0o700 });
      for (const [index, change] of preview.changes.entries()) {
        const staged = join(staging, `write-${index}`);
        const backup = change.expectedDigest === null ? undefined : join(staging, `backup-${index}`);
        await writeFile(staged, context.contents.get(change.logicalPath) as string, {
          encoding: "utf8",
          mode: 0o600,
          flush: true
        });
        if (backup !== undefined) {
          const current = await optionalText(targets[index] as string);
          if (current === undefined || digest(current) !== change.expectedDigest)
            throw new WorkspaceScanError("VES_INIT_PREVIEW_STALE", "Init target changed while staging");
          await writeFile(backup, current, { encoding: "utf8", mode: 0o600, flush: true });
        }
      }
      const journal: RecoveryJournal = Object.freeze({
        schemaVersion: 1,
        planId: preview.planId,
        changes: preview.changes
      });
      const journalTemporary = join(staging, "transaction.tmp");
      await writeFile(journalTemporary, `${JSON.stringify(journal)}\n`, { encoding: "utf8", mode: 0o600, flush: true });
      await rename(journalTemporary, join(staging, "transaction.json"));
      await this.#hooks.afterStage?.();
      for (const [index, change] of preview.changes.entries()) {
        const target = targets[index] as string;
        const staged = join(staging, `write-${index}`);
        const backup = change.expectedDigest === null ? undefined : join(staging, `backup-${index}`);
        await mkdir(dirname(target), { recursive: true });
        await this.#hooks.beforeApplyChange?.(Object.freeze({ index, change }));
        const current = await optionalText(target);
        if ((current === undefined ? null : digest(current)) !== change.expectedDigest)
          throw new WorkspaceScanError("VES_INIT_PREVIEW_STALE", "Init target changed at the publication boundary");
        await rename(staged, target);
        applied.push({ target, ...(backup === undefined ? {} : { backup }) });
        await this.#hooks.afterApplyChange?.(Object.freeze({ index, change }));
      }
      return Object.freeze({ planId: preview.planId, changed: preview.changes.length });
    } catch (error) {
      for (const item of applied.reverse()) {
        await rm(item.target, { force: true });
        if (item.backup !== undefined) await rename(item.backup, item.target);
      }
      await removeEmptyParents(context.root, targets);
      throw new WorkspaceScanError("VES_INIT_APPLY_FAILED", "Init transaction failed and was rolled back", {
        cause: error
      });
    } finally {
      await rm(staging, { recursive: true, force: true });
      if (applied.length !== preview.changes.length) await removeEmptyParents(context.root, targets);
    }
  }

  async recover(input: { readonly controlRoot: string }): Promise<InitRecoveryReceipt> {
    const root = await realpath(input.controlRoot);
    await scanWorkspace({ controlRoot: root });
    const directories = await pendingStaging(root);
    let restoredChanges = 0;
    for (const staging of directories) {
      const journalContent = await optionalText(join(staging, "transaction.json"));
      if (journalContent === undefined) {
        await rm(staging, { recursive: true, force: true });
        continue;
      }
      const journal = parseRecoveryJournal(journalContent);
      const states: {
        readonly index: number;
        readonly change: InitChange;
        readonly target: string;
        readonly backup?: string;
        readonly action: "none" | "remove" | "restore";
      }[] = [];
      for (const [index, change] of journal.changes.entries()) {
        const target = join(root, ...change.logicalPath.split("/"));
        const staged = await optionalText(join(staging, `write-${index}`));
        const current = await optionalText(target);
        const currentDigest = current === undefined ? null : digest(current);
        const backupPath = change.expectedDigest === null ? undefined : join(staging, `backup-${index}`);
        const backup = backupPath === undefined ? undefined : await optionalText(backupPath);
        const backupIsValid =
          backupPath !== undefined && backup !== undefined && digest(backup) === change.expectedDigest;
        let action: "none" | "remove" | "restore";
        if (staged !== undefined) {
          if (digest(staged) !== change.contentDigest || currentDigest !== change.expectedDigest) {
            throw recoveryConflict("Unapplied init target or staged content changed after interruption");
          }
          action = "none";
        } else if (currentDigest === change.contentDigest) {
          if (change.expectedDigest !== null && !backupIsValid) {
            throw recoveryConflict("Interrupted init backup is missing or corrupt");
          }
          action = change.expectedDigest === null ? "remove" : "restore";
        } else if (currentDigest === change.expectedDigest) {
          action = "none";
        } else if (currentDigest === null && change.expectedDigest !== null && backupIsValid) {
          action = "restore";
        } else {
          throw recoveryConflict("Applied init target changed after interruption");
        }
        states.push({
          index,
          change,
          target,
          ...(backupPath === undefined ? {} : { backup: backupPath }),
          action
        });
      }
      for (const state of states.reverse()) {
        if (state.action === "none") continue;
        await rm(state.target, { force: true });
        await this.#hooks.afterRecoveryRemove?.(Object.freeze({ index: state.index, change: state.change }));
        if (state.action === "restore") await rename(state.backup as string, state.target);
        restoredChanges += 1;
      }
      await rm(staging, { recursive: true, force: true });
      await removeEmptyParents(
        root,
        states.map((state) => state.target)
      );
    }
    return Object.freeze({ recoveredTransactions: directories.length, restoredChanges });
  }
}
