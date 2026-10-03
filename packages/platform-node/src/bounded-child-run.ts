import { spawn } from "node:child_process";

import { terminateProcessGroup } from "./process-tree-terminator.ts";

export type ChildStream = "stdout" | "stderr";

export interface BoundedChildRun {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  // why: a caller may need every byte a stream carried, also past the limit
  // the captured output stops at (the gate digests each stream whole).
  readonly observe?: (stream: ChildStream, chunk: Buffer) => void;
  // invariant: what the caller throws when the child's group outlives its
  // termination; each caller names it with its own public code.
  readonly incomplete: () => never;
}

// invariant: how a bounded child ended. A child that started reports its exit,
// whether the run stopped it at its timeout or its output limit (both may
// hold), what both streams carried up to the limit in arrival order, and how
// many bytes each carried in all.
export interface BoundedChildExit {
  readonly ended: "exited";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly output: Buffer;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

// invariant: nothing here kills the child through the ChildProcess object or
// opens an IPC channel, so its `error` event can only mean it never started.
export interface BoundedChildSpawnFailure {
  readonly ended: "spawn-failed";
  readonly error: Error;
}

export type BoundedChildObservation = BoundedChildExit | BoundedChildSpawnFailure;

// invariant: the one routine that runs a child of platform-node to a time and
// an output bound. Off Windows the child leads a process group of its own, and
// a timeout or an output overflow ends that group once, through the shared
// termination; the run settles only after the child has closed and the
// termination has finished.
export async function runBoundedChild(run: BoundedChildRun): Promise<BoundedChildObservation> {
  const captured: Buffer[] = [];
  let capturedBytes = 0;
  const bytes = { stdout: 0, stderr: 0 };
  let timedOut = false;
  let outputLimitExceeded = false;
  let termination: Promise<void> | undefined;
  const child = spawn(run.executable, [...run.args], {
    cwd: run.cwd,
    env: run.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stop = (): void => {
    if (child.pid !== undefined) termination ??= terminateProcessGroup(child.pid, run.incomplete);
  };
  const collect = (stream: ChildStream, chunk: Buffer): void => {
    bytes[stream] += chunk.byteLength;
    run.observe?.(stream, chunk);
    const remaining = Math.max(0, run.outputLimitBytes - capturedBytes);
    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      captured.push(part);
      capturedBytes += part.byteLength;
    }
    if (bytes.stdout + bytes.stderr > run.outputLimitBytes && !outputLimitExceeded) {
      outputLimitExceeded = true;
      stop();
    }
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, run.timeoutMs);
  let closed: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
  try {
    closed = await new Promise((settle, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => settle({ code, signal }));
    });
  } catch (error) {
    return Object.freeze({ ended: "spawn-failed", error: error as Error });
  } finally {
    clearTimeout(timer);
  }
  await termination;
  return Object.freeze({
    ended: "exited",
    exitCode: closed.code,
    signal: closed.signal,
    timedOut,
    outputLimitExceeded,
    output: Buffer.concat(captured),
    stdoutBytes: bytes.stdout,
    stderrBytes: bytes.stderr
  });
}
