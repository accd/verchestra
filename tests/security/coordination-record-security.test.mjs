// invariant: SSI-49 and SSI-81 for the coordination members of the Run
// record. The node ledger and the node results a coordinated run persists
// hold no token, prompt, repository context, provider session, environment
// value, or machine-local path: only identifiers, counts, instants, digests,
// codes, and each node's own bounded, validated answer, which is refused
// before it is persisted when the model wrote a credential or a local path.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { nodeResultWithheld } from "../../apps/vestra-cli/src/task/task-coordination.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { resolveWorkspaceState } from "../../packages/platform-node/src/index.ts";
import {
  coordinatedDriver,
  coordinatedRequest,
  control,
  driverRequest
} from "../helpers/coordinated-driver-fixture.mjs";
import { RUN_ID, WORKSPACE_ID, cleanupRunRecordFixtures, temporaryRoot } from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const byText = (left, right) => Number(left > right) - Number(left < right);

const TOKEN = "sk-ant-oat01-fake-coordination-security-7f3a";
const SESSION = "private-session-id-5c1e";

test("the persisted ledger and results of a coordinated run carry no secret, prompt, session, or path", async () => {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
  const request = coordinatedRequest("swarm");
  const turns = [
    { outcome: "done", summary: "the writer changed the greeting", next: "reviewer", message: "review the greeting" },
    { outcome: "done", summary: "the reviewer approves", next: "<complete>", message: "done" }
  ];
  const seen = [];
  const fixture = coordinatedDriver(request, {
    records: runRecord.coordination(),
    changeDigest: async () => `sha256:${"4".repeat(64)}`,
    script: Object.fromEntries(
      ["writer", "reviewer"].map((nodeId) => [
        nodeId,
        async ({ session, control: nodeControl }) => {
          seen.push(session.prompt);
          await nodeControl.checkpoint("driver-started", { model: session.node.driver.model });
          return { result: turns.shift() };
        }
      ])
    )
  });
  // why: the repository context and the environment a session sees are where
  // a token, a session identity, or a path would come from.
  process.env.VERCHESTRA_SECURITY_PROBE = TOKEN;
  try {
    await fixture.driver.execute(
      driverRequest(request),
      control({ control: { checkpoint: async () => "checkpoint:1" } }).control
    );
  } finally {
    delete process.env.VERCHESTRA_SECURITY_PROBE;
  }
  assert.equal(seen.length, 2);
  const directory = join(tasksRoot, RUN_ID, "coordination");
  const files = [join(directory, "ledger.json")];
  for (const name of await readdir(join(directory, "results"))) files.push(join(directory, "results", name));
  assert.equal(files.length, 3);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const forbidden of [TOKEN, SESSION, root, tasksRoot, "fixture repository context", "You are node", "HOME"])
      assert.equal(text.includes(forbidden), false, `${file} holds ${forbidden}`);
  }
  const ledger = JSON.parse(await readFile(files[0], "utf8")).record;
  for (const entry of ledger.visits)
    for (const [key, value] of Object.entries(entry))
      assert.match(
        String(value),
        /^(?:[a-z][a-z0-9-]{0,31}|\d+|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z|sha256:[a-f0-9]{64}|VES_[A-Z0-9_]+)$/u,
        key
      );
  const results = await Promise.all(
    files.slice(1).map(async (file) => JSON.parse(await readFile(file, "utf8")).record)
  );
  assert.deepEqual(results.map((entry) => entry.summary).sort(byText), [
    "the reviewer approves",
    "the writer changed the greeting"
  ]);
});

// invariant: the composition's own list of what a run withholds (the
// credentials its sessions redact and its home, state, worktree, and
// temporary roots) refuses a result whose model wrote any of them, so the Run
// record never holds one and no later node is handed it.
test("a node result holding a model-written credential or local path is refused, and nothing of it is persisted", async () => {
  const codexKey = "sk-proj-fake-coordination-security-91d0";
  const request = coordinatedRequest("agent");
  const root = await temporaryRoot();
  const layout = resolveWorkspaceState({
    stateRoot: join(root, "state"),
    workspaceId: WORKSPACE_ID,
    platform: process.platform
  });
  const worktree = join(layout.worktreesRoot, "run-1");
  const composed = {
    claude: { executable: "/fixture/claude", auth: "subscription", credential: TOKEN },
    codex: { executable: "/fixture/codex", credential: codexKey },
    env: { HOME: homedir() },
    sessionsRoot: layout.sessionsRoot,
    worktrees: { resolvePath: () => Promise.resolve(worktree) }
  };
  const written = [
    `the token is ${TOKEN}`,
    `the Codex key is ${codexKey}`,
    `notes in ${join(homedir(), "notes.txt")}`,
    `state in ${join(layout.stateRoot, "workspaces")}`,
    `the change is in ${join(worktree, "packages", "app")}`,
    `scratch in ${join(tmpdir(), "scratch")}`
  ];
  for (const [index, summary] of written.entries()) {
    const tasksRoot = join(root, `tasks-${index}`);
    const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
    const fixture = coordinatedDriver(request, {
      records: runRecord.coordination(),
      withheld: (worktreeRef) => nodeResultWithheld(composed, worktreeRef),
      script: { build: () => ({ result: { outcome: "done", summary } }) }
    });
    await assert.rejects(
      fixture.driver.execute(driverRequest(request), control().control),
      (error) => error.code === "VES_COORDINATION_RESULT_INVALID",
      summary
    );
    const directory = join(tasksRoot, RUN_ID, "coordination");
    assert.deepEqual(await readdir(join(directory, "results")).catch(() => []), [], `${summary} was persisted`);
    const ledger = await readFile(join(directory, "ledger.json"), "utf8");
    for (const forbidden of [TOKEN, codexKey, homedir(), layout.stateRoot, worktree, tmpdir()])
      assert.equal(ledger.includes(forbidden), false, `the ledger holds ${forbidden}`);
    assert.match(ledger, /"failureCode":"VES_COORDINATION_RESULT_INVALID"/u);
  }
});

