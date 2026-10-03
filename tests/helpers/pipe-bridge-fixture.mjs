import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

const roots = [];

// invariant: a worktree without links, so the controller can be opened on a
// host that cannot create them; the link cases live in mcp-bridge-fixture.mjs.
export async function plainWorktree() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-pipe-"));
  roots.push(root);
  const worktree = join(root, "worktree");
  const channels = join(root, "channels");
  await mkdir(join(worktree, "src"), { recursive: true });
  await mkdir(channels);
  await writeFile(join(worktree, "src", "a.txt"), "alpha needle\n");
  return { root, worktree: await realpath(worktree), channels: await realpath(channels) };
}

export async function cleanupPlainWorktrees() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
}

// hazard: a Node child on Windows cannot start Winsock without SystemRoot, so
// the relay a test launches there carries it beside the bridge variables.
export function relayEnvironment(controller, overrides = {}) {
  const system = process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {};
  return { ...controller.environment, ...system, ...overrides };
}

export const frame = (message) => `${JSON.stringify(message)}\n`;
export const hello = (token) => frame({ type: "hello", protocol: "verchestra-bridge/1", token });

// invariant: a raw client of the controller's channel stands for any process
// other than the relay launched for the run.
export function rawChannelClient(endpoint) {
  const socket = createConnection(endpoint);
  let data = "";
  let connected = false;
  socket.on("connect", () => (connected = true));
  socket.on("data", (chunk) => (data += chunk));
  socket.on("error", () => undefined);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  return { socket, closed, data: () => data, connected: () => connected };
}

// invariant: a DETERMINISTIC FAKE of the PowerShell 7 helper. Its status lines
// go out on stderr exactly as the helper's do, and its stdout and stdin stand
// for the bytes the pipe client wrote and the bytes it is sent.
export class FakePipeHelper extends EventEmitter {
  pid = 4242;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  received = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk) => (this.received += chunk));
  }

  status(line) {
    this.stderr.write(`${line}\r\n`);
  }

  exit() {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", 0, null);
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", 0, null));
  }
}

const SID = "S-1-5-21-1000-2000-3000-1001";

// invariant: a DETERMINISTIC FAKE host for the named-pipe transport, with no
// PowerShell, no ACL tool, and no process tree; `behaviour` plays the helper
// once it starts.
export class FakePipeHost {
  platform = "win32";
  installed = true;
  proof = Object.freeze({ proven: true, sid: SID, dacl: `D:PAI(A;OICI;FA;;;${SID})` });
  checked = [];
  secured = [];
  started = [];
  terminated = [];

  constructor(behaviour = (helper) => helper.status("verchestra-pipe:listening")) {
    this.behaviour = behaviour;
  }

  async powershellInstalled(executable) {
    this.checked.push(executable);
    return this.installed;
  }

  async secureDirectory(directory) {
    this.secured.push({ directory, entries: readdirSync(directory) });
    return this.proof;
  }

  startHelper(executable, args, options) {
    const helper = new FakePipeHelper();
    this.started.push({ executable, args, options, helper, script: readFileSync(args.at(-2), "utf8") });
    setImmediate(() => this.behaviour(helper));
    return helper;
  }

  async terminateTree(pid) {
    this.terminated.push(pid);
    for (const { helper } of this.started) if (helper.pid === pid) helper.exit();
  }

  get helper() {
    return this.started.at(-1)?.helper;
  }
}
