// invariant: the governed task journey on Windows (T7, SSI-71..77), end to end
// through the real `vestra` binary as a child process. The implementer and the
// verifier are the DETERMINISTIC FAKE `claude` and `codex` of
// tests/helpers/task-cli-fakes, started for the `claude.exe` and `codex.exe`
// placeholders by tests/helpers/fake-windows-spawn.mjs, which also answers the
// Credential Manager from the fixture's store, layered on the deny guard. The
// bridge is real: the PowerShell 7 helper owns the named pipe, the per-run
// directories are proven owner-only with the system ACL tools, and the
// Windows policy sources are read. No provider is contacted.
//
// The journey runs on the Windows runner. Elsewhere the task path keeps its
// Unix socket, and the case asserts that platform path instead of skipping:
// the composition hands the bridge no pipe there and the pipe refuses to start.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { implementerBridgeTransport } from "../../apps/vestra-cli/src/task/task-implementer.ts";
import { requireWindowsPrerequisites } from "../../apps/vestra-cli/src/task/task-windows.ts";
import { WindowsNamedPipeBridgeTransport } from "../../packages/platform-node/src/index.ts";
import {
  MODE_CREDENTIALS,
  WIN32,
  approveArguments,
  cleanupTaskFixtures,
  taskFixture
} from "../helpers/task-cli-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 600_000 };

// why: each fake writes one JSON line per observation in the fixture's log
// directory; a log a fake never wrote reads as no observation.
const jsonLines = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);
const logLines = (fixture, name) => jsonLines(join(fixture.scratch, name)).map((line) => JSON.parse(line));
const FAKE_LOGS = [
  "claude.exe.witness.log",
  "codex.exe.witness.log",
  "fake-claude.log",
  "fake-codex-status.log",
  "fake-codex.log"
];

// why: a step that fails on the Windows runner names, in the assertion itself,
// how each fake ended (the provider witness: exit code, standard error tail,
// arguments, working directory, environment names) and what each observed.
function diagnosis(fixture) {
  const tail = (name) => jsonLines(join(fixture.scratch, name)).join("\n").slice(-4096);
  return JSON.stringify(Object.fromEntries(FAKE_LOGS.map((name) => [name, tail(name)])));
}

