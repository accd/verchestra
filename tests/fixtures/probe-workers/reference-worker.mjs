// why: a reference `verchestra-probe/1` worker in plain Node. It deliberately imports
// nothing from the repository: it re-implements the frame, the RFC 8785 payload
// digest (for the JSON subset the protocol uses), and the Workspace binding from
// the published contract alone, which is what a team writing a worker in any
// language has to do. It is a protocol reference, not a database driver: its
// identity and session evidence and its rows are synthetic.
//
// PROBE_FIXTURE_MODE selects a hostile behavior for the security, fault, and
// integration suites; the default is a conforming worker.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const mode = process.env.PROBE_FIXTURE_MODE ?? "reference";
const workspaceId = process.env.VERCHESTRA_PROBE_WORKSPACE_ID;
const componentId = process.env.PROBE_FIXTURE_COMPONENT ?? "plugin:acme-orders-probe";
const ownDigest = `sha256:${createHash("sha256").update(readFileSync(process.argv[1])).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

let sequence = 0;

function frame(name, payload, overrides = {}) {
  const envelope = {
    protocol: "verchestra-probe/1",
    messageId: `worker:${sequence}`,
    correlationId: "probe-channel:reference",
    workspaceId,
    sequence,
    sentAt: new Date().toISOString(),
    payloadSchema: { name, version: 1 },
    payloadDigest: digest(payload),
    payload,
    ...overrides
  };
  sequence += 1;
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

function send(name, payload, overrides) {
  process.stdout.write(frame(name, payload, overrides));
}

function handshakePayload() {
  return {
    protocol: "verchestra-probe/1",
    supportedSchemas: ["probe.plan/1", "probe.result/1"],
    component: { id: componentId, digest: mode === "lie-digest" ? `sha256:${"0".repeat(64)}` : ownDigest },
    capabilities: ["database-read"],
    maximumMessageBytes: 65536
  };
}

const hostile = {
  "oversize-frame": () => process.stdout.write("Content-Length: 99999999\r\n\r\n"),
  "malformed-header": () => process.stdout.write("X-Probe: 1\r\n\r\n{}"),
  "malformed-json": () => process.stdout.write("Content-Length: 5\r\n\r\n{nope"),
  "digest-mismatch": () => send("probe.handshake", handshakePayload(), { payloadDigest: `sha256:${"c".repeat(64)}` }),
  "foreign-workspace": () => send("probe.handshake", handshakePayload(), { workspaceId: "workspace_foreign" }),
  replay: () => {
    const bytes = frame("probe.handshake", handshakePayload());
    process.stdout.write(Buffer.concat([bytes, bytes]));
  },
  "stale-sequence": () => {
    send("probe.handshake", handshakePayload());
    send("probe.handshake", handshakePayload(), { messageId: "worker:replayed", sequence: 0 });
  },
  "hang-handshake": () => undefined,
  "stderr-flood": () => {
    const line = Buffer.alloc(16 * 1024, "e");
    const flood = () => {
      while (process.stderr.write(line));
      process.stderr.once("drain", flood);
    };
    flood();
  }
};

function execute(request) {
  const parameters = Buffer.from(request.parameters, "base64").toString("utf8");
  if (mode === "hang") return;
  if (mode === "leak") {
    process.stderr.write(`worker saw parameter ${parameters}\n`);
    send("probe.result.chunk", { rows: [{ echo: parameters }] });
    send("probe.result.end", { chunkCount: 1 });
    return;
  }
  if (mode === "fork") {
    const sameGroup = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const escaped = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
    send("probe.result.chunk", { rows: [{ sameGroup: sameGroup.pid, escaped: escaped.pid }] });
    return;
  }
  if (mode === "exit-mid-stream") {
    send("probe.result.chunk", { rows: [{ id: 1 }] });
    process.stdout.write("", () => process.exit(0));
    return;
  }
  if (mode === "error") {
    send("probe.error", { code: "WORKER_BROKE", message: `password=${parameters}` });
    return;
  }
  if (mode === "report-environment") {
    send("probe.result.chunk", { rows: [{ environmentKeys: Object.keys(process.env).sort(), cwd: process.cwd() }] });
    send("probe.result.end", { chunkCount: 1 });
    return;
  }
  send("probe.result.chunk", { rows: [{ id: 1, status: "fixture" }] });
  send("probe.result.chunk", { rows: [{ id: 2, status: "fixture" }] });
  send("probe.result.end", { chunkCount: 2 });
}

function handle(envelope) {
  // why: the worker holds the controller to the same contract the controller holds it
  // to; a frame for another Workspace or with a wrong digest ends the process.
  if (envelope.workspaceId !== workspaceId || envelope.payloadDigest !== digest(envelope.payload)) process.exit(3);
  const { payload } = envelope;
  switch (envelope.payloadSchema.name) {
    case "probe.hello":
      if (hostile[mode] !== undefined) return hostile[mode]();
      return send("probe.handshake", handshakePayload());
    case "probe.identity.request":
      return send("probe.identity", {
        evidence: {
          databaseId: payload.plan.databaseId,
          principalReadOnly: true,
          principalFingerprint: digest({ principal: "fixture-read-only" })
        }
      });
    case "probe.session.request":
      return send("probe.session", {
        planDigest: payload.plan.planDigest,
        sessionReadOnly: true,
        transactionReadOnly: true
      });
    case "probe.execute":
      return execute(payload);
    case "probe.cancel":
      return process.exit(0);
    default:
      return process.exit(4);
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const boundary = buffer.indexOf("\r\n\r\n");
    if (boundary < 0) return;
    const length = Number(/^Content-Length: (\d+)$/u.exec(buffer.subarray(0, boundary).toString("ascii"))?.[1]);
    if (!Number.isSafeInteger(length)) process.exit(2);
    if (buffer.length < boundary + 4 + length) return;
    const body = buffer.subarray(boundary + 4, boundary + 4 + length).toString("utf8");
    buffer = buffer.subarray(boundary + 4 + length);
    handle(JSON.parse(body));
  }
});
process.stdin.on("end", () => process.exit(0));
if (mode === "hang" || mode === "hang-handshake" || mode === "fork") setInterval(() => {}, 1000);
