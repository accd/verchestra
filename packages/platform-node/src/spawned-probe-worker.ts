import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";

import { probeLaunchDigest } from "./probe-launch-digest.ts";
import { terminateStoppedTree } from "./process-tree-terminator.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SECRET_LIKE_NAME = /SECRET|TOKEN|PASSW|CREDENTIAL|PRIVATE|API_?KEY|ACCESS_?KEY|AUTH|SESSION|COOKIE/u;
// why: names a loader, runtime or shell reads to load more code than the
// approved entry. A grant could bind `NODE_OPTIONS=--require x` but never the
// bytes of `x`, so these are refused whatever the grant says (#569, PHC-02).
const LOADER_NAME =
  /^(?:NODE_|LD_|DYLD_|PYTHON|PERL5|(?:PERLLIB|RUBYOPT|RUBYLIB|BASH_ENV|ENV|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|GLIBC_TUNABLES|GCONV_PATH)$)/u;
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
  // invariant: the launch digest the approval and the grant name. A launch that
  // measures otherwise is refused before anything starts, as the entry is.
  readonly approvedLaunchDigest: string;
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

function baseEnvironment(workDirectory: string, workspaceId: string): NodeJS.ProcessEnv {
  // invariant: the child environment is built from nothing, never copied from
  // process.env, so no ambient credential, token, or provider session reaches the
  // worker. The Workspace id repeats the binding every envelope already carries.
  return {
    PATH: BASE_PATH,
    HOME: workDirectory,
    TMPDIR: workDirectory,
    LANG: "C",
    LC_ALL: "C",
    VERCHESTRA_PROBE_PROTOCOL: "verchestra-probe/1",
    VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId
  };
}

// invariant: the one rule for the environment extras of a probe worker launch.
// The host applies it before it starts a worker, and whoever approves a launch
// applies it before measuring one, so an approval can never name a variable
// the host would refuse (.specs/features/probe-host-composition/plan.md, AC 7).
export function assertProbeWorkerEnvironment(extra: Readonly<Record<string, string>> | undefined): void {
  const base = baseEnvironment("", "");
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (!permittedEnvironmentName(name) || Object.hasOwn(base, name))
      fail("VES_PROBE_HOST_ENVIRONMENT_DENIED", "Probe worker environment name is not permitted");
    if (typeof value !== "string" || value.length > 4096 || value.includes("\0"))
      fail("VES_PROBE_HOST_ENVIRONMENT_DENIED", "Probe worker environment value is not permitted");
  }
}

function childEnvironment(
  workDirectory: string,
  workspaceId: string,
  extra: Readonly<Record<string, string>> | undefined
): NodeJS.ProcessEnv {
  assertProbeWorkerEnvironment(extra);
  return { ...baseEnvironment(workDirectory, workspaceId), ...extra };
}

function permittedEnvironmentName(name: string): boolean {
  return (
    ENVIRONMENT_NAME.test(name) &&
    !RESERVED_ENVIRONMENT.has(name) &&
    !SECRET_LIKE_NAME.test(name) &&
    !LOADER_NAME.test(name)
  );
}

function validateLaunchInput(options: SpawnedProbeWorkerOptions): void {
  if ((options.platform ?? process.platform) === "win32")
    fail("VES_PROBE_HOST_PLATFORM_UNSUPPORTED", "The out-of-process probe host is qualified on POSIX hosts only");
  if (typeof options.workspaceId !== "string" || !WORKSPACE.test(options.workspaceId))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker Workspace is invalid");
  if (!isAbsolute(options.executable) || !isAbsolute(options.entry.path) || !DIGEST.test(options.entry.digest))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker executable, entry, or digest is invalid");
  if (!DIGEST.test(String(options.approvedLaunchDigest)))
    fail("VES_PROBE_HOST_INPUT_INVALID", "Probe worker approved launch digest is invalid");
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

export interface ProbeWorkerTermination {
  // invariant: true only if the worker had not exited when the host stopped its
  // tree. A worker that exits first has orphaned its children, so the sweep
  // cannot be claimed complete for it.
  readonly running: boolean;
}

// invariant: one instance owns exactly one child process, one private work
// directory, and one process group. Every exit path funnels through terminate(),
// which stops the tree, kills it, checks its output reached end of file, and
// removes the directory.
export class SpawnedProbeWorker {
  readonly launchedComponentDigest: string;
  // invariant: measured by the host over what it started (probeLaunchDigest),
  // never reported by the worker.
  readonly launchDigest: string;
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
  #termination: Promise<ProbeWorkerTermination> | undefined;
  #terminated = false;
  #spawnFailed = false;
  #workDirectoryRemoved = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    workDirectory: string,
    digests: { readonly component: string; readonly launch: string },
    limits: SpawnedProbeWorkerLimits
  ) {
    this.#child = child;
    this.#workDirectory = workDirectory;
    this.launchedComponentDigest = digests.component;
    this.launchDigest = digests.launch;
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
    child.once("error", () => {
      this.#spawnFailed = true;
      this.#emit({ kind: "fault", code: "VES_PROBE_HOST_SPAWN_FAILED", message: "Probe worker could not be started" });
    });
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
      const launch = await probeLaunchDigest({ ...options, executable });
      if (launch !== options.approvedLaunchDigest)
        fail("VES_PROBE_HOST_LAUNCH_DIGEST", "Probe worker launch does not match its approved launch");
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
      return new SpawnedProbeWorker(child, workDirectory, { component: options.entry.digest, launch }, limits);
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

  terminate(): Promise<ProbeWorkerTermination> {
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

  async #terminate(): Promise<ProbeWorkerTermination> {
    this.#terminated = true;
    const pid = this.#child.pid;
    try {
      if (pid === undefined || this.#spawnFailed) {
        this.#child.stdin.destroy();
        return { running: false };
      }
      const { running } = await terminateStoppedTree(pid, {
        exited: () => this.#child.exitCode !== null || this.#child.signalCode !== null,
        incomplete: () =>
          fail("VES_PROBE_HOST_TERMINATION_INCOMPLETE", "Probe worker process tree remained alive after termination")
      });
      this.#child.stdin.destroy();
      // invariant: every process the host found is dead, so output that never
      // reaches end of file is held by one it could not find: a descendant a
      // double fork orphaned before the tree was stopped (#569, PHC-07).
      if (!(await this.#closedWithin(this.#limits.exitWaitMs)))
        fail("VES_PROBE_HOST_TERMINATION_INCOMPLETE", "A process outside the worker's tree still holds its output");
      return { running };
    } finally {
      await rm(this.#workDirectory, { recursive: true, force: true });
      this.#workDirectoryRemoved = true;
    }
  }

  #closedWithin(milliseconds: number): Promise<boolean> {
    return Promise.race([
      this.#closed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds).unref())
    ]);
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
