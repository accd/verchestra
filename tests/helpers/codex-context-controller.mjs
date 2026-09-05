import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CodexDriver } from "../../packages/drivers/src/index.ts";
import { codexFixture } from "./codex-driver-fixture.mjs";

const cwd = process.cwd();
const context = {
  cwd: process.argv[2],
  environment: {
    VERCH_CONTEXT_MARKER: "base",
    HOME: process.argv[2],
    USERPROFILE: process.argv[2],
    CODEX_HOME: process.argv[2]
  }
};
const command = [process.execPath, fileURLToPath(new URL("./codex-context-observer.mjs", import.meta.url))];
const fixture = codexFixture({
  environment: { VERCH_CONTEXT_MARKER: "execution", CODEX_THREAD_ID: "synthetic-thread" }
});
const sent = [];
const driver = new CodexDriver(
  fixture.dependencies({
    command,
    processContext: process.argv[3] === "--without-context" ? undefined : context,
    probeEnvironment: { VERCH_CONTEXT_MARKER: "probe", CODEX_TURN_ID: "synthetic-turn" },
    onMessageSent: (message) => sent.push(message)
  })
);
context.cwd = cwd;
context.environment.HOME = "mutated-synthetic-home";
command[0] = "missing-mutated-command";
const events = [];
const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
await driver.close(session);
assert.equal(
  events.some((event) => event.type === "error"),
  false
);
assert.equal(sent.find((message) => message.method === "thread/start").params.cwd, process.argv[2]);
assert.equal(process.cwd(), cwd);
const portable = JSON.stringify({ events, session });
assert.equal(portable.includes(process.argv[2]), false);
assert.equal(portable.includes("mutated-synthetic-home"), false);
