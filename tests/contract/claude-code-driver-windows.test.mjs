// invariant: what the mediated Claude Code profiles need on Windows (SSI-73,
// AD-074). The bridge token lives in `config/mcp.json` inside the per-run
// isolation directory; elsewhere that directory's 0700 mode keeps it private,
// and on Windows, which ignores the mode, its ACL is made owner-only and read
// back before the token is written. The rules run here on every platform; the
// `win32:` case runs the profile over the real named pipe on the Windows
// runner and, elsewhere, asserts that the pipe refuses to start.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../packages/agent-runtime/src/index.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/index.ts";
import { WindowsNamedPipeBridgeTransport } from "../../packages/platform-node/src/index.ts";
import {
  passThroughEnvironment,
  provenOwnerOnly,
  relayEnvironment
} from "../../apps/vestra-cli/src/task/task-implementer.ts";
import {
  MEDIATED_CREDENTIAL,
  cleanupMediatedFixtures,
  fakeMediatedClaude,
  mediatedErrors,
  mediatedFixture
} from "../helpers/claude-mediated-fixture.mjs";
import { mockRequest } from "../helpers/driver-protocol-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

afterEach(cleanupMediatedFixtures);

const KINDS = ["mediated-mcp", "mediated-mcp-subscription"];
const proven = () => Promise.resolve(true);
const relayEntry = fileURLToPath(
  new URL("../../packages/agent-runtime/src/execution/mcp-tool-bridge-main.ts", import.meta.url)
);
const construct = (profile) =>
  new ClaudeCodeDriver({
    command: [process.execPath, fakeMediatedClaude],
    profile,
    resolveExecution: () => assert.fail("not reached")
  });

test("each mediated profile needs an owner-only proof on Windows and nowhere else", () => {
  for (const kind of KINDS) {
    assert.ok(construct({ kind, ownerOnlyProof: () => assert.fail("no directory at construction") }), kind);
    if (WIN32_HOST) assert.throws(() => construct({ kind }), { code: "VES_CLAUDE_MEDIATION_INVALID" }, kind);
    else assert.ok(construct({ kind }), `${kind} keeps its 0700 mode on ${process.platform}`);
  }
});

test("the mediated environment allowlist is the host's own: SystemRoot, TEMP, and TMP on Windows only", () => {
  const windows = { PATH: "C:\\bin", SystemRoot: "C:\\Windows", TEMP: "C:\\t", TMP: "C:\\t", TZ: "UTC" };
  const unix = { PATH: "/bin", LANG: "C", LC_ALL: "C", LC_CTYPE: "C", TZ: "UTC", TMPDIR: "/tmp" };
  const [allowed, refused] = WIN32_HOST ? [windows, unix] : [unix, windows];
  for (const kind of KINDS) {
    assert.ok(construct({ kind, environment: allowed, ownerOnlyProof: proven }), kind);
    for (const [key, value] of Object.entries(refused).filter(([name]) => !Object.hasOwn(allowed, name)))
      assert.throws(
        () => construct({ kind, environment: { [key]: value }, ownerOnlyProof: proven }),
        { code: "VES_CLAUDE_ENVIRONMENT_DENIED" },
        `${kind} ${key}`
      );
  }
});

test("the owner-only proof is taken once, on the empty isolation directory, before the bridge token is written", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  for (const kind of KINDS) {
    const proofs = [];
    const fixture = await mediatedFixture({
      kind,
      profile: {
        ownerOnlyProof: async (directory) => {
          proofs.push({ directory, entries: await readdir(directory) });
          return true;
        }
      }
    });
    const { events, closed } = await fixture.run();
    assert.deepEqual(mediatedErrors(events), [], kind);
    assert.equal(closed.outcome, "completed", kind);
    assert.equal(proofs.length, 1, kind);
    assert.equal(dirname(proofs[0].directory), fixture.isolationRoot, kind);
    assert.match(basename(proofs[0].directory), /^verchestra-claude-/u, kind);
    assert.deepEqual(proofs[0].entries, [], `${kind}: nothing, the token included, exists before the proof`);
    assert.equal(fixture.invoked.length, 1, kind);
  }
});

for (const [name, proof] of [
  ["is refused", () => Promise.resolve(false)],
  ["fails", () => Promise.reject(new Error("icacls did not succeed"))],
  ["answers anything but true", () => Promise.resolve("proven")]
])
  test(`a launch whose owner-only proof ${name} never starts Claude Code and leaves nothing behind`, async (t) => {
    if (WIN32_HOST) return windowsMediationPath(t);
    for (const kind of KINDS) {
      const fixture = await mediatedFixture({ kind, profile: { ownerOnlyProof: proof } });
      await assert.rejects(fixture.run(), { code: "VES_CLAUDE_ISOLATION_INSECURE" }, kind);
      assert.deepEqual(fixture.spawned, [], kind);
      assert.deepEqual(await readdir(fixture.isolationRoot), [], `${kind}: the isolation directory is removed`);
      assert.deepEqual(fixture.invoked, [], kind);
    }
  });

// ---------------------------------------------------------------------------
// The real pipe. This case needs Windows, PowerShell 7.4 or later at its
// pinned path, and the System32 ACL tools; a GitHub Windows runner has them.
// ---------------------------------------------------------------------------

