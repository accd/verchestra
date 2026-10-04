import { EventEmitter, once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

const roots = [];
const clients = [];

// invariant: no wait on a real pipe, its helper, or its relay is unbounded. A
// case on the real pipe has this long in all; each wait inside it has the
// shorter bound, longer than the helper's 30-second start and the 30 seconds
// libuv waits for a busy pipe, so a wait that never ends fails with what it
// waited for instead of stalling the stage.
export const PIPE_CASE = Object.freeze({ timeout: 120_000 });
export const PIPE_WAIT_MS = 45_000;

export function settlesWithin(promise, label, diagnosis = () => "", timeoutMs = PIPE_WAIT_MS) {
  let timer;
  const expired = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${timeoutMs} ms${diagnosis()}`)),
      timeoutMs
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// invariant: the relay of a case on the real pipe, each wait on it bounded and
// named, with the relay's own refusal line as the diagnostic.
export function boundedRelay(relay) {
  const diagnosis = () => `; relay stderr: ${JSON.stringify(relay.stderr().slice(-512))}`;
  const bounded = (promise, label) => settlesWithin(promise, `the relay's ${label}`, diagnosis);
  return {
    stderr: () => relay.stderr(),
    initialize: () => bounded(relay.initialize(), "initialize"),
    call: (name, args) => bounded(relay.call(name, args), `${name} call`),
    exited: () => bounded(relay.exited, "exit"),
    close: () => bounded(relay.close(), "close")
  };
}

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

// why: a raw client a case left open would keep the suite's process alive
// after a bounded wait failed, so every one is destroyed here.
export async function cleanupPlainWorktrees() {
  for (const socket of clients.splice(0)) socket.destroy();
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
  clients.push(socket);
  let data = "";
  let connected = false;
  socket.on("connect", () => (connected = true));
  socket.on("data", (chunk) => (data += chunk));
  socket.on("error", () => undefined);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  // why: observed from the start, so a connect that comes before a case asks
  // is not missed; a client the pipe refuses is not an unhandled rejection.
  const connecting = once(socket, "connect");
  connecting.catch(() => undefined);
  const diagnosis = () => `; connected: ${connected}; ${data.length} bytes received`;
  return {
    socket,
    closed,
    connectedWithin: () => settlesWithin(connecting, "the pipe client's connect", diagnosis),
    closedWithin: () => settlesWithin(closed, "the pipe client's close", diagnosis),
    data: () => data,
    connected: () => connected
  };
}

// invariant: a DETERMINISTIC FAKE of the PowerShell 7 helper. Its status lines
// go out on stderr exactly as the helper's do, and its stdout and stdin stand
// for the bytes the pipe client wrote and the bytes it is sent. It never ends
// on its own when its streams close, as a helper blocked in a pipe read
// would not; only `exit`, a tree termination that reaches it, or `kill` end it.
export class FakePipeHelper extends EventEmitter {
  pid = 4242;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  received = "";
  kills = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk) => (this.received += chunk));
  }

  status(line) {
    this.stderr.write(`${line}\r\n`);
  }

  kill(signal) {
    this.kills.push(signal);
    this.exit();
    return true;
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
  // why: the tree terminator `ends` the helper, `misses` it and returns as a
  // failed `taskkill` does, or `hangs` and never returns.
  tree = "ends";

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

  terminateTree(pid) {
    this.terminated.push(pid);
    if (this.tree === "hangs") return new Promise(() => undefined);
    if (this.tree === "ends") for (const { helper } of this.started) if (helper.pid === pid) helper.exit();
    return Promise.resolve();
  }

  get helper() {
    return this.started.at(-1)?.helper;
  }
}
