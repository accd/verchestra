import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../packages/agent-runtime/src/index.ts";

export const relayEntry = fileURLToPath(
  new URL("../../packages/agent-runtime/src/execution/mcp-tool-bridge-main.ts", import.meta.url)
);

const roots = [];
const controllers = [];
const children = [];

export async function bridgeWorktree() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-bridge-"));
  roots.push(root);
  const worktree = join(root, "worktree");
  const outside = join(root, "outside");
  await mkdir(join(worktree, "src", "nested"), { recursive: true });
  await mkdir(join(worktree, "src", "protected"), { recursive: true });
  await mkdir(join(worktree, "docs"), { recursive: true });
  await mkdir(join(worktree, ".git"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(worktree, "src", "a.txt"), "alpha needle\nsecond line\n");
  await writeFile(join(worktree, "src", "nested", "b.txt"), "beta needle\n");
  await writeFile(join(worktree, "src", "protected", "key.txt"), "protected needle\n");
  await writeFile(join(worktree, "docs", "secret.txt"), "out of scope needle\n");
  await writeFile(join(worktree, ".git", "config"), "[core]\n");
  await writeFile(join(outside, "victim.txt"), "outside needle\n");
  await linkDirectory(outside, join(worktree, "src", "linkdir"));
  await linkFile(join(outside, "victim.txt"), join(worktree, "src", "linkfile.txt"));
  return { root, worktree: await realpath(worktree), outside };
}

// why: Windows lets a user without elevation create symbolic links only in
// Developer Mode. A directory link falls back to a junction, which needs no
// privilege and which Node and the bridge both see as a link; a file link has
// no such fallback, so the fixture names the setting instead of every test
// that uses it failing with a bare EPERM.
export async function linkDirectory(target, path, link = symlink) {
  try {
    await link(target, path, "dir");
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    await link(target, path, "junction");
  }
}

export async function linkFile(target, path, link = symlink) {
  try {
    await link(target, path);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    throw new Error(
      "creating a file symbolic link was refused (EPERM): turn on Windows Developer Mode, or run the suite from an elevated session",
      { cause: error }
    );
  }
}

export async function openController(worktree, overrides = {}) {
  const invoked = [];
  const fatal = [];
  const payloads = new InMemoryExecutionPayloadStore();
  const controller = await McpToolBridgeController.open({
    worktreePath: worktree,
    readScope: ["src"],
    protectedPaths: [".git", "src/protected"],
    taskId: "T405.4",
    capabilityGrantRef: "grant:writer:1",
    payloads,
    invokeTool: async (request) => {
      invoked.push(request);
      return { receiptRef: `receipt:${invoked.length}` };
    },
    onFatal: (error) => fatal.push(error),
    ...overrides
  });
  controllers.push(controller);
  return { controller, invoked, fatal, payloads };
}

// A labeled test MCP client: it drives the real relay child exactly as Claude
// Code would, over newline-delimited JSON-RPC on stdio.
export function startRelay(environment) {
  const child = spawn(process.execPath, [relayEntry], {
    env: { ...environment },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  children.push(child);
  // why: a relay that refuses an oversized frame closes stdin mid-write.
  child.stdin.on("error", () => undefined);
  const waiting = new Map();
  const unmatched = [];
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      const settle = waiting.get(message.id);
      if (settle === undefined) unmatched.push(message);
      else {
        waiting.delete(message.id);
        settle.resolve(message);
      }
      index = buffer.indexOf("\n");
    }
  });
  const exited = new Promise((resolve) => child.once("close", (code) => resolve(code)));
  // hazard: a relay that exits, for one when it is refused or its own
  // five-second authentication wait ends, answers nothing more, so a request
  // still waiting then is rejected with its exit code and refusal line
  // instead of waiting for ever.
  void exited.then((code) => {
    for (const [id, settle] of waiting) {
      waiting.delete(id);
      settle.reject(new Error(`the relay exited with ${code} before answering request ${id}: ${stderr.trim()}`));
    }
  });
  let nextId = 0;
  return {
    child,
    exited,
    unmatched,
    stderr: () => stderr,
    raw: (line) => child.stdin.write(line),
    request(method, params) {
      nextId += 1;
      const id = nextId;
      const response = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
      // why: a caller that never awaits its request is not failed by the exit.
      response.catch(() => undefined);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`
      );
      return response;
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    async call(name, args) {
      return (await this.request("tools/call", { name, arguments: args })).result;
    },
    async initialize() {
      const response = await this.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "verchestra-test-client", version: "1" }
      });
      this.notify("notifications/initialized");
      return response;
    },
    close() {
      child.stdin.end();
      return exited;
    }
  };
}

export async function cleanupBridges() {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill();
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
