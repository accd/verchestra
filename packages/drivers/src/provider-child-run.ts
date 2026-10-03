import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import {
  OWN_PROCESS_GROUP,
  singleTermination,
  unawaitedTermination,
  type ProcessTreeTerminator
} from "./driver-process-tree.ts";
import type { DriverSession, DriverSessionOutcome } from "./driver-session-ledger.ts";

// why: how much a provider may write, its output and error streams together,
// when its execution states no limit.
const DEFAULT_OUTPUT_LIMIT = 1_048_576;

// invariant: what differs between the providers this module runs. A run
// reports `<prefix>_ABORTED`, `<prefix>_OUTPUT_LIMIT`, `<prefix>_STREAM_INVALID`,
// `<prefix>_STDIN_FAILED`, `<prefix>_PROTOCOL_FAILED`, `<prefix>_STREAM_INCOMPLETE`
// and `<prefix>_PROCESS_FAILED`, and the codes its protocol fails a stream
// with; each driver names its own beside its profile.
export interface ProviderChildProfile {
  readonly errorCodePrefix: string;
  readonly noun: string;
  // why: a failed stream is named for what the provider speaks, as
  // "<noun> <streamName> failed".
  readonly streamName: string;
  // invariant: how a provider ends once its result has arrived. One that
  // exits by itself is waited for, and its exit status is part of its result.
  // One the driver ends is ended once its run has settled; the status that
  // follows says how it was ended, so it is not read.
  readonly afterResult: "exits-by-itself" | "ended-by-the-driver";
}

export interface ProviderChildLaunch {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number | undefined;
  // why: a provider that can be asked to interrupt its work is given this
  // long to stop after the start signal aborts; without it the start signal
  // ends the provider at once.
  readonly abortGraceMs?: number | undefined;
}

export interface ProviderChildResources {
  stop?: () => Promise<void>;
}

// invariant: all a protocol may do with its provider child: write a frame,
// write the last frame and close the input, fail the stream, say that its
// result arrived, and read whether a stop came first or the provider is being
// ended. A frame is one line; the line ending is the run's.
export interface ProviderChannel {
  write(frame: string): void;
  end(frame: string): void;
  fail(code: string): void;
  result(): void;
  stopped(): boolean;
  ending(): boolean;
}

// invariant: one protocol translation. `receive` gets every line of the
// provider's output that is a JSON object, in order, failures included, so a
// provider's last words reach the sink before the run's error. `converse`
// writes what the provider is asked and resolves once nothing more is to be
// asked; a rejection is a failed conversation. `interrupt` asks the provider
// to stop its work when the start signal aborts; `closed` runs once the
// provider's process and output are gone.
export interface ProviderProtocol {
  receive(message: Readonly<Record<string, unknown>>): void;
  converse(): Promise<void>;
  interrupt?(): void;
  closed?(): void;
}

export interface ProviderChildRun {
  readonly profile: ProviderChildProfile;
  readonly launch: ProviderChildLaunch;
  readonly session: DriverSession<ProviderChildResources>;
  readonly signal: AbortSignal;
  readonly terminateTree: ProcessTreeTerminator;
  readonly onSpawn?: ((pid: number) => void) | undefined;
  readonly protocol: (channel: ProviderChannel) => ProviderProtocol;
}

type RunCode =
  | "ABORTED"
  | "OUTPUT_LIMIT"
  | "STREAM_INVALID"
  | "STDIN_FAILED"
  | "PROTOCOL_FAILED"
  | "STREAM_INCOMPLETE"
  | "PROCESS_FAILED";

// invariant: the first end of a run decides its report: a stop, or a failure
// with its code. Whatever ends the run later still ends the provider, and
// changes nothing in the report.
type RunEnd = { readonly kind: "stop" } | { readonly kind: "failure"; readonly code: string };

