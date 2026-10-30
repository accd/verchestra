// invariant: door 2 of .specs/features/sqlite-probe-worker/plan.md (AD-087).
// Verchestra's first-party SQLite probe worker. It speaks `verchestra-probe/1`
// over stdio through the protocol's own frame codec and answers identity,
// session and execute with data-probe's SqliteProbeAdapter over the read-only
// SqliteReadConnection, so its identity, session and rows are SQLite's own. It
// receives no credential: the database is the file its approved environment
// names. It never runs in the CLI's process: the builder bundles it from
// sqlite-probe-worker-main.ts into one self-contained file, which `vestra probe
// worker` writes into a Workspace and the probe host runs as an isolated copy
// (tests/architecture/extension-host-composition.test.mjs and
// database-command-composition.test.mjs admit exactly these two imports).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { SqliteProbeAdapter, SqliteReadConnection, type SqliteConnectionPlan } from "@verchestra/data-probe";
import { ProbeFrameDecoder, encodeProbeFrame } from "@verchestra/extension-host";

// invariant: the worker's exit status when its approved environment does not
// configure it; nothing is written to stdout first, so the host sees a worker
// that exited before its handshake.
export const CONFIGURATION_REFUSED = 5;
// why: a frame the worker cannot read or a message it does not answer ends it;
// the host reports the exit, never this status.
export const PROTOCOL_REFUSED = 4;
const PROTOCOL = "verchestra-probe/1";
const MAXIMUM_HEADER_BYTES = 64;
const MAXIMUM_INBOUND_BYTES = 1_048_576;
const MAXIMUM_MESSAGE_BYTES = 65_536;

type Environment = Readonly<Record<string, string | undefined>>;
type Payload = Readonly<Record<string, unknown>>;

export interface SqliteProbeWorkerConfiguration {
  readonly databasePath: string;
  readonly componentId: string;
  readonly workspaceId: string;
}

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

// invariant: door 2. The database file and the handshake id come from exactly
// two variables of the approved environment; a missing, empty or relative
// value configures nothing. The Workspace id is the one the host itself sets.
export function sqliteWorkerConfiguration(environment: Environment): SqliteProbeWorkerConfiguration | undefined {
  const databasePath = environment["PROBE_SQLITE_PATH"];
  const componentId = environment["PROBE_COMPONENT_ID"];
  const workspaceId = environment["VERCHESTRA_PROBE_WORKSPACE_ID"];
  if (!present(databasePath) || !isAbsolute(databasePath)) return undefined;
  if (!present(componentId) || !present(workspaceId)) return undefined;
  return Object.freeze({ databasePath, componentId, workspaceId });
}

export interface SqliteProbeWorkerIo {
  readonly input: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
    on(event: "end", listener: () => void): unknown;
  };
  readonly write: (frame: Uint8Array) => void;
  readonly exit: (status: number) => void;
}

interface Component {
  readonly id: string;
  readonly digest: string;
}

// why: one host channel. The plan arrives with the identity request, and the
// connection opens the configured file read-only then, under the plan's
// database id; every answer is a frame of the worker's own sequence.
class SqliteProbeChannel {
  readonly #configuration: SqliteProbeWorkerConfiguration;
  readonly #component: Component;
  readonly #io: SqliteProbeWorkerIo;
  #sequence = 0;
  #adapter: SqliteProbeAdapter | undefined;
  #plan: SqliteConnectionPlan | undefined;

  constructor(configuration: SqliteProbeWorkerConfiguration, component: Component, io: SqliteProbeWorkerIo) {
    this.#configuration = configuration;
    this.#component = component;
    this.#io = io;
  }

  async answer(name: string, payload: Payload): Promise<void> {
    if (name === "probe.hello") return this.#handshake();
    if (name === "probe.identity.request") return this.#identity(payload["plan"] as SqliteConnectionPlan);
    if (name === "probe.session.request") return this.#session(payload["plan"] as SqliteConnectionPlan);
    if (name === "probe.execute") return this.#execute(payload);
    return this.stop(name === "probe.cancel" ? 0 : PROTOCOL_REFUSED);
  }

  failed(): void {
    // invariant: a failure is reported by a fixed code only; its text may name
    // the database, so it never crosses the boundary.
    this.#send("probe.error", { code: "SQLITE_WORKER_FAILED", message: "The SQLite worker failed" });
  }

  // why: the read connection is closed before the worker exits, so nothing of
  // the database file stays open after the channel ends.
  stop(status: number): void {
    void this.#adapter?.terminate();
    this.#io.exit(status);
  }

