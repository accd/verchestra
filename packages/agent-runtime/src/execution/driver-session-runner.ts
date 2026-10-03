import type { DriverEvent, DriverSessionOutcome } from "@verchestra/domain";

export type { DriverSessionOutcome } from "@verchestra/domain";

type Row = Readonly<Record<string, unknown>>;

// The Driver protocol (packages/drivers) as seen from here. agent-runtime may
// not import a sibling adapter, so the shape is declared structurally and the
// composition root passes the concrete driver.
// why: the event is the one the domain declares, which every driver emits, so
// an observer reads its fields as typed.
export interface DriverSessionPort<TStartRequest> {
  start(
    request: TStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<{ readonly sessionId: string }>;
  cancel(session: { readonly sessionId: string }, reason: string): Promise<void>;
  close(session: { readonly sessionId: string }): Promise<Row>;
}

export interface DriverSessionRun<TStartRequest> {
  readonly driver: DriverSessionPort<TStartRequest>;
  readonly startRequest: TStartRequest;
  // invariant: the one way to stop the session. A caller that must stop it from
  // inside `observe`, or from a timer, aborts the controller it passed here.
  readonly signal?: AbortSignal;
  // invariant: sees every event the driver emits, in order, and nothing after
  // it has thrown. It runs inside the driver's stream handling, so an error it
  // throws is held and rethrown by the runner once the session is closed.
  readonly observe?: (event: DriverEvent) => void;
}

export interface DriverSessionResult {
  readonly outcome: DriverSessionOutcome;
  // invariant: the stable code of every error event the driver emitted, in
  // order, whatever the outcome.
  readonly errorCodes: readonly string[];
}

const CANCEL_REASON = "stopped by Verchestra";

function safeCode(value: unknown): string {
  return typeof value === "string" && /^VES_[A-Z0-9_]{1,96}$/u.test(value) ? value : "VES_DRIVER_ERROR";
}

function result(outcome: DriverSessionOutcome, errorCodes: readonly string[]): DriverSessionResult {
  return Object.freeze({ outcome, errorCodes: Object.freeze([...errorCodes]) });
}

class ObservedSession<TStartRequest> {
  readonly #run: DriverSessionRun<TStartRequest>;
  readonly #abort = new AbortController();
  readonly errorCodes: string[] = [];
  #sessionId: string | undefined;
  #terminalOutcome: DriverSessionOutcome | undefined;
  #cancelling: Promise<void> | undefined;
  #observer: { readonly failure: unknown } | undefined;

  constructor(run: DriverSessionRun<TStartRequest>) {
    this.#run = run;
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  get stopped(): boolean {
    return this.#abort.signal.aborted;
  }

  readonly stop = (): void => {
    this.#abort.abort(CANCEL_REASON);
    this.#cancel();
  };

  readonly sink = (event: DriverEvent): void => {
    this.#track(event);
    this.#deliver(event);
    // why: a driver that had not announced its session when the stop arrived
    // could not be cancelled then, so it is cancelled as soon as it is known.
    if (this.stopped) this.#cancel();
  };

  // invariant: a cancel in flight emits the terminal event before the session
  // is closed, so that event carries the cancel and its reason.
  async settled(): Promise<void> {
    await this.#cancelling;
  }

  // why: a start that failed after it announced a session left that session
  // open in the driver; closing it by the announced identifier lets the driver
  // release what it holds. The failure of the start stays authoritative.
  async abandon(): Promise<void> {
    await this.settled();
    if (this.#sessionId !== undefined)
      await this.#run.driver.close({ sessionId: this.#sessionId }).catch(() => undefined);
  }

  rethrowObserverFailure(): void {
    if (this.#observer !== undefined) throw this.#observer.failure;
  }

  // invariant: a stop always ends as `cancelled`, whatever the driver reports.
  // `completed` is what the driver's close says and nothing less, with no
  // error event observed.
  // why: the four drivers end a stopped session as `cancelled` themselves, and
  // emit nothing after its terminal event. The rule stays because a stop is
  // not theirs to judge: a session that had failed before the stop closes as
  // `failed`, a cancel can fail and leave the close to say how the run ended,
  // and a driver that keeps no session ledger may still report an error after
  // its terminal event. None of these turns a stop into a failure.
  classify(closed: Row): DriverSessionOutcome {
    if (this.stopped || this.#terminalOutcome === "cancelled" || closed["outcome"] === "cancelled") return "cancelled";
    return this.errorCodes.length === 0 && closed["outcome"] === "completed" ? "completed" : "failed";
  }

  #track(event: DriverEvent): void {
    if (event.type === "session.started" && typeof event.sessionId === "string") this.#sessionId ??= event.sessionId;
    else if (event.type === "session.closed") this.#terminalOutcome ??= event.outcome;
    else if (event.type === "error") this.errorCodes.push(safeCode(event.code));
  }

  #deliver(event: DriverEvent): void {
    if (this.#observer !== undefined) return;
    try {
      this.#run.observe?.(event);
    } catch (failure) {
      this.#observer = { failure };
      this.stop();
    }
  }

  #cancel(): void {
    if (this.#sessionId === undefined || this.#cancelling !== undefined) return;
    // why: a cancel that fails shows in how the session ends; the stop itself
    // already decided the outcome.
    this.#cancelling = this.#run.driver.cancel({ sessionId: this.#sessionId }, CANCEL_REASON).catch(() => undefined);
  }
}

// why: one driver session from start to close is implemented once: the
// already-aborted check, start, observation, cancel on stop, close, and the
// classification of how it ended.
// invariant: it is bound to the Driver protocol and to nothing else; a role
// (implementer, verifier, self-test) supplies its own observer and decides
// what an outcome means for it (AD-012).
export async function runDriverSession<TStartRequest>(
  run: DriverSessionRun<TStartRequest>
): Promise<DriverSessionResult> {
  if (run.signal?.aborted === true) return result("cancelled", []);
  const session = new ObservedSession(run);
  run.signal?.addEventListener("abort", session.stop, { once: true });
  try {
    let reference: { readonly sessionId: string };
    try {
      reference = await run.driver.start(run.startRequest, session.sink, session.signal);
    } catch (error) {
      await session.abandon();
      session.rethrowObserverFailure();
      if (!session.stopped) throw error;
      return result("cancelled", session.errorCodes);
    }
    await session.settled();
    const closed = await run.driver.close(reference);
    session.rethrowObserverFailure();
    return result(session.classify(closed), session.errorCodes);
  } finally {
    run.signal?.removeEventListener("abort", session.stop);
  }
}
