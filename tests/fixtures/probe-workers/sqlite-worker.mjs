// why: a workspace probe worker for the path slice 2b qualifies
// (.specs/features/probe-run/plan.md): it speaks `verchestra-probe/1` over
// stdio through the protocol's own frame codec, and answers with data-probe's
// SqliteProbeAdapter over the real read-only SqliteReadConnection, so its
// identity, session and rows are SQLite's own. It receives no credential: the
// database is the file its approved launch names.
//
// A Workspace's entry is a one-line module that imports this one and calls
// serveSqliteProbe, so the approved entry pins this module by its URL. The
// database file is the worker's approved argument: node reads every argument
// before its script as an option of its own, so the path rides `--title=`,
// which node uses only to name the process, and is read back from execArgv.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { SqliteProbeAdapter, SqliteReadConnection } from "../../../packages/data-probe/src/sqlite-adapter.ts";
import { ProbeFrameDecoder, encodeProbeFrame } from "../../../packages/extension-host/src/probe-protocol.ts";

const TITLE = "--title=";

function databasePath() {
  const argument = process.execArgv.find((value) => value.startsWith(TITLE));
  if (argument === undefined) process.exit(5);
  return argument.slice(TITLE.length);
}

export function serveSqliteProbe({ componentId }) {
  const workspaceId = process.env.VERCHESTRA_PROBE_WORKSPACE_ID;
  const path = databasePath();
  const digest = createHash("sha256").update(readFileSync(process.argv[1])).digest("hex");
  const component = { id: componentId, digest: `sha256:${digest}` };
  const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 1_048_576 });
  let sequence = 0;
  let adapter;
  let plan;

  const send = (name, payload) => {
    process.stdout.write(
      encodeProbeFrame({
        protocol: "verchestra-probe/1",
        messageId: `worker:${sequence}`,
        correlationId: "probe-channel:sqlite-worker",
        workspaceId,
        sequence,
        sentAt: new Date().toISOString(),
        payloadSchema: { name, version: 1 },
        payload
      })
    );
    sequence += 1;
  };

  // why: the plan arrives with the identity request; the connection opens the
  // registered database read-only then, under the plan's database id.
  const connect = (requested) => {
    plan = requested;
    adapter ??= new SqliteProbeAdapter({
      connection: new SqliteReadConnection({ databaseId: requested.databaseId, path })
    });
    return adapter;
  };

  const handlers = {
    "probe.hello": async () =>
      send("probe.handshake", {
        protocol: "verchestra-probe/1",
        supportedSchemas: ["probe.plan/1", "probe.result/1"],
        component,
        capabilities: ["database-read"],
        maximumMessageBytes: 65_536
      }),
    "probe.identity.request": async (payload) => {
      const identity = await connect(payload.plan).verifyIdentity(payload.plan);
      send("probe.identity", {
        evidence: {
          databaseId: identity.databaseId,
          principalReadOnly: identity.principalReadOnly,
          principalFingerprint: identity.principalFingerprint
        }
      });
    },
    "probe.session.request": async (payload) =>
      send("probe.session", await connect(payload.plan).configureReadOnlySession(payload.plan)),
    "probe.execute": async (payload) => {
      let chunks = 0;
      const parameters = Buffer.from(payload.parameters, "base64");
      for await (const rows of adapter.execute(plan, parameters, new AbortController().signal)) {
        // why: node:sqlite rows have no prototype; a frame digests plain JSON.
        send("probe.result.chunk", { rows: rows.map((row) => ({ ...row })) });
        chunks += 1;
      }
      send("probe.result.end", { chunkCount: chunks });
    },
    "probe.cancel": async () => process.exit(0)
  };

  let pending = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    for (const envelope of decoder.push(chunk)) {
      const handle = handlers[envelope.payloadSchema.name] ?? (() => process.exit(4));
      pending = pending
        .then(() => handle(envelope.payload))
        .catch(() => send("probe.error", { code: "SQLITE_WORKER_FAILED", message: "The SQLite worker failed" }));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
