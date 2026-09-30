import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";

import { killProcesses, snapshotDescendants, terminateProcessGroup } from "./process-tree-terminator.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SECRET_LIKE_NAME = /SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH|SESSION|COOKIE/u;
const ENTRY_EXTENSION = /^\.[a-z0-9]{1,8}$/u;
const MAXIMUM_ENTRY_BYTES = 16 * 1024 * 1024;
const RESERVED_ENVIRONMENT = new Set(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]);
const BASE_PATH = "/usr/bin:/bin";
const SECRET_SHAPES = [
  /\bBEGIN [A-Z ]*PRIVATE KEY\b[\s\S]*/gu,
  /\b(?:sk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{12,}/gu,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/giu,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/giu,
  /\b[a-f0-9]{40,}\b/gu
];

export class SpawnedProbeWorkerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpawnedProbeWorkerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SpawnedProbeWorkerError(code, message);
}

export interface SpawnedProbeWorkerLimits {
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stderrExcerptBytes: number;
  readonly exitWaitMs: number;
}

export interface SpawnedProbeWorkerOptions {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly entry: { readonly path: string; readonly digest: string };
  readonly workspaceId: string;
  readonly limits?: Partial<SpawnedProbeWorkerLimits>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly platform?: NodeJS.Platform;
}

export interface ProbeTransportListener {
  data(chunk: Uint8Array): void;
  fault(fault: { readonly code: string; readonly message: string }): void;
  exit(): void;
}

export interface SpawnedProbeWorkerDiagnostics {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stderrDigest: string;
  readonly stderrExcerpt: string;
  readonly stderrTruncated: boolean;
  readonly stderrRedactions: number;
  readonly terminated: boolean;
  readonly workDirectoryRemoved: boolean;
}

const DEFAULT_LIMITS: SpawnedProbeWorkerLimits = Object.freeze({
  stdoutBytes: 8 * 1024 * 1024,
  stderrBytes: 256 * 1024,
  stderrExcerptBytes: 2048,
  exitWaitMs: 2_000
});

function positiveLimits(requested: Partial<SpawnedProbeWorkerLimits> | undefined): SpawnedProbeWorkerLimits {
  const limits = { ...DEFAULT_LIMITS, ...requested };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      fail("VES_PROBE_HOST_INPUT_INVALID", "Probe host limits are invalid");
  if (limits.stderrExcerptBytes > limits.stderrBytes)
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe host stderr excerpt exceeds its stream limit");
  return Object.freeze(limits);
}

function childEnvironment(
  workDirectory: string,
  workspaceId: string,
  extra: Readonly<Record<string, string>> | undefined
): NodeJS.ProcessEnv {
  // invariant: the child environment is built from nothing, never copied from
  // process.env, so no ambient credential, token, or provider session reaches the
  // worker. The Workspace id repeats the binding every envelope already carries.
  const environment: NodeJS.ProcessEnv = {
    PATH: BASE_PATH,
    HOME: workDirectory,
    TMPDIR: workDirectory,
    LANG: "C",
    LC_ALL: "C",
    VERCHESTRA_PROBE_PROTOCOL: "verchestra-probe/1",
    VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId
  };
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (!permittedEnvironmentName(name) || Object.hasOwn(environment, name))
      fail("VES_PROBE_HOST_ENVIRONMENT_DENIED", "Probe worker environment name is not permitted");
    if (typeof value !== "string" || value.length > 4096 || value.includes("\0"))
      fail("VES_PROBE_HOST_ENVIRONMENT_DENIED", "Probe worker environment value is not permitted");
    environment[name] = value;
  }
  return environment;
}

function permittedEnvironmentName(name: string): boolean {
  return ENVIRONMENT_NAME.test(name) && !RESERVED_ENVIRONMENT.has(name) && !SECRET_LIKE_NAME.test(name);
}

function validateLaunchInput(options: SpawnedProbeWorkerOptions): void {
  if ((options.platform ?? process.platform) === "win32")
    fail("VES_PROBE_HOST_PLATFORM_UNSUPPORTED", "The out-of-process probe host is qualified on POSIX hosts only");
  if (typeof options.workspaceId !== "string" || !WORKSPACE.test(options.workspaceId))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker Workspace is invalid");
  if (!isAbsolute(options.executable) || !isAbsolute(options.entry.path) || !DIGEST.test(options.entry.digest))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker executable, entry, or digest is invalid");
  validateLaunchArguments(options);
}

