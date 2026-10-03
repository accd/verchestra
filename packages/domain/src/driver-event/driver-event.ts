// invariant: a Driver event is what a driver session reports, from the event
// that announces the session to the terminal event that ends it. Every driver
// and the mock emit it, the session ledger numbers it, and the session runner
// and its consumers read it. Its types and fields are stated here and nowhere
// else.
// why: the module is in the domain because both sides of the Driver port
// already depend on the domain: the drivers emit the event, and agent-runtime,
// which may not import a sibling adapter, reads it.

export type DriverSessionOutcome = "completed" | "failed" | "cancelled";

// invariant: the field table. Each event type names every field it may carry,
// with the kind of value the field holds. A kind that ends in `?` marks a
// field an event carries only sometimes: some drivers set it, or some
// sessions do. Every other field is always set, and a scripted mock event
// carries exactly those. The event types below are derived from this table,
// so a driver that writes a field outside its row does not compile. The
// ledger adds `sequence` to every event as it delivers it.
// hazard: a spread is not checked for fields outside the row, so an emitter
// names each field it sets.
export const DRIVER_EVENT_FIELDS = Object.freeze({
  "session.started": Object.freeze({ sessionId: "text" }),
  // why: the model a driver resolved, named by its provider; Pi alone also
  // names the `api` its Passport binds. The mock resolves no model.
  "model.resolved": Object.freeze({ passportRef: "passport", provider: "text?", api: "text?", resolvedModel: "text?" }),
  "content.delta": Object.freeze({ text: "text" }),
  // why: OpenCode also reports the paths a permission asks for, the same
  // request its controller authorizes.
  "tool.requested": Object.freeze({ toolCallId: "text", name: "text", input: "value", patterns: "texts?" }),
  // why: OpenCode also reports its reasoning and cache tokens; its qualified
  // profile normalizes them. No consumer prices them.
  "usage.updated": Object.freeze({
    inputTokens: "count",
    outputTokens: "count",
    reasoningTokens: "count?",
    cacheReadTokens: "count?",
    cacheWriteTokens: "count?"
  }),
  warning: Object.freeze({ code: "text", message: "text" }),
  error: Object.freeze({ code: "text", message: "text", retryable: "flag" }),
  // why: a cancel names its reason; a close does not.
  "session.closed": Object.freeze({ outcome: "outcome", reason: "text?" })
});

interface FieldValues {
  readonly text: string;
  // invariant: a count is a value `usageCount` admits.
  readonly count: number;
  readonly flag: boolean;
  readonly value: unknown;
  readonly texts: readonly string[];
  readonly passport: { readonly passportId: string; readonly revision: number };
  readonly outcome: DriverSessionOutcome;
}

type FieldKind = keyof FieldValues;
type Fields<T extends DriverEventType> = (typeof DRIVER_EVENT_FIELDS)[T];
type Always<F> = { readonly [N in keyof F as F[N] extends FieldKind ? N : never]: FieldValues[F[N] & FieldKind] };
type Sometimes<F> = {
  readonly [N in keyof F as F[N] extends `${FieldKind}?` ? N : never]?: F[N] extends `${infer K extends FieldKind}?`
    ? FieldValues[K]
    : never;
};

export type DriverEventType = keyof typeof DRIVER_EVENT_FIELDS;
export function isDriverEventType(value: unknown): value is DriverEventType {
  return typeof value === "string" && Object.hasOwn(DRIVER_EVENT_FIELDS, value);
}

// invariant: one event type as a driver hands it to its session.
export type DriverEventOf<T extends DriverEventType> = { readonly type: T } & Always<Fields<T>> & Sometimes<Fields<T>>;
export type DriverEventBody = { [T in DriverEventType]: DriverEventOf<T> }[DriverEventType];
// invariant: a Driver event as a sink receives it, numbered from 0 in the
// order its session emitted it.
export type DriverEvent = DriverEventBody & { readonly sequence: number };

// invariant: the usage rule, the one check of a token count a provider
// reports. The count is read as a number, an absent count (undefined or null)
// is 0, and a count that is then not a non-negative safe integer is refused:
// the result is undefined, and the driver fails its run with its own code.
export function usageCount(reported: unknown): number | undefined {
  const count = Number(reported ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

// invariant: the usage event of every driver, built from the input and output
// counts its provider reported, or undefined when either fails the usage rule.
// A driver that reports more counts adds them, each through the rule.
export function usageUpdated(reported: {
  readonly inputTokens: unknown;
  readonly outputTokens: unknown;
}): DriverEventOf<"usage.updated"> | undefined {
  const inputTokens = usageCount(reported.inputTokens);
  const outputTokens = usageCount(reported.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return { type: "usage.updated", inputTokens, outputTokens };
}
