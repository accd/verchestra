// invariant: SSI-49 and SSI-81 at the composition. What a coordinated run
// withholds from every node result is the credentials its sessions are given
// to redact, the secrets of the Workspace's Codex login, and its
// machine-local roots: the home directory, the Workspace layout's state root,
// the run's worktree, and the temporary root. A relative path or a filesystem
// root names no machine-local place.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { after, test } from "node:test";

import { nodeResultWithheld } from "../../apps/vestra-cli/src/task/task-coordination.ts";
import { resolveWorkspaceState } from "../../packages/platform-node/src/index.ts";

const WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-512345678901";
const byText = (left, right) => Number(left > right) - Number(left < right);

function options(codex, env) {
  const layout = resolveWorkspaceState({
    stateRoot: resolve("/fixture-state/verchestra"),
    workspaceId: WORKSPACE_ID,
    platform: process.platform
  });
  return {
    layout,
    options: {
      claude: { executable: "/fixture/claude", auth: "subscription", credential: "sk-ant-oat01-fixture-claude" },
      codex: { executable: "/fixture/codex", ...codex },
      env,
      sessionsRoot: layout.sessionsRoot,
      worktrees: {
        resolvePath: (worktreeRef) => Promise.resolve(join(layout.worktreesRoot, worktreeRef.slice("worktree:".length)))
      }
    }
  };
}

test("a run withholds its sessions' credentials and its home, state, worktree, and temporary roots", async () => {
  const home = resolve("/fixture-home/owner");
  const { layout, options: composed } = options(
    { credential: "sk-proj-fixture-codex" },
    { HOME: `${home}/`, TMPDIR: "relative/tmp", TEMP: parse(home).root, PATH: "/usr/bin" }
  );
  const withheld = await nodeResultWithheld(composed, "worktree:run-1");
  assert.deepEqual(withheld.values, ["sk-ant-oat01-fixture-claude", "sk-proj-fixture-codex"]);
  const expected = [homedir(), home, layout.stateRoot, join(layout.worktreesRoot, "run-1"), tmpdir()].map((root) =>
    resolve(root)
  );
  assert.deepEqual([...withheld.roots].sort(byText), [...new Set(expected)].sort(byText));
  assert.equal(withheld.roots.includes(parse(home).root), false, "a filesystem root is never withheld");
});

const identities = [];
after(() => Promise.all(identities.map((directory) => rm(directory, { recursive: true, force: true }))));

// why: stands in for the file `codex login` writes; every value is a fixture.
async function identityWith(login) {
  const directory = await mkdtemp(join(tmpdir(), "vestra-codex-login-"));
  identities.push(directory);
  if (login !== undefined) await writeFile(join(directory, "auth.json"), login);
  return directory;
}

const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// why: stands in for the ID token `codex login` stores, a JWT whose payload
// names the account; the claims mirror the real token's shape.
const ID_TOKEN = [
  segment({ alg: "RS256", typ: "JWT" }),
  segment({
    iss: "https://auth.fixture.test",
    aud: ["app_fixture-client"],
    sub: "fixture-provider|fixture-subject",
    email: "owner@fixture.test",
    email_verified: true,
    exp: 1_790_000_000,
    sid: "fixture-sign-in-session",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "fixture-account",
      chatgpt_plan_type: "plus",
      chatgpt_user_id: "user-fixture-chatgpt",
      user_id: "user-fixture",
      organizations: [{ id: "org-fixture", is_default: true, role: "owner", title: "Personal" }]
    }
  }),
  "fixture-signature"
].join(".");

const LOGIN = Object.freeze({
  OPENAI_API_KEY: "sk-fixture-login-api-key",
  tokens: {
    id_token: ID_TOKEN,
    access_token: "fixture-login-access-token",
    refresh_token: "fixture-login-refresh-token",
    account_id: "fixture-account"
  },
  last_refresh: "2026-10-01T00:00:00.000000Z"
});

// invariant: SSI-53. The account identifiers the ID token's payload carries
// decoded; its issuer, audience, plan, flags, times, and titles name no one.
const ID_TOKEN_IDENTIFIERS = Object.freeze([
  "fixture-provider|fixture-subject",
  "owner@fixture.test",
  "fixture-sign-in-session",
  "user-fixture-chatgpt",
  "user-fixture",
  "org-fixture"
]);

test("a Codex session on the Workspace login withholds the login's tokens, account identifiers, and API key beside the Claude Code credential", async () => {
  const { options: composed } = options({ identityDirectory: await identityWith(JSON.stringify(LOGIN)) }, {});
  assert.deepEqual((await nodeResultWithheld(composed, "worktree:run-1")).values, [
    "sk-ant-oat01-fixture-claude",
    "fixture-login-access-token",
    "fixture-login-refresh-token",
    ID_TOKEN,
    "fixture-account",
    "sk-fixture-login-api-key",
    ...ID_TOKEN_IDENTIFIERS
  ]);
  const chatgptOnly = JSON.stringify({ ...LOGIN, OPENAI_API_KEY: null });
  const { options: unkeyed } = options({ identityDirectory: await identityWith(chatgptOnly) }, {});
  assert.deepEqual((await nodeResultWithheld(unkeyed, "worktree:run-1")).values.slice(1), [
    "fixture-login-access-token",
    "fixture-login-refresh-token",
    ID_TOKEN,
    "fixture-account",
    ...ID_TOKEN_IDENTIFIERS
  ]);
  // why: an ID token whose payload is not JSON names nothing decoded; it is
  // withheld whole and the run is not refused.
  for (const opaque of ["fixture-opaque-id-token", `${segment({ alg: "none" })}.not-json.fixture-signature`]) {
    const login = JSON.stringify({ tokens: { ...LOGIN.tokens, id_token: opaque } });
    const { options: undecoded } = options({ identityDirectory: await identityWith(login) }, {});
    assert.deepEqual((await nodeResultWithheld(undecoded, "worktree:run-1")).values.slice(1), [
      "fixture-login-access-token",
      "fixture-login-refresh-token",
      opaque,
      "fixture-account"
    ]);
  }
  const { options: signedOut } = options({ identityDirectory: await identityWith(undefined) }, {});
  assert.deepEqual((await nodeResultWithheld(signedOut, "worktree:run-1")).values, ["sk-ant-oat01-fixture-claude"]);
});

// invariant: a login file that cannot be read as a login withholds nothing it
// could name, so the run is refused, and the refusal quotes none of the file.
test("an unreadable Codex login file refuses the run without naming its content", async () => {
  for (const login of ['{"tokens": fixture-broken-login-secret}', "[]", "null"]) {
    const { options: composed } = options({ identityDirectory: await identityWith(login) }, {});
    await assert.rejects(nodeResultWithheld(composed, "worktree:run-1"), (error) => {
      assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED", login);
      assert.deepEqual(error.envelope.safeDetails, { requirement: "codex-login" }, login);
      assert.equal(error.cause, undefined, login);
      assert.equal(`${error.message}${error.stack}`.includes("fixture-broken-login-secret"), false, login);
      return true;
    });
  }
});
