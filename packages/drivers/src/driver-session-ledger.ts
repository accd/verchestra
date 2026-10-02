import { DriverProtocolError, type DriverEvent, type DriverSessionRef } from "./index.ts";

export type DriverSessionOutcome = "completed" | "failed" | "cancelled";

export interface DriverSession<Resources> {
  // why: what one driver keeps for a session (a child process, an SDK agent)
  // is opaque here, so the ledger needs no knowledge of any provider.
  readonly resources: Resources;
  // invariant: how the session ended, recorded once. The first `failed` or
  // `cancelled` stands, so a stop never relabels a failure that preceded it,
  // and nothing changes the outcome once the terminal event is out: `close`
  // reports what that event said.
  outcome: DriverSessionOutcome;
  // invariant: a terminal session accepts no further event. After the terminal
  // event nothing is delivered and nothing is numbered.
  emit(event: Readonly<Record<string, unknown>>): void;
  // invariant: a driver brackets the run that reports how it ended. It calls
  // this before that run's provider can be stopped, and the function it gets
  // back once the run has reported, on every path out of it. A cancel that
  // stopped the provider waits for a run in flight before the terminal event.
  runStarted(): () => void;
}

export type DriverSessionCloseResult =
  | Readonly<{ sessionId: string; closed: true; alreadyClosed: true }>
  | Readonly<{ sessionId: string; closed: true; outcome: DriverSessionOutcome; finalSequence: number }>;

export interface DriverSessionLedgerOptions<Resources> {
  // why: the session codes are shared by every driver (`VES_DRIVER_SESSION_*`);
  // only the name in the message differs, for example "Claude Code".
  readonly noun: string;
  // invariant: runs before a cancel emits the terminal event, and returns
  // nothing when there is nothing to wait for, so that such a cancel still
  // emits the terminal event in the caller's own turn. What it returns settles
  // once the provider was told to stop; the cancel then waits for the run.
  readonly stop?: (session: DriverSession<Resources>) => Promise<unknown> | undefined;
  // invariant: runs after the terminal event, on every cancel that reaches it
  // and on every first close. A cancelled session is therefore released twice,
  // and the hook must tolerate that.
  readonly release?: (session: DriverSession<Resources>) => void;
}

class LedgerSession<Resources> implements DriverSession<Resources> {
  readonly resources: Resources;
  readonly #sink: (event: DriverEvent) => void;
  #outcome: DriverSessionOutcome = "completed";
  #run: Promise<void> | undefined;
  #sequence = 0;
  #terminal = false;

  constructor(sink: (event: DriverEvent) => void, resources: Resources) {
    this.#sink = sink;
    this.resources = resources;
  }

  get outcome(): DriverSessionOutcome {
    return this.#outcome;
  }

  set outcome(outcome: DriverSessionOutcome) {
    if (this.#terminal || this.#outcome !== "completed") return;
    this.#outcome = outcome;
  }

  get run(): Promise<void> | undefined {
    return this.#run;
  }

  get sequence(): number {
    return this.#sequence;
  }

  get terminal(): boolean {
    return this.#terminal;
  }

  runStarted(): () => void {
    let ended!: () => void;
    this.#run = new Promise<void>((resolve) => (ended = resolve));
    return ended;
  }

  emit(event: Readonly<Record<string, unknown>>): void {
    // why: what arrives after the terminal event is dropped and not counted. A
    // cancel waits for the run's own report, so an error that explains how the
    // run ended is delivered before the terminal event and decides its outcome.
    // What is left is the output of a run whose session was ended under it,
    // and no reader is left to act on that.
    if (this.#terminal) return;
    // invariant: the sink sees the event before its number is spent, so a sink
    // that throws leaves the sequence where it was.
    this.#sink(Object.freeze({ ...event, sequence: this.#sequence }) as DriverEvent);
    this.#sequence += 1;
  }

  terminate(reason?: string): void {
    if (this.#terminal) return;
    this.emit({ type: "session.closed", outcome: this.outcome, ...(reason === undefined ? {} : { reason }) });
    this.#terminal = true;
  }
}

// invariant: one ledger per driver instance. A session reference is valid only
// for the driver that opened it, and a closed reference stays closed.
export class DriverSessionLedger<Resources = undefined> {
  readonly #options: DriverSessionLedgerOptions<Resources>;
  readonly #sessions = new Map<string, LedgerSession<Resources>>();
  readonly #closed = new Set<string>();

  constructor(options: DriverSessionLedgerOptions<Resources>) {
    this.#options = options;
  }

  open(sessionId: string, sink: (event: DriverEvent) => void, resources: Resources): DriverSession<Resources> {
    const session = new LedgerSession(sink, resources);
    this.#sessions.set(sessionId, session);
    return session;
  }

  active(reference: DriverSessionRef): DriverSession<Resources> {
    const session = this.#known(reference);
    if (session.terminal)
      throw new DriverProtocolError("VES_DRIVER_SESSION_CLOSED", `${this.#options.noun} session is closed`);
    return session;
  }

  async cancel(reference: DriverSessionRef, reason: string): Promise<void> {
    if (this.#closed.has(reference.sessionId)) return;
    const session = this.#known(reference);
    if (session.terminal) return;
    const stopping = this.#options.stop?.(session);
    if (stopping !== undefined) {
      await stopping;
      // invariant: the run a cancel stopped reports how it ended before the
      // terminal event, never after it. The report is the run's own: it says
      // that the run was aborted, or names a failure the stop did not cause,
      // and the terminal event carries the outcome it recorded.
      await session.run;
    }
    session.outcome = "cancelled";
    session.terminate(reason);
    this.#options.release?.(session);
  }

  close(reference: DriverSessionRef): DriverSessionCloseResult {
    const { sessionId } = reference;
    if (this.#closed.has(sessionId)) return Object.freeze({ sessionId, closed: true, alreadyClosed: true });
    const session = this.#known(reference);
    session.terminate();
    this.#options.release?.(session);
    this.#sessions.delete(sessionId);
    this.#closed.add(sessionId);
    return Object.freeze({ sessionId, closed: true, outcome: session.outcome, finalSequence: session.sequence });
  }

  #known(reference: DriverSessionRef): LedgerSession<Resources> {
    const session = this.#sessions.get(reference.sessionId);
    if (session === undefined)
      throw new DriverProtocolError("VES_DRIVER_SESSION_UNKNOWN", `${this.#options.noun} session is unknown`);
    return session;
  }
}