function validateLaunchArguments(options: SpawnedProbeWorkerOptions): void {
  if ((options.args ?? []).some((argument) => typeof argument !== "string" || argument.includes("\0")))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker argument is invalid");
  const extension = extname(options.entry.path);
  if (extension !== "" && !ENTRY_EXTENSION.test(extension))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker entry extension is invalid");
}

async function readApprovedEntry(options: SpawnedProbeWorkerOptions): Promise<{ executable: string; entry: Buffer }> {
  let executable: string;
  let entry: Buffer;
  try {
    executable = await realpath(options.executable);
    if ((await stat(options.entry.path)).size > MAXIMUM_ENTRY_BYTES) throw new Error("oversized");
    entry = await readFile(options.entry.path);
  } catch {
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker executable or entry is unavailable");
  }
  if (`sha256:${createHash("sha256").update(entry).digest("hex")}` !== options.entry.digest)
    fail("VES_PROBE_HOST_ENTRY_DIGEST", "Probe worker entry does not match its approved digest");
  return { executable, entry };
}

function sanitizeExcerpt(bytes: Buffer): { readonly text: string; readonly redactions: number } {
  let redactions = 0;
  let text = bytes.toString("utf8").replaceAll(/[^\n\t\x20-\x7e]/gu, "?");
  for (const shape of SECRET_SHAPES) {
    text = text.replace(shape, () => {
      redactions += 1;
      return "[redacted]";
    });
  }
  return { text, redactions };
}

type TransportEvent =
  | { readonly kind: "data"; readonly chunk: Uint8Array }
  | { readonly kind: "fault"; readonly code: string; readonly message: string }
  | { readonly kind: "exit" };