// invariant: SSI-49 and SSI-53 for the Codex login. Every Codex node can read
// the Workspace login from its CODEX_HOME, so a result that carries one of its
// tokens, its API key, its account id, or an account identifier its ID token
// carries decoded is refused before it is persisted, and so is one that
// carries a token Codex renewed after an earlier result of the round was
// screened.
test("a node result carrying a secret or an account identifier of the Workspace's Codex login is refused, and nothing of it is persisted", async () => {
  const root = await temporaryRoot();
  const layout = resolveWorkspaceState({
    stateRoot: join(root, "state"),
    workspaceId: WORKSPACE_ID,
    platform: process.platform
  });
  const identity = join(layout.workspaceRoot, "codex-identity");
  await mkdir(identity, { recursive: true });
  const email = "owner-security@fixture.test";
  const userId = "user-fixture-security-2c8d";
  const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const idToken = [
    segment({ alg: "RS256", typ: "JWT" }),
    segment({ email, "https://api.openai.com/auth": { chatgpt_plan_type: "plus", user_id: userId } }),
    "fixture-security-signature-81c2"
  ].join(".");
  // why: stands in for the file `codex login` writes and Codex rewrites when
  // it renews its tokens; every value is a fixture.
  const login = (accessToken) =>
    writeFile(
      join(identity, "auth.json"),
      JSON.stringify({
        OPENAI_API_KEY: "sk-fixture-security-login-key-4e0a",
        tokens: {
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "fixture-security-refresh-token-0b97",
          account_id: "fixture-security-account-6b21"
        }
      })
    );
  const composed = {
    claude: { executable: "/fixture/claude", auth: "subscription", credential: TOKEN },
    codex: { executable: "/fixture/codex", identityDirectory: identity },
    env: {},
    sessionsRoot: layout.sessionsRoot,
    worktrees: { resolvePath: () => Promise.resolve(join(layout.worktreesRoot, "run-1")) }
  };
  const renewed = "fixture-security-renewed-access-token-d4f6";
  const secrets = [
    "fixture-security-access-token-3a5e",
    "fixture-security-refresh-token-0b97",
    idToken,
    "sk-fixture-security-login-key-4e0a",
    "fixture-security-account-6b21",
    email,
    userId,
    renewed
  ];
  const request = coordinatedRequest("swarm");
  const swarm = (tasksRoot, secret) =>
    coordinatedDriver(request, {
      records: openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID).coordination(),
      withheld: (worktreeRef) => nodeResultWithheld(composed, worktreeRef),
      script: {
        writer: () => ({
          result: { outcome: "done", summary: "the writer changed the greeting", next: "reviewer", message: "review" }
        }),
        // why: the renewal happens in the round's second node, after the
        // writer's result was screened, so a screen that resolved what it
        // withholds once per round would let the renewed token through.
        reviewer: async () => {
          if (secret === renewed) await login(renewed);
          return {
            result: { outcome: "done", summary: `the login holds ${secret}`, next: "<complete>", message: "done" }
          };
        }
      }
    }).driver.execute(driverRequest(request), control().control);
  // why: the control: the same run whose reviewer names no secret completes,
  // so each refusal below is the screen's.
  await login(secrets[0]);
  await swarm(join(root, "login-control"), "no secret");
  for (const [index, secret] of secrets.entries()) {
    await login(secrets[0]);
    const tasksRoot = join(root, `login-${index}`);
    await assert.rejects(swarm(tasksRoot, secret), (error) => error.code === "VES_COORDINATION_RESULT_INVALID", secret);
    const directory = join(tasksRoot, RUN_ID, "coordination");
    const results = await readdir(join(directory, "results"));
    assert.equal(results.length, 1, `${secret}: only the writer's result is persisted`);
    for (const file of [join(directory, "ledger.json"), join(directory, "results", results[0])])
      assert.equal((await readFile(file, "utf8")).includes(secret), false, `${file} holds ${secret}`);
    assert.match(
      await readFile(join(directory, "ledger.json"), "utf8"),
      /"failureCode":"VES_COORDINATION_RESULT_INVALID"/u
    );
  }
});
