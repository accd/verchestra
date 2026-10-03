// DETERMINISTIC PROBE - not a provider. Run as a child process with an empty
// environment by tests/integration/strands-empty-environment.test.mjs. Before
// anything of the SDK loads it records every environment variable read,
// refuses and records every network, DNS, and child-process call, captures
// console output, and counts Bedrock clients constructed (a load hook adds a
// counter to the client's constructor). Then it runs a scripted Graph and a
// scripted Swarm of structural agents over in-memory node sessions and prints
// one JSON report on stdout.
import childProcess from "node:child_process";
import dns from "node:dns";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { createRequire, registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = { envReads: new Set(), network: [], processes: [], console: [] };

const BEDROCK_CLIENT =
  /@aws-sdk[\\/]client-bedrock-runtime[\\/]dist-(?:es[\\/]BedrockRuntimeClient|cjs[\\/]index)\.js$/u;
const CONSTRUCTED = "this.initConfig = _config_0;";
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!BEDROCK_CLIENT.test(url) || loaded.source === undefined || loaded.source === null) return loaded;
    const text = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const counted = text.replaceAll(
      CONSTRUCTED,
      `${CONSTRUCTED} globalThis.__probeBedrockClients = (globalThis.__probeBedrockClients ?? 0) + 1;`
    );
    return {
      ...loaded,
      source: `globalThis.__probeBedrockModules = (globalThis.__probeBedrockModules ?? 0) + ${Number(counted !== text)};\n${counted}`
    };
  }
});

const environment = process.env;
process.env = new Proxy(environment, {
  get(target, key) {
    if (typeof key === "string") report.envReads.add(key);
    return Reflect.get(target, key);
  },
  has(target, key) {
    if (typeof key === "string") report.envReads.add(key);
    return Reflect.has(target, key);
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key === "string") report.envReads.add(key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  ownKeys(target) {
    report.envReads.add("<enumerated>");
    return Reflect.ownKeys(target);
  }
});

function refuse(list, label) {
  return (...args) => {
    list.push(`${label}:${typeof args[0] === "string" ? args[0] : typeof args[0]}`);
    throw new Error(`probe refused ${label}`);
  };
}
for (const [module, names, label] of [
  [net, ["connect", "createConnection"], "net"],
  [tls, ["connect"], "tls"],
  [dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns"],
  [http, ["request", "get"], "http"],
  [https, ["request", "get"], "https"],
  [http2, ["connect"], "http2"]
])
  for (const name of names) module[name] = refuse(report.network, `${label}.${name}`);
net.Socket.prototype.connect = refuse(report.network, "net.Socket.connect");
dns.promises.lookup = refuse(report.network, "dns.promises.lookup");
globalThis.fetch = refuse(report.network, "fetch");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
  childProcess[name] = refuse(report.processes, `child_process.${name}`);
syncBuiltinESMExports();
for (const level of ["log", "info", "warn", "error", "debug"])
  console[level] = (...parts) => report.console.push(`${level}: ${parts.join(" ")}`);

const { StrandsCoordinationEngine } = await import("../../packages/agent-runtime/src/coordination/strands/index.ts");
const { COORDINATION_COMPLETE } = await import("../../packages/application/src/index.ts");
const { DONE, control, coordinatedDriver, coordinatedRequest, driverRequest } =
  await import("./coordinated-driver-fixture.mjs");

async function scripted(mode, script) {
  const request = coordinatedRequest(mode);
  const fixture = coordinatedDriver(request, { engine: new StrandsCoordinationEngine(), script });
  const result = await fixture.driver.execute(driverRequest(request), control().control);
  return {
    status: result.status,
    visits: fixture.records.ledger.visits.map((entry) => `${entry.nodeId}#${entry.visit}:${entry.state}`)
  };
}

// why: the positive control. With `control`, the probe constructs one Bedrock
// client itself, so a counter that cannot see construction fails the test.
if (process.argv[2] === "control") {
  const sdk = createRequire(fileURLToPath(new URL("../../packages/agent-runtime/package.json", import.meta.url)));
  const bedrock = createRequire(sdk.resolve("@strands-agents/sdk/multiagent"));
  const { BedrockRuntimeClient } = await import(pathToFileURL(bedrock.resolve("@aws-sdk/client-bedrock-runtime")).href);
  new BedrockRuntimeClient({ region: "eu-west-1" }).destroy();
}

const graph = await scripted("graph", {});
const turns = [
  { result: { ...DONE, next: "reviewer", message: "review" } },
  { result: { ...DONE, next: COORDINATION_COMPLETE, message: "end" } }
];
const swarm = await scripted("swarm", { writer: async () => turns.shift(), reviewer: async () => turns.shift() });

process.stdout.write(
  `${JSON.stringify({
    graph,
    swarm,
    bedrockModules: globalThis.__probeBedrockModules ?? 0,
    bedrockClients: globalThis.__probeBedrockClients ?? 0,
    envReads: [...report.envReads].sort((left, right) => Number(left > right) - Number(left < right)),
    network: report.network,
    processes: report.processes,
    console: report.console
  })}\n`
);
