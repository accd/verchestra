// DETERMINISTIC FAKE composition - not `vestra task`. A labeled stand-in for a
// task command with one provider session: it builds the production provider
// processes and the production driver, runs the session through the session
// runner against the labeled fake provider, and reports on stdout what it
// reached. It never contacts a provider.
//
// invariant: after the session it tries one durable effect and then continues,
// as a command would. A command that is being interrupted reaches neither, so
// a test reads `effect` and `continued` as proof that something was recorded
// after the signal.
import { ProviderProcesses } from "../../apps/vestra-cli/src/task/task-process-tree.ts";
import { runDriverSession } from "../../packages/agent-runtime/src/execution/driver-session-runner.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { claudeFixture } from "./claude-driver-fixture.mjs";
import { codexFixture } from "./codex-driver-fixture.mjs";
import { treeIn } from "./process-tree-fixture.mjs";

const ROWS = {
  claude: { provider: "Claude Code", Driver: ClaudeCodeDriver, fixtureOf: claudeFixture, variable: "FAKE_CLAUDE_MODE" },
  codex: { provider: "Codex", Driver: CodexDriver, fixtureOf: codexFixture, variable: "FAKE_CODEX_MODE" }
};
// why: `tree` is a provider that forks and never answers; `stuck` is the same
// with a tree routine that never returns; `complete` is a provider that answers.
const [kind, mode] = process.argv.slice(2);
const row = ROWS[kind];
const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const handlers = () => ["SIGHUP", "SIGTERM", "SIGINT"].map((signal) => process.listenerCount(signal));

const providers = new ProviderProcesses({
  stderr: (text) => process.stderr.write(text),
  ...(mode === "stuck" ? { terminateTree: () => new Promise(() => undefined) } : {})
});
const session = providers.session(row.provider);
const fixture = row.fixtureOf({ environment: { [row.variable]: mode === "complete" ? "success" : "fork" } });
const driver = new row.Driver(fixture.dependencies({ terminateTree: session.terminateTree, onSpawn: session.onSpawn }));

report({ before: handlers() });
const events = [];
let named = false;
try {
  await runDriverSession({
    driver,
    startRequest: fixture.request(),
    observe: (event) => {
      events.push(event);
      const tree = treeIn(events);
      if (tree === undefined || named) return;
      named = true;
      report({ tree, during: handlers() });
    }
  });
} finally {
  void session.unlessInterrupted(async () => report({ effect: true }));
  await session.end();
}
report({ continued: true, after: handlers() });