function ok(result, label, fixture) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}\n${result.stdout}\n${diagnosis(fixture)}`);
  return result.json.data;
}

function checkout(fixture) {
  return {
    head: fixture.git(["rev-parse", "HEAD"]),
    status: fixture.git(["status", "--porcelain=v1", "--untracked-files=all"]),
    value: readFileSync(join(fixture.repository, "src", "value.txt"), "utf8"),
    worktrees: fixture.git(["worktree", "list", "--porcelain"])
  };
}

function command(fixture, verb, runId, extra = []) {
  return ["task", verb, "--run-id", runId, ...extra, ...fixture.keychainArgs, "--output", "json"];
}

async function unixPathHere(t) {
  t.diagnostic(`${process.platform}: asserting the task path keeps its Unix socket and the pipe refuses here`);
  assert.equal(implementerBridgeTransport(process.platform), undefined, "the composition hands the bridge no pipe");
  const channels = await temporaryDirectory(t, "verchestra-task-windows-e2e-");
  await assert.rejects(
    new WindowsNamedPipeBridgeTransport({ root: channels }).listen(() => assert.fail("no connection")),
    { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" }
  );
  const sessionsRoot = join(channels, "sessions");
  await requireWindowsPrerequisites({ platform: process.platform, sessionsRoot, claude: "subscription" });
  assert.deepEqual(await readdir(channels), [], "no Windows prerequisite is checked here");
}

// invariant: what the implementer saw. Its relay was aimed at the named pipe
// and handed SystemRoot beside the bridge variables; its own environment held
// the Windows pass-through list, its per-run home, and its subscription token
// alone; and its read and its write both crossed the pipe.
function assertImplementerOverThePipe(fixture) {
  const sessions = logLines(fixture, "fake-claude.log");
  const [session] = sessions;
  assert.ok(session !== undefined, diagnosis(fixture));
  assert.equal(session.bridgeChannel, "named-pipe");
  assert.deepEqual(session.relayEnvironmentKeys, ["SYSTEMROOT", "VERCHESTRA_BRIDGE_SOCKET", "VERCHESTRA_BRIDGE_TOKEN"]);
  assert.equal(session.bare, false);
  assert.equal(session.credentialVariable, "CLAUDE_CODE_OAUTH_TOKEN");
  assert.equal(session.credentialMatchesStore, true);
  assert.match(session.cwd, /[\\/]sessions[\\/]verchestra-claude-[^\\/]+[\\/]workspace$/u);
  assert.equal(session.workingDirectoryEntries, 0);
  for (const key of ["PATH", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR"])
    assert.ok(session.environmentKeys.includes(key), key);
  for (const key of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "LOCALAPPDATA",
    "TMPDIR",
    "VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE",
    "VERCHESTRA_TEST_FAKE_PROVIDERS"
  ])
    assert.equal(session.environmentKeys.includes(key), false, key);
  const { results } = sessions.find((entry) => entry.results !== undefined);
  assert.deepEqual(
    results.map(({ name, path, isError }) => ({ name, path, isError })),
    [
      { name: "read_file", path: "src/value.txt", isError: false },
      { name: "write_file", path: "src/value.txt", isError: false }
    ]
  );
  assert.match(results[1].text, /^wrote src\/value\.txt; receipt /u);
}

test(
  "win32: a governed task is planned, approved, implemented through the named pipe, gated, verified, and accepted",
  TIMEOUT,
  async (t) => {
    if (!WIN32) return unixPathHere(t);
    const fixture = await taskFixture();
    const before = checkout(fixture);
    const plan = ok(
      fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
      "plan",
      fixture
    );
    assert.equal(plan.state, "AWAITING_EXECUTION_APPROVAL");
    assert.deepEqual(plan.providerAuth, { "claude-code": "subscription", codex: "subscription" });
    const approval = ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve", fixture);
    assert.equal(approval.state, "EXECUTION_AUTHORIZED");

    const run = ok(fixture.launch(command(fixture, "start", plan.runId)), "start", fixture);
    assert.equal(run.state, "HUMAN_REVIEW", diagnosis(fixture));
    assert.equal(run.branch, `vestra/${plan.runId}/T1`);
    const inReview = ok(fixture.launch(command(fixture, "status", plan.runId)), "status", fixture);
    assert.equal(inReview.surfaceDigest, run.surfaceDigest);
    assert.equal(inReview.evidence.verificationVerdict, "PASS", diagnosis(fixture));
    assert.equal(inReview.checkpoints.toolReceipts, 1);
    assertImplementerOverThePipe(fixture);
    const [codex] = logLines(fixture, "fake-codex.log");
    assert.equal(codex.sandbox, "read-only");
    assert.equal(codex.tools, 0);
    assert.equal(codex.login, "chatgpt");
    assert.equal(codex.codexHome, fixture.codexIdentity);

    const accepted = ok(
      fixture.launch(
        command(fixture, "review", plan.runId, [
          "--outcome",
          "accepted",
          "--surface-digest",
          run.surfaceDigest,
          "--confirm-stdin"
        ]),
        `${run.surfaceDigest}\n`
      ),
      "review",
      fixture
    );
    assert.equal(accepted.state, "COMPLETED");
    const branch = `vestra/${plan.runId}/T1`;
    assert.equal(fixture.git(["show", `${branch}:src/value.txt`]), "new");
    assert.equal(fixture.git(["rev-parse", `${branch}^`]), fixture.revision);
    assert.deepEqual(fixture.git(["diff", "--name-only", fixture.revision, branch]).split("\n"), ["src/value.txt"]);
    assert.deepEqual(checkout(fixture), before, "the user's checkout does not move");

    // invariant: every credential came from the Credential Manager through
    // its two programs, and only the ones the subscription mode names.
    const reads = jsonLines(`${fixture.store}.log`).map((line) => JSON.parse(line));
    assert.ok(reads.length > 0);
    for (const { command: program, account } of reads) {
      assert.ok(["cmdkey", "Read"].includes(program), program);
      assert.ok(Object.hasOwn(MODE_CREDENTIALS.subscription, account), account);
    }
    assert.deepEqual(await readdir(join(fixture.stateRoot, "sessions")), [], "every isolation directory is removed");
  }
);
