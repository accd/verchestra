import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NodeGitWorktreeAdapter,
  NodeWorktreeToolAdapter,
  RuntimeStore
} from "../../packages/platform-node/src/index.ts";
import { systemGit } from "./system-git.mjs";

export const roots = [];
const stores = [];

export function git(cwd, ...args) {
  return execFileSync(systemGit(), args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

// Content-addressed payloads, as the bridge controller stores them.
export function payloadStore() {
  const entries = new Map();
  return {
    entries,
    put(text) {
      const bytes = new TextEncoder().encode(text);
      const ref = `payload:sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      entries.set(ref, bytes);
      return ref;
    },
    get: async (ref) => entries.get(ref)
  };
}

export async function worktreeToolFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-worktree-tool-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const worktreesRoot = join(root, "worktrees");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  await writeFile(join(repositoryRoot, "src", "tool.sh"), "#!/bin/sh\necho base\n", { mode: 0o755 });
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "base");
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  const worktrees = new NodeGitWorktreeAdapter({
    repositoryRoot,
    worktreesRoot,
    anchorTaskCommits: options.anchorTaskCommits ?? false
  });
  const handle = await worktrees.create({
    workspaceId: "workspace_tool",
    runId: options.runId ?? "run_405",
    taskId: options.taskId ?? "T405.3",
    sourceStateDigest: `sha256:${"2".repeat(64)}`,
    sourceRevision: baseCommit,
    changeScope: ["src"],
    protectedPaths: [".git"]
  });
  const worktreePath = await worktrees.resolvePath(handle.worktreeRef);
  const store = new RuntimeStore({ dbPath: join(root, "state", "runtime.sqlite"), timeoutMs: 10 });
  store.open();
  stores.push(store);
  const payloads = payloadStore();
  const adapter = new NodeWorktreeToolAdapter({
    workspaceId: "workspace_tool",
    worktrees,
    receipts: store.createEffectRepository(),
    payloads,
    protectedRoots: [".verchestra/policy"],
    ...options.adapter
  });
  const request = (overrides = {}) => ({
    requestId: "bridge:request:1",
    taskId: "T405.3",
    capabilityGrantRef: "grant:writer:1",
    operation: "write",
    targetPaths: ["src/value.txt"],
    payloadRef: payloads.put("implemented\n"),
    worktreeRef: handle.worktreeRef,
    ...overrides
  });
  return {
    adapter,
    baseCommit,
    handle,
    payloads,
    repositoryRoot,
    request,
    root,
    store,
    worktreePath,
    worktrees,
    worktreesRoot
  };
}

export async function cleanupWorktreeTools() {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
}
