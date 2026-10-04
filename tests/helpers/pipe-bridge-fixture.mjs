import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { terminateProcessTree } from "../../packages/platform-node/src/process-tree-terminator.ts";
import { pipeEndpoint } from "../../packages/platform-node/src/windows-pipe-transport.ts";

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
  let isClosed = false;
  let error = null;
  socket.on("connect", () => (connected = true));
  socket.on("data", (chunk) => (data += chunk));
  socket.on("error", (cause) => (error ??= cause.code ?? "error"));
  const closed = new Promise((resolve) => socket.once("close", resolve));
  void closed.then(() => (isClosed = true));
  // why: observed from the start, so a connect that comes before a case asks
  // is not missed; a client the pipe refuses is not an unhandled rejection.
  const connecting = once(socket, "connect");
  connecting.catch(() => undefined);
  // invariant: the client's side of a diagnosis: whether it connected and
  // closed, the code of its first error, what it received, and what of its
  // writes is still waiting, in Node (`writableLength`) and in libuv, which
  // holds a write the pipe has not taken (`writeQueueSize`).
  const state = () => ({
    connected,
    closed: isClosed,
    error,
    received: data.length,
    writableLength: socket.writableLength,
    writeQueueSize: socket._handle?.writeQueueSize ?? null
  });
  const diagnosis = () => `; client ${JSON.stringify(state())}`;
  return {
    socket,
    closed,
    connectedWithin: () => settlesWithin(connecting, "the pipe client's connect", diagnosis),
    closedWithin: () => settlesWithin(closed, "the pipe client's close", diagnosis),
    data: () => data,
    connected: () => connected,
    isClosed: () => isClosed,
    state
  };
}

// why: a named pipe exists while any process holds a server end of it, and
// Windows lists the pipe namespace as a directory, so whether the server end
// is gone is read without connecting to it. Off Windows there is no such
// namespace: undefined.
export async function pipeListed(endpoint) {
  if (process.platform !== "win32") return undefined;
  const name = endpoint.slice(endpoint.lastIndexOf("\\") + 1);
  return readdir("\\\\.\\pipe\\").then(
    (names) => names.includes(name),
    () => null
  );
}

// invariant: a bounded trace of one channel for a diagnosis: the transport's
// own steps (PipeChannelEvent), each at its milliseconds since the trace
// began, and how many bytes of the connection reached the controller.
export function pipeTrace() {
  const began = Date.now();
  const events = [];
  let reached = 0;
  const observe = (event) => {
    if (events.length < 64) events.push({ at: Date.now() - began, ...event });
  };
  return {
    observe,
    saw: (step) => events.some((event) => event.step === step),
    reached: () => reached,
    events: () => [...events],
    // why: the transport the controller listens on, counting what of the
    // connection reaches the controller beside it.
    counting: (transport) => ({
      listen: (accept) =>
        transport.listen((connection) => {
          connection.on("data", (chunk) => (reached += chunk.length));
          accept(connection);
        })
    }),
    describe: (extra) => JSON.stringify({ ...extra, reached, events })
  };
}

// invariant: one link of a guarantee, waited for within the bound and named,
// with the trace that tells which link broke.
export async function reaches(probe, label, diagnosis) {
  const deadline = Date.now() + PIPE_WAIT_MS;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} was not reached within ${PIPE_WAIT_MS} ms; ${await diagnosis()}`);
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

// invariant: what a refused channel guarantees, link by link, each bounded and
// diagnosed with its trace: the controller refuses the client, the helper
// ends, the pipe's server end is gone (on Windows, where the pipe namespace
// shows it), and the client is disconnected. A failure names the link that
// broke: no refusal (the frame never reached the controller), a helper that
// did not end, a server end that outlived its helper, or a client that did
// not see it.
export async function assertRefusalEnds({ controller, trace, client, endpoint }) {
  const diagnosis = async () =>
    trace.describe({
      rejected: controller.statistics().rejectedConnections,
      client: client.state(),
      listed: await pipeListed(endpoint)
    });
  await reaches(() => controller.statistics().rejectedConnections === 1, "the controller's refusal", diagnosis);
  await reaches(() => trace.saw("helper-exited"), "the helper's end", diagnosis);
  if (process.platform === "win32")
    await reaches(async () => (await pipeListed(endpoint)) === false, "the pipe's server end gone", diagnosis);
  // why: the client's own view of the disconnect. A write it makes now fails
  // at once where no server end is left, whether or not an earlier write of
  // its own is still waiting to be taken.
  if (!client.isClosed()) client.socket.write("\n");
  await reaches(() => client.isClosed(), "the client's disconnect", diagnosis);
}

const STAND_IN = fileURLToPath(new URL("./pipe-relay-stand-in.mjs", import.meta.url));

// invariant: a host for the named-pipe transport whose helper is the real
// stand-in process (pipe-relay-stand-in.mjs) in the given mode, on any
// platform, ended through the real tree terminator. On Windows it serves the
// transport's own pipe name; elsewhere a Unix socket under `socketRoot`, the
// endpoint a client then connects to.
export function standInHost(mode, socketRoot) {
  const host = {
    platform: "win32",
    endpoint: undefined,
    powershellInstalled: () => Promise.resolve(true),
    secureDirectory: () => Promise.resolve({ proven: true, sid: SID, dacl: `D:PAI(A;OICI;FA;;;${SID})` }),
    startHelper: (_executable, args) => {
      host.endpoint = process.platform === "win32" ? pipeEndpoint(args.at(-1)) : join(socketRoot, "s.sock");
      return spawn(process.execPath, [STAND_IN, host.endpoint, mode], {
        stdio: "pipe",
        // why: as every provider tree is started on POSIX, so its group can be ended whole.
        detached: process.platform !== "win32",
        windowsHide: true
      });
    },
    terminateTree: (pid) =>
      terminateProcessTree(pid, () => {
        throw new Error("the stand-in's tree outlived its termination");
      })
  };
  return host;
}