  #send(name: string, payload: unknown): void {
    this.#io.write(
      encodeProbeFrame({
        protocol: PROTOCOL,
        messageId: `worker:${this.#sequence}`,
        correlationId: "probe-channel:sqlite-worker",
        workspaceId: this.#configuration.workspaceId,
        sequence: this.#sequence,
        sentAt: new Date().toISOString(),
        payloadSchema: { name, version: 1 },
        payload
      })
    );
    this.#sequence += 1;
  }

  #connect(plan: SqliteConnectionPlan): SqliteProbeAdapter {
    this.#plan = plan;
    this.#adapter ??= new SqliteProbeAdapter({
      connection: new SqliteReadConnection({ databaseId: plan.databaseId, path: this.#configuration.databasePath })
    });
    return this.#adapter;
  }

  async #handshake(): Promise<void> {
    this.#send("probe.handshake", {
      protocol: PROTOCOL,
      supportedSchemas: ["probe.plan/1", "probe.result/1"],
      component: { id: this.#component.id, digest: this.#component.digest },
      capabilities: ["database-read"],
      maximumMessageBytes: MAXIMUM_MESSAGE_BYTES
    });
  }

  async #identity(plan: SqliteConnectionPlan): Promise<void> {
    const identity = await this.#connect(plan).verifyIdentity(plan);
    this.#send("probe.identity", {
      evidence: {
        databaseId: identity.databaseId,
        principalReadOnly: identity.principalReadOnly,
        principalFingerprint: identity.principalFingerprint
      }
    });
  }

  async #session(plan: SqliteConnectionPlan): Promise<void> {
    this.#send("probe.session", await this.#connect(plan).configureReadOnlySession(plan));
  }

  // invariant: rows are read only under the plan the session was opened with.
  async #execute(payload: Payload): Promise<void> {
    const adapter = this.#adapter;
    const plan = this.#plan;
    if (adapter === undefined || plan === undefined || payload["planDigest"] !== plan.planDigest)
      throw new Error("No approved plan is open");
    let chunks = 0;
    const parameters = Buffer.from(String(payload["parameters"]), "base64");
    for await (const rows of adapter.execute(plan, parameters, new AbortController().signal)) {
      // why: node:sqlite rows have no prototype, and a frame digests plain JSON.
      this.#send("probe.result.chunk", { rows: rows.map((row) => ({ ...row })) });
      chunks += 1;
    }
    this.#send("probe.result.end", { chunkCount: chunks });
  }
}

// why: the protocol loop. Frames are answered one after another, in the order
// they arrive; a frame the decoder refuses ends the worker.
export function serveSqliteProbe(
  configuration: SqliteProbeWorkerConfiguration,
  component: Component,
  io: SqliteProbeWorkerIo
): void {
  const decoder = new ProbeFrameDecoder({
    workspaceId: configuration.workspaceId,
    maximumHeaderBytes: MAXIMUM_HEADER_BYTES,
    maximumMessageBytes: MAXIMUM_INBOUND_BYTES
  });
  const channel = new SqliteProbeChannel(configuration, component, io);
  let pending = Promise.resolve();
  io.input.on("data", (chunk) => {
    let envelopes;
    try {
      envelopes = decoder.push(chunk);
    } catch {
      channel.stop(PROTOCOL_REFUSED);
      return;
    }
    for (const envelope of envelopes)
      pending = pending
        .then(() => channel.answer(envelope.payloadSchema.name, envelope.payload as Payload))
        .catch(() => channel.failed());
  });
  io.input.on("end", () => channel.stop(0));
}

export interface SqliteProbeWorkerProcess {
  readonly env: Environment;
  readonly argv: readonly string[];
  readonly stdin: SqliteProbeWorkerIo["input"];
  readonly stdout: { write(frame: Uint8Array): unknown };
  exit(status: number): void;
}

// invariant: AC 9. Without its configuration the worker exits before it reads
// or writes anything. Its component digest is the `sha256:` of the file it runs
// from, which the host runs as a byte-identical copy of the approved entry.
export function runSqliteProbeWorker(process_: SqliteProbeWorkerProcess): void {
  const configuration = sqliteWorkerConfiguration(process_.env);
  const self = process_.argv[1];
  if (configuration === undefined || self === undefined) {
    process_.exit(CONFIGURATION_REFUSED);
    return;
  }
  const digest = `sha256:${createHash("sha256").update(readFileSync(self)).digest("hex")}`;
  serveSqliteProbe(
    configuration,
    { id: configuration.componentId, digest },
    {
      input: process_.stdin,
      write: (frame) => process_.stdout.write(frame),
      exit: (status) => process_.exit(status)
    }
  );
}
