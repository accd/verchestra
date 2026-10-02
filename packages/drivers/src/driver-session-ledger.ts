import { DriverProtocolError, type DriverEvent, type DriverSessionRef } from "./index.ts";

export type DriverSessionOutcome = "completed" | "failed" | "cancelled";

export interface DriverSession<Resources> {
  // why: what one driver keeps for a session (a child process, an SDK agent)
  // is opaque here, so the ledger needs no knowledge of any provider.
  readonly resources: Resources;
  outcome: DriverSessionOutcome;
  emit(event: Readonly<Record<string, unknown>>): void;
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
  // emits the terminal event in the caller's own turn.
  readonly stop?: (session: DriverSession<Resources>) => Promise<unknown> | undefined;
  // invariant: runs after the terminal event, on every cancel that reaches it
  // and on every first close. A cancelled session is therefore released twice,
  // and the hook must tolerate that.
  readonly release?: (session: DriverSession<Resources>) => void;
}

class LedgerSession<Resources> implements DriverSession<Resources> {
  readonly resources: Resources;
  outcome: DriverSessionOutcome = "completed";
  readonly #sink: (event: DriverEvent) => void;
  #sequence = 0;
  #terminal = false;

  constructor(sink: (event: DriverEvent) => void, resources: Resources) {
    this.#sink = sink;
    this.resources = resources;
  }

  get sequence(): number {
    return this.#sequence;
  }

  get terminal(): boolean {
    return this.#terminal;
  }

  emit(event: Readonly<Record<string, unknown>>): void {
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
    if (stopping !== undefined) await stopping;
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
