import type { CoordinationMode } from "./coordination-plan.ts";
import { CoordinationRunError } from "./node-result.ts";

type Digest = `sha256:${string}`;
type Row = Readonly<Record<string, unknown>>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const NODE_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const CODE = /^VES_[A-Z0-9_]{1,96}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_VISITS = 4096;

// invariant: the node ledger (SSI-49). One entry per node visit, holding node
// identifiers, counts, instants, digests, and stable codes only: no provider
// session, credential, provider output, environment value, or path.
export type NodeVisitState = "pending" | "started" | "completed" | "failed" | "partial" | "uncertain";
const VISIT_STATES: ReadonlySet<string> = new Set<NodeVisitState>([
  "pending",
  "started",
  "completed",
  "failed",
  "partial",
  "uncertain"
]);
const ROUND_STATES = ["running", "completed", "failed"] as const;

export interface NodeVisit {
  readonly round: number;
  readonly nodeId: string;
  readonly visit: number;
  readonly state: NodeVisitState;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly changeDigestBefore?: Digest;
  readonly receiptCount: number;
  readonly resultDigest?: Digest;
  readonly resultBytes?: number;
  readonly failureCode?: string;
  // invariant: SSI-66, SSI-67. Present on a visit that a resume ran again in
  // place of an earlier visit of the same node and number that never
  // completed: the digest of that visit's uncertainty record.
  readonly rerunOf?: Digest;
}

// invariant: a round is one execution of the plan; a gate repair attempt
// starts the next one. Only a `running` round is resumed.
export interface CoordinationLedger {
  readonly schemaVersion: 1;
  readonly mode: CoordinationMode;
  readonly round: number;
  readonly roundState: (typeof ROUND_STATES)[number];
  readonly visits: readonly NodeVisit[];
}

// invariant: the durable record of a coordinated run. A result is stored as
// the bytes the run validated, named by their digest; the ledger is sealed.
export interface CoordinationRecordPort {
  loadLedger(): Promise<CoordinationLedger | undefined>;
  saveLedger(ledger: CoordinationLedger): Promise<void>;
  saveResult(bytes: Uint8Array): Promise<Digest>;
  loadResult(digest: Digest): Promise<Uint8Array>;
}

function malformed(message: string): never {
  throw new CoordinationRunError("VES_COORDINATION_LEDGER_INVALID", message);
}

function row(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) malformed(`${label} is not an object`);
  const record = value as Row;
  const keys = Object.keys(record);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) malformed(`${label} has unknown members`);
  if (required.some((key) => !Object.hasOwn(record, key))) malformed(`${label} misses a member`);
  return record;
}

function count(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) malformed(`${label} is not a count`);
  return value as number;
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) malformed(`${label} is malformed`);
  return value;
}

function optional<T>(record: Row, key: string, read: (value: unknown) => T): Partial<Record<string, T>> {
  return record[key] === undefined ? {} : { [key]: read(record[key]) };
}

const VISIT_REQUIRED = ["round", "nodeId", "visit", "state", "startedAt", "receiptCount"];
const VISIT_OPTIONAL = ["endedAt", "changeDigestBefore", "resultDigest", "resultBytes", "failureCode", "rerunOf"];

function visit(value: unknown): NodeVisit {
  const record = row(value, "node visit", VISIT_REQUIRED, VISIT_OPTIONAL);
  const state = record["state"];
  if (typeof state !== "string" || !VISIT_STATES.has(state)) malformed("node visit state is unknown");
  return Object.freeze({
    round: count(record["round"], 1, "round"),
    nodeId: matching(record["nodeId"], NODE_ID, "nodeId"),
    visit: count(record["visit"], 1, "visit"),
    state: state as NodeVisitState,
    startedAt: matching(record["startedAt"], INSTANT, "startedAt"),
    receiptCount: count(record["receiptCount"], 0, "receiptCount"),
    ...optional(record, "endedAt", (entry) => matching(entry, INSTANT, "endedAt")),
    ...optional(record, "changeDigestBefore", (entry) => matching(entry, DIGEST, "changeDigestBefore")),
    ...optional(record, "resultDigest", (entry) => matching(entry, DIGEST, "resultDigest")),
    ...optional(record, "resultBytes", (entry) => count(entry, 1, "resultBytes")),
    ...optional(record, "failureCode", (entry) => matching(entry, CODE, "failureCode")),
    ...optional(record, "rerunOf", (entry) => matching(entry, DIGEST, "rerunOf"))
  }) as NodeVisit;
}

