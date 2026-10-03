// invariant: SSI-79 and TM-001. A scripted Graph and Swarm of structural
// agents, run in a child process whose environment is empty, constructs no
// Bedrock client, reads no credential variable, opens no network connection,
// spawns no process, and prints nothing: the SDK only orders the nodes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PROBE = fileURLToPath(new URL("../helpers/strands-empty-env-probe.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// why: the names an AWS, Anthropic, or OpenAI client would read a credential
// or a credential file's location from.
const CREDENTIAL_VARIABLES = Object.freeze([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_REGION",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "HOME",
  "USERPROFILE"
]);
const CREDENTIAL_SHAPED = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROFILE|ROLE|IDENTITY/u;

function probe(...args) {
  const child = spawnSync(process.execPath, [PROBE, ...args], {
    cwd: ROOT,
    env: {},
    encoding: "utf8",
    timeout: 120_000
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test("a Graph and a Swarm in an empty environment run with structural agents only, and touch nothing", () => {
  const report = probe();
  assert.deepEqual(report.graph, {
    status: "completed",
    visits: ["plan#1:completed", "build#1:completed", "review#1:completed"]
  });
  assert.deepEqual(report.swarm, { status: "completed", visits: ["writer#1:completed", "reviewer#1:completed"] });
  assert.ok(report.bedrockModules >= 1, "the load hook never saw the Bedrock client, so it proves nothing");
  assert.equal(report.bedrockClients, 0);
  assert.deepEqual(report.network, []);
  assert.deepEqual(report.processes, []);
  assert.deepEqual(report.console, []);
  assert.deepEqual(
    report.envReads.filter((name) => CREDENTIAL_VARIABLES.includes(name) || CREDENTIAL_SHAPED.test(name)),
    []
  );
  assert.equal(report.envReads.includes("<enumerated>"), false, "the environment was enumerated");
});

test("the probe's Bedrock counter sees a client when one is constructed", () => {
  const report = probe("control");
  assert.equal(report.bedrockClients, 1);
  assert.equal(report.graph.status, "completed");
});