interface ProviderExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface EndReport {
  readonly outcome: DriverSessionOutcome;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const STOP: RunEnd = Object.freeze({ kind: "stop" });

// invariant: every line a provider writes is a JSON object. A line that parses
// to anything else is a broken stream: `null` must not reach a member read,
// and a string must not be taken for a value the provider chose.
function jsonObject(line: string): Readonly<Record<string, unknown>> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

// invariant: the action runs after at least one poll phase of the event loop,
// whatever phase asks: the check phase follows the poll phase of its own turn,
// so of two immediates in a row the second always comes after a poll.
function afterPendingEvents(action: () => void): void {
  setImmediate(() => setImmediate(action));
}

class ProviderChild {
  readonly #run: ProviderChildRun;
  readonly #limit: number;
  readonly #settled: Promise<void>;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #protocol: ProviderProtocol;
  readonly #lines: Interface;
  readonly #exited: Promise<ProviderExit>;
  #settle = (): void => undefined;
  #terminate = async (): Promise<void> => undefined;
  // invariant: an end no caller awaits contains a termination that fails; a
  // stop that a cancel awaits does not, so that cancel still rejects.
  readonly #terminateUnawaited = unawaitedTermination(() => this.#terminate());
  #end: RunEnd | undefined;
  #failed = false;
  #ending = false;
  #result = false;
  #outputBytes = 0;