// invariant: a completed visit names the result it produced; nothing else may
// claim to be complete.
function assertConsistent(entry: NodeVisit): void {
  if (entry.state === "completed" && (entry.resultDigest === undefined || entry.resultBytes === undefined))
    malformed("a completed node visit names no result");
}

// invariant: the one reader of a stored ledger. A ledger of another shape is
// refused whole, never read in part.
export function normalizeCoordinationLedger(value: unknown): CoordinationLedger {
  const record = row(value, "coordination ledger", ["schemaVersion", "mode", "round", "roundState", "visits"]);
  if (record["schemaVersion"] !== 1) malformed("coordination ledger version is unknown");
  const mode = record["mode"];
  if (mode !== "agent" && mode !== "graph" && mode !== "swarm") malformed("coordination ledger mode is unknown");
  const roundState = record["roundState"];
  if (!ROUND_STATES.includes(roundState as CoordinationLedger["roundState"])) malformed("round state is unknown");
  const visits = record["visits"];
  if (!Array.isArray(visits) || visits.length > MAXIMUM_VISITS) malformed("coordination ledger visits are invalid");
  const round = count(record["round"], 1, "round");
  const entries = visits.map(visit);
  for (const entry of entries) {
    assertConsistent(entry);
    if (entry.round > round) malformed("a node visit belongs to a later round");
  }
  return Object.freeze({
    schemaVersion: 1,
    mode,
    round,
    roundState: roundState as CoordinationLedger["roundState"],
    visits: Object.freeze(entries)
  });
}

// invariant: whether a visit that never completed may have changed the
// worktree. `none` only for a visit that ended failed with no receipt while
// the change digest is still the one it started from (SSI-67); a visit with
// no recorded end, one that ended after an effect landed, and one whose
// digests cannot be compared may have (SSI-66).
export type VisitEffect = "none" | "possible";

export interface UnsettledVisit {
  readonly visit: NodeVisit;
  readonly effect: VisitEffect;
}

function sameVisit(left: NodeVisit, right: NodeVisit): boolean {
  return left.nodeId === right.nodeId && left.visit === right.visit;
}

function effectOf(visit: NodeVisit, changeDigest: Digest | undefined): VisitEffect {
  const unchanged = visit.changeDigestBefore !== undefined && visit.changeDigestBefore === changeDigest;
  return visit.state === "failed" && visit.receiptCount === 0 && unchanged ? "none" : "possible";
}

// invariant: the visits a resume of a running round must settle before any
// node starts: for each node and visit number of the round, the latest entry,
// when it did not complete. An entry a later one of the same node and number
// replaced is history, never settled twice.
export function unsettledVisits(
  ledger: CoordinationLedger | undefined,
  changeDigest: Digest | undefined
): readonly UnsettledVisit[] {
  if (ledger?.roundState !== "running") return Object.freeze([]);
  const round = ledger.visits.filter((entry) => entry.round === ledger.round);
  const latest = round.filter((entry, index) => !round.slice(index + 1).some((later) => sameVisit(later, entry)));
  return Object.freeze(
    latest
      .filter((entry) => entry.state !== "completed")
      .map((visit) => Object.freeze({ visit, effect: effectOf(visit, changeDigest) }))
  );
}

// invariant: D4. What the owner reconciles by typing back its digest: the run
// and the visit's identity and every fact the ledger holds about it except
// its state, so the digest stays the same when a resume marks a visit with no
// recorded end as uncertain.
export function uncertaintyRecord(runId: string, visit: NodeVisit): Readonly<Record<string, unknown>> {
  const { state, rerunOf, ...facts } = visit;
  void state;
  void rerunOf;
  return Object.freeze({ schemaVersion: 1, runId, ...facts });
}
