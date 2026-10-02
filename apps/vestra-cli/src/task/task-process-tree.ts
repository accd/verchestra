import { constants } from "node:os";

import { terminateProcessTree } from "@verchestra/platform-node";

export type ProviderName = "Claude Code" | "Codex";
type InterruptSignal = "SIGHUP" | "SIGTERM";
type TreeRoutine = (pid: number, incomplete: () => never) => Promise<void>;

// invariant: the two signals that end the command without a human decision. A
// hang-up and a termination request stop the providers and leave the run as an
// interruption leaves it; SIGINT stays the cancel it has always been.
const INTERRUPT_SIGNALS: readonly InterruptSignal[] = ["SIGHUP", "SIGTERM"];
// why: the tree routine confirms a group within half a second. This is the
// backstop for a process table that never answers, so that a tree which will
// not die cannot keep the command alive.
const INTERRUPT_BACKSTOP_MS = 2_000;

export interface ProviderProcessesOptions {
  readonly stderr: (text: string) => void;
  // why: injectable so that a test can make the final check of the tree
  // routine see a member alive, which no real process can be made to do.
  readonly terminateTree?: TreeRoutine;
}

// invariant: what one provider session of a task command is given. The driver
// gets `terminateTree` and `onSpawn`; the composition calls `end` when the
// session is over and runs every durable effect of the session through
// `unlessInterrupted`.
export interface ProviderSession {
  readonly terminateTree: (pid: number) => Promise<void>;
  readonly onSpawn: (pid: number) => void;
  unlessInterrupted<T>(effect: () => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

// why: Claude Code and Codex each lead a process group of their own, and a
// process they start can leave it. Stopping a provider therefore kills the
// group and every descendant found before the kill. A provider in its own
// group also no longer receives the terminal's signals, so this module stops
// the providers itself when the command receives a hang-up or a termination
// request, and then lets that signal end the command.
// invariant: an interrupt records nothing. No abort, no cancel marker, no
// checkpoint and no tool effect follows it, so the run is left exactly as a
// killed command leaves it: interrupted, and resumable.
export class ProviderProcesses {
  readonly #stderr: (text: string) => void;
  readonly #routine: TreeRoutine;
  readonly #running = new Map<number, ProviderName>();
  readonly #reported = new Set<number>();
  #interrupted = false;

  constructor(options: ProviderProcessesOptions) {
    this.#stderr = options.stderr;
    this.#routine = options.terminateTree ?? terminateProcessTree;
  }

  // invariant: true exactly while the interrupt handlers are installed.
  running(): boolean {
    return this.#running.size > 0;
  }

  session(provider: ProviderName): ProviderSession {
    const started = new Set<number>();
    return {
      terminateTree: (pid) => this.#terminate(provider, pid),
      onSpawn: (pid) => {
        started.add(pid);
        this.#track(pid, provider);
      },
      unlessInterrupted: (effect) => (this.#interrupted ? this.#parked() : effect()),
      end: async () => {
        if (this.#interrupted) await this.#parked();
        for (const pid of started) this.#untrack(pid);
        started.clear();
      }
    };
  }

  // hazard: the drivers call this from an abort listener, where a rejection
  // would be unhandled and end the whole command, so it never rejects. A tree
  // that was not confirmed gone is named once on stderr instead, with the
  // command that stops it: the provider's process group id is its pid.
  async #terminate(provider: ProviderName, pid: number): Promise<void> {
    try {
      await this.#routine(pid, () => {
        throw new Error("provider process tree remained alive after termination");
      });
    } catch {
      if (this.#reported.has(pid)) return;
      this.#reported.add(pid);
      this.#stderr(
        `vestra: the ${provider} process group ${pid} was not confirmed stopped and may still be running. Stop it with: kill -KILL -- -${pid}\n`
      );
    }
  }

  // invariant: the handlers exist only while a provider is running, so no
  // other part of the command changes how it answers a signal.
  #track(pid: number, provider: ProviderName): void {
    if (this.#running.size === 0) for (const signal of INTERRUPT_SIGNALS) process.on(signal, this.#interrupt);
    this.#running.set(pid, provider);
  }

  #untrack(pid: number): void {
    if (!this.#running.delete(pid) || this.#running.size > 0) return;
    for (const signal of INTERRUPT_SIGNALS) process.off(signal, this.#interrupt);
  }

  // why: once the command is being interrupted, whatever the run would do next
  // must not happen, and the command is about to end, so it waits for ever.
  #parked<T>(): Promise<T> {
    return new Promise<T>(() => undefined);
  }

  readonly #interrupt = (signal: InterruptSignal): void => {
    if (this.#interrupted) return;
    this.#interrupted = true;
    const stopped = Promise.all([...this.#running].map(([pid, provider]) => this.#terminate(provider, pid)));
    const backstop = new Promise((resolve) => setTimeout(resolve, INTERRUPT_BACKSTOP_MS));
    void Promise.race([stopped, backstop]).then(() => endBySignal(signal));
  };
}

// invariant: the command ends as the signal would have ended it. With no
// listener left the signal has its default action again, and sending it to
// this process is that action.
function endBySignal(signal: InterruptSignal): void {
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  // hazard: reached only when the signal did not end the process. The run is
  // parked by then, so the command must not stay alive.
  process.exit(128 + constants.signals[signal]);
}