  constructor(run: ProviderChildRun) {
    this.#run = run;
    this.#limit = run.launch.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT;
    this.#settled = new Promise((resolve) => (this.#settle = resolve));
    this.#child = spawn(run.launch.command, [...run.launch.arguments], {
      cwd: run.launch.cwd,
      env: run.launch.environment,
      stdio: ["pipe", "pipe", "pipe"],
      detached: OWN_PROCESS_GROUP,
      windowsHide: true
    });
    // why: a spawn that fails (the executable went after its probe, or the
    // system refused the process) is reported by an `error` event and then a
    // close with a negative code. Unheard, that event ends the host process;
    // heard, the close ends the run as a provider that died.
    this.#child.on("error", () => undefined);
    this.#wireStop();
    this.#protocol = run.protocol(this.#channel());
    this.#child.stderr.on("data", (chunk: Buffer) => this.#withinLimit(chunk.length));
    // why: a failed write is weighed once the output and the exit that were
    // already waiting have been read.
    this.#child.stdin.on("error", () => afterPendingEvents(() => this.#inputFailed()));
    this.#lines = createInterface({ input: this.#child.stdout, crlfDelay: Infinity });
    this.#lines.on("line", (line) => this.#line(line));
    this.#exited = new Promise((resolve) =>
      this.#child.once("close", (code, signal) => {
        this.#protocol.closed?.();
        this.#settle();
        resolve({ code, signal });
      })
    );
    run.signal.addEventListener("abort", this.#abort, { once: true });
  }

  async ended(): Promise<void> {
    try {
      await this.#protocol.converse();
      await this.#settled;
    } catch {
      this.#conversationFailed();
    }
    if (this.#run.profile.afterResult === "ended-by-the-driver" && this.#running()) this.#endChild();
    const exit = await this.#exited;
    this.#run.signal.removeEventListener("abort", this.#abort);
    this.#lines.close();
    this.#report(exit);
  }

  // invariant: one termination per child, whoever asks: the start signal, a
  // cancel, a stream that failed, or the end of the run.
  #wireStop(): void {
    const pid = this.#child.pid;
    if (pid === undefined) return;
    this.#terminate = singleTermination(this.#run.terminateTree, pid);
    // invariant: a stop marks the run before the provider is terminated, so
    // the run ends as stopped and not as a process that died.
    this.#run.session.resources.stop = () => {
      this.#stopRequested();
      return this.#terminate();
    };
    this.#run.onSpawn?.(pid);
  }

  #channel(): ProviderChannel {
    return Object.freeze({
      write: (frame: string) => {
        this.#child.stdin.write(`${frame}\n`);
      },
      end: (frame: string) => {
        this.#child.stdin.end(`${frame}\n`);
      },
      fail: (code: string) => this.#fail(code),
      result: () => {
        this.#result = true;
        this.#settle();
      },
      stopped: () => this.#end === STOP,
      ending: () => this.#ending
    });
  }

  #line(line: string): void {
    if (!this.#withinLimit(Buffer.byteLength(line) + 1)) return;
    const message = jsonObject(line);
    if (message === undefined) return this.#fail(this.#code("STREAM_INVALID"));
    this.#protocol.receive(message);
  }

  #withinLimit(bytes: number): boolean {
    this.#outputBytes += bytes;
    if (this.#outputBytes <= this.#limit) return true;
    this.#fail(this.#code("OUTPUT_LIMIT"));
    return false;
  }

  // invariant: a provider whose input can no longer be written to cannot be
  // given what it is asked, so it is ended like a stream that failed. A
  // provider that delivered its result, or that has exited, asked for nothing
  // more: a fast provider can finish and exit before the run's first write,
  // and its output and exit decide its run, not the write that found it gone.
  #inputFailed(): void {
    if (this.#end === undefined && !this.#result && this.#running()) this.#fail(this.#code("STDIN_FAILED"));
  }

  #fail(code: string): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#end ??= { kind: "failure", code };
    this.#settle();
    this.#endChild();
  }

  // why: a failed conversation has nothing more to ask and ends nothing itself;
  // a provider the driver ends is ended with the run, while it still runs.
  #conversationFailed(): void {
    if (this.#end !== undefined) return;
    this.#failed = true;
    this.#end = { kind: "failure", code: this.#code("PROTOCOL_FAILED") };
  }

  #stopRequested(): void {
    this.#end ??= STOP;
  }

  #endChild(): void {
    this.#ending = true;
    this.#terminateUnawaited();
  }

  // why: the start signal stops the provider at once, or, for a provider that
  // can be interrupted, asks it to stop and ends it after the grace period.
  readonly #abort = (): void => {
    const stoppedBefore = this.#end === STOP;
    this.#stopRequested();
    const grace = this.#run.launch.abortGraceMs;
    if (grace === undefined) return this.#terminateUnawaited();
    if (stoppedBefore) return;
    this.#protocol.interrupt?.();
    const timer = setTimeout(() => {
      if (this.#running()) this.#terminateUnawaited();
    }, grace);
    timer.unref();
  };

  #running(): boolean {
    return this.#child.exitCode === null && this.#child.signalCode === null;
  }

  #report(exit: ProviderExit): void {
    const report = this.#endReport(exit);
    if (report === undefined) return;
    this.#run.session.outcome = report.outcome;
    const { code, message, retryable } = report;
    this.#run.session.emit({ type: "error", code, message, retryable });
  }

  // invariant: the one end-of-run rule. The first end decides when there is
  // one. Otherwise a run whose result never arrived failed: as a process when
  // the provider ended with a non-zero code or a signal, as an incomplete
  // stream when it exited cleanly. After a result, the exit status counts only
  // for a provider that exits by itself.
  #endReport(exit: ProviderExit): EndReport | undefined {
    const { noun, streamName, afterResult } = this.#run.profile;
    const end = this.#end;
    if (end?.kind === "stop")
      return { outcome: "cancelled", code: this.#code("ABORTED"), message: `${noun} was aborted`, retryable: true };
    if (end?.kind === "failure")
      return { outcome: "failed", code: end.code, message: `${noun} ${streamName} failed`, retryable: false };
    const exitedCleanly = exit.code === 0;
    if (!this.#result) return this.#processFailure(exitedCleanly ? "STREAM_INCOMPLETE" : "PROCESS_FAILED");
    return afterResult === "exits-by-itself" && !exitedCleanly ? this.#processFailure("PROCESS_FAILED") : undefined;
  }

  #processFailure(code: RunCode): EndReport {
    return {
      outcome: "failed",
      code: this.#code(code),
      message: `${this.#run.profile.noun} process failed`,
      retryable: false
    };
  }

  #code(code: RunCode): string {
    return `${this.#run.profile.errorCodePrefix}_${code}`;
  }
}

// invariant: one provider child, run to its end: spawned in a process group of
// its own, held to its output limit, read one JSON object per line, stopped
// through one termination of its tree, and reported by one end-of-run rule.
// The run is bracketed in the session, so a cancel waits for its report.
export async function runProviderChild(run: ProviderChildRun): Promise<void> {
  const runEnded = run.session.runStarted();
  try {
    await new ProviderChild(run).ended();
  } finally {
    runEnded();
  }
  delete run.session.resources.stop;
}