// invariant: one instance owns exactly one child process, one private work
// directory, and one process group. Every exit path funnels through terminate(),
// which kills the group, sweeps setsid() escapees, and removes the directory.
export class SpawnedProbeWorker {
  readonly launchedComponentDigest: string;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #workDirectory: string;
  readonly #limits: SpawnedProbeWorkerLimits;
  readonly #stderrHash = createHash("sha256");
  #stderrExcerpt = Buffer.alloc(0);
  #stderrBytes = 0;
  #stdoutBytes = 0;
  #exitCode: number | null = null;
  #signal: string | null = null;
  #exited = false;
  readonly #closed: Promise<void>;
  #listener: ProbeTransportListener | undefined;
  readonly #pending: TransportEvent[] = [];
  #termination: Promise<void> | undefined;
  #terminated = false;
  #workDirectoryRemoved = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    workDirectory: string,
    digest: string,
    limits: SpawnedProbeWorkerLimits
  ) {
    this.#child = child;
    this.#workDirectory = workDirectory;
    this.launchedComponentDigest = digest;
    this.#limits = limits;
    this.#closed = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.#exited = true;
        this.#exitCode = code;
        this.#signal = signal;
        this.#emit({ kind: "exit" });
        resolve();
      });
    });
    child.once("error", () =>
      this.#emit({ kind: "fault", code: "VES_PROBE_HOST_SPAWN_FAILED", message: "Probe worker could not be started" })
    );
    // why: a worker that exits or closes stdin early turns every write into
    // EPIPE; the exit event already reports that, so the stream error is absorbed.
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => this.#stdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#stderr(chunk));
  }

  static async launch(options: SpawnedProbeWorkerOptions): Promise<SpawnedProbeWorker> {
    const limits = positiveLimits(options.limits);
    validateLaunchInput(options);
    const { executable, entry } = await readApprovedEntry(options);
    const workDirectory = await realpath(await mkdtemp(join(tmpdir(), "verchestra-probe-")));
    try {
      await chmod(workDirectory, 0o700);
      const environment = childEnvironment(workDirectory, options.workspaceId, options.environment);
      // invariant: the executed file is the private copy written from the exact
      // bytes that were hashed, so a later change to the workspace file cannot
      // swap the code between the digest check and exec.
      const copy = join(workDirectory, `worker${extname(options.entry.path)}`);
      await writeFile(copy, entry, { flag: "wx", mode: 0o500 });
      const child = spawn(executable, [...(options.args ?? []), copy], {
        cwd: workDirectory,
        env: environment,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      return new SpawnedProbeWorker(child, workDirectory, options.entry.digest, limits);
    } catch (error) {
      await rm(workDirectory, { recursive: true, force: true });
      if (error instanceof SpawnedProbeWorkerError) throw error;
      fail("VES_PROBE_HOST_SPAWN_FAILED", "Probe worker could not be started");
    }
  }

  get pid(): number {
    return this.#child.pid ?? -1;
  }

  attach(listener: ProbeTransportListener): void {
    if (this.#listener !== undefined)
      fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker transport is already attached");
    this.#listener = listener;
    for (const event of this.#pending.splice(0)) this.#dispatch(event);
  }

  send(frame: Uint8Array): Promise<void> {
    if (this.#exited || this.#terminated || this.#child.stdin.destroyed)
      return Promise.reject(
        new SpawnedProbeWorkerError("VES_PROBE_HOST_CHANNEL_CLOSED", "Probe worker channel is closed")
      );
    return new Promise((resolve, reject) => {
      // invariant: resolution waits for the write callback, so a caller that
      // zeroizes the frame afterwards cannot race Node's internal write queue.
      this.#child.stdin.write(frame, (error) =>
        error
          ? reject(new SpawnedProbeWorkerError("VES_PROBE_HOST_CHANNEL_CLOSED", "Probe worker channel is closed"))
          : resolve()
      );
    });
  }

  // why: a worker can echo protected material to stderr. The retained excerpt is
  // the only stderr text the host keeps, so every occurrence is overwritten there
  // before the caller zeroizes its own copy.
  withhold(material: Uint8Array): void {
    if (material.byteLength === 0) return;
    const needle = Buffer.from(material);
    for (let index = this.#stderrExcerpt.indexOf(needle); index >= 0; index = this.#stderrExcerpt.indexOf(needle)) {
      this.#stderrExcerpt.fill(0x2a, index, index + needle.byteLength);
    }
    needle.fill(0);
  }

  terminate(): Promise<void> {
    this.#termination ??= this.#terminate();
    return this.#termination;
  }

  diagnostics(): SpawnedProbeWorkerDiagnostics {
    const excerpt = sanitizeExcerpt(this.#stderrExcerpt);
    return Object.freeze({
      pid: this.pid,
      exitCode: this.#exitCode,
      signal: this.#signal,
      stdoutBytes: this.#stdoutBytes,
      stderrBytes: this.#stderrBytes,
      stderrDigest: `sha256:${this.#stderrHash.copy().digest("hex")}`,
      stderrExcerpt: excerpt.text,
      stderrTruncated: this.#stderrBytes > this.#stderrExcerpt.byteLength,
      stderrRedactions: excerpt.redactions,
      terminated: this.#terminated,
      workDirectoryRemoved: this.#workDirectoryRemoved
    });
  }

  async #terminate(): Promise<void> {
    this.#terminated = true;
    const pid = this.#child.pid;
    try {
      if (pid !== undefined) {
        const escapees = await snapshotDescendants(pid);
        try {
          await terminateProcessGroup(pid, () =>
            fail("VES_PROBE_HOST_TERMINATION_INCOMPLETE", "Probe worker process group remained alive after termination")
          );
        } finally {
          killProcesses(escapees);
        }
      }
      this.#child.stdin.destroy();
      await Promise.race([
        this.#closed,
        new Promise((resolve) => setTimeout(resolve, this.#limits.exitWaitMs).unref())
      ]);
    } finally {
      await rm(this.#workDirectory, { recursive: true, force: true });
      this.#workDirectoryRemoved = true;
    }
  }

  #stdout(chunk: Buffer): void {
    this.#stdoutBytes += chunk.byteLength;
    if (this.#stdoutBytes > this.#limits.stdoutBytes) {
      this.#overflow("VES_PROBE_HOST_STDOUT_LIMIT", "Probe worker output exceeded its limit");
      return;
    }
    this.#emit({ kind: "data", chunk });
  }

  #stderr(chunk: Buffer): void {
    this.#stderrBytes += chunk.byteLength;
    this.#stderrHash.update(chunk);
    const room = this.#limits.stderrExcerptBytes - this.#stderrExcerpt.byteLength;
    if (room > 0) this.#stderrExcerpt = Buffer.concat([this.#stderrExcerpt, chunk.subarray(0, room)]);
    if (this.#stderrBytes > this.#limits.stderrBytes)
      this.#overflow("VES_PROBE_HOST_STDERR_LIMIT", "Probe worker diagnostics exceeded their limit");
  }

  #overflow(code: string, message: string): void {
    if (this.#terminated) return;
    this.#emit({ kind: "fault", code, message });
    void this.terminate().catch(() => undefined);
  }

  #emit(event: TransportEvent): void {
    if (this.#listener === undefined) this.#pending.push(event);
    else this.#dispatch(event);
  }

  #dispatch(event: TransportEvent): void {
    const listener = this.#listener as ProbeTransportListener;
    if (event.kind === "data") listener.data(event.chunk);
    else if (event.kind === "fault") listener.fault({ code: event.code, message: event.message });
    else listener.exit();
  }
}