async function windowsLayout(t) {
  const root = await realpath(await temporaryDirectory(t, "verchestra-claude-windows-"));
  const layout = {
    worktree: join(root, "worktree"),
    observations: join(root, "observations"),
    isolationRoot: join(root, "isolation"),
    channels: join(root, "channels")
  };
  await mkdir(join(layout.worktree, "src"), { recursive: true });
  await mkdir(join(layout.worktree, ".git"));
  for (const directory of [layout.observations, layout.isolationRoot, layout.channels]) await mkdir(directory);
  await writeFile(join(layout.worktree, "src", "a.txt"), "alpha\n");
  await writeFile(join(layout.worktree, ".git", "config"), "[core]\n");
  return layout;
}

function execution(controller, worktree) {
  return {
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "anthropic",
      resolvedModel: "claude-sonnet-5"
    },
    prompt: "scenario:read-write",
    model: "claude-sonnet-5",
    environment: { ANTHROPIC_API_KEY: MEDIATED_CREDENTIAL },
    sensitiveValues: [MEDIATED_CREDENTIAL],
    mediation: {
      cwd: worktree,
      bridge: {
        command: [process.execPath, relayEntry],
        environment: relayEnvironment(controller.environment, process.env, "win32")
      }
    }
  };
}

async function pipeRefusedHere(t, layout) {
  t.diagnostic(`${process.platform}: asserting the named-pipe transport refuses to start instead`);
  await assert.rejects(
    new WindowsNamedPipeBridgeTransport({ root: layout.channels }).listen(() => assert.fail("no connection")),
    { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" }
  );
  assert.deepEqual(await readdir(layout.channels), [], "nothing was created");
}

function pipeController(layout, invoked) {
  return McpToolBridgeController.open({
    worktreePath: layout.worktree,
    readScope: ["src"],
    protectedPaths: [".git"],
    taskId: "T405.4",
    capabilityGrantRef: "grant:writer:1",
    payloads: new InMemoryExecutionPayloadStore(),
    invokeTool: (request) => {
      invoked.push(request);
      return Promise.resolve({ receiptRef: `receipt:${invoked.length}` });
    },
    transport: new WindowsNamedPipeBridgeTransport({ root: layout.channels })
  });
}

// invariant: the production driver as the composition builds it on Windows:
// the Windows pass-through list, the composition's owner-only proof (recorded
// here as it answers), and the relay environment with SYSTEMROOT.
async function sessionOverPipe(layout, controller) {
  const proofs = [];
  const driver = new ClaudeCodeDriver({
    command: [process.execPath, fakeMediatedClaude, "--fixture-observations", layout.observations],
    profile: {
      kind: "mediated-mcp",
      environment: passThroughEnvironment(process.env, "win32"),
      isolationRoot: layout.isolationRoot,
      ownerOnlyProof: async (directory) => {
        const proven = await provenOwnerOnly(directory);
        proofs.push({ directory, proven, entries: await readdir(directory) });
        return proven;
      }
    },
    resolveExecution: () => Promise.resolve(execution(controller, layout.worktree)),
    terminateTree: (pid) => Promise.resolve(void process.kill(pid))
  });
  const events = [];
  const session = await driver.start(mockRequest(), (event) => events.push(event), new AbortController().signal);
  return { events, closed: await driver.close(session), proofs };
}

test("win32: a mediated session reaches the controller over the named pipe from an owner-only isolation directory", async (t) => {
  const layout = await windowsLayout(t);
  if (!WIN32_HOST) return pipeRefusedHere(t, layout);
  const invoked = [];
  const controller = await pipeController(layout, invoked);
  const endpoint = controller.socketPath;
  let run;
  try {
    run = await sessionOverPipe(layout, controller);
  } finally {
    // hazard: the pipe helper works in its directory below the layout until
    // the controller closes, so it closes before the layout is removed.
    await controller.close();
  }
  const { events, closed, proofs } = run;
  assert.deepEqual(mediatedErrors(events), []);
  assert.equal(closed.outcome, "completed");
  assert.match(endpoint, /^\\\\\.\\pipe\\verchestra-[0-9a-f]{32}$/u);
  assert.deepEqual(
    events.filter((event) => event.type === "tool.requested").map((event) => event.name),
    ["mcp__verchestra__read_file", "mcp__verchestra__write_file"]
  );
  assert.ok(events.some((event) => event.type === "content.delta" && event.text === "read:alpha\n"));
  assert.equal(invoked.length, 1);
  assert.deepEqual(invoked[0].targetPaths, ["src/a.txt"]);
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].proven, true, "the isolation directory is proven owner-only");
  assert.deepEqual(proofs[0].entries, [], "the proof leaves the directory empty before the token is written");
  assert.equal(dirname(proofs[0].directory), layout.isolationRoot);
  const observation = JSON.parse(await readFile(join(layout.observations, "fake-claude-observation.json"), "utf8"));
  assert.equal(observation.home, join(proofs[0].directory, "home"));
  for (const key of ["SystemRoot", "USERPROFILE", "CLAUDE_CONFIG_DIR"])
    assert.ok(observation.environmentKeys.includes(key), key);
  assert.equal(observation.configDirectory, join(proofs[0].directory, "config"));
  assert.deepEqual(await readdir(layout.isolationRoot), [], "the isolation directory is removed after the session");
});
