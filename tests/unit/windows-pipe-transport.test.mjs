// invariant: what of the Windows named-pipe transport needs no Windows runs
// here on every platform (SSI-71..73, SSI-75): the name, the constant helper,
// its arguments and environment, the refusal mapping to the Unix codes, and
// the lifecycle over a fake host. The real pipe is qualified on the Windows
// runner in tests/security/windows-pipe-bridge-security.test.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { afterEach, test } from "node:test";

import { LOGGING_POLICY_GUARD } from "../../packages/platform-node/src/os-secret-backends/windows-credential-manager.ts";
import {
  PIPE_HELPER_SCRIPT,
  PIPE_NAME,
  POWERSHELL_7_EXECUTABLE,
  POWERSHELL_7_LOGGING_GUARD,
  WindowsNamedPipeBridgeTransport,
  assertPipeName,
  freshPipeName,
  helperArguments,
  helperEnvironment,
  helperRefusal,
  pipeEndpoint
} from "../../packages/platform-node/src/windows-pipe-transport.ts";
import { FakePipeHost, cleanupPlainWorktrees, plainWorktree } from "../helpers/pipe-bridge-fixture.mjs";
import { eventually } from "../helpers/process-liveness.mjs";

afterEach(cleanupPlainWorktrees);

const NAME = `verchestra-${"0123456789abcdef".repeat(2)}`;
const LINES = PIPE_HELPER_SCRIPT.split("\n");

test("a fresh pipe name is 128 random bits in the one accepted shape", () => {
  const sizes = [];
  const name = freshPipeName((size) => {
    sizes.push(size);
    return Buffer.alloc(size, 0xab);
  });
  assert.deepEqual(sizes, [16]);
  assert.equal(name, `verchestra-${"ab".repeat(16)}`);
  const names = new Set(Array.from({ length: 64 }, () => freshPipeName()));
  assert.equal(names.size, 64);
  for (const fresh of names) assert.match(fresh, PIPE_NAME);
  assert.equal(pipeEndpoint(NAME), `\\\\.\\pipe\\${NAME}`);
});

for (const invalid of [
  "",
  "verchestra-",
  `verchestra-${"a".repeat(31)}`,
  `verchestra-${"a".repeat(33)}`,
  `verchestra-${"A".repeat(32)}`,
  `VERCHESTRA-${"a".repeat(32)}`,
  `verchestra-${"a".repeat(32)}\n`,
  `verchestra-${"a".repeat(30)}..`,
  "verchestra-$(Start-Process calc)",
  "verchestra-a'; Remove-Item C:\\ -Recurse; '",
  "-Command",
  42,
  undefined
])
  test(`the pipe name ${JSON.stringify(String(invalid))} is refused before any use`, () => {
    assert.throws(() => assertPipeName(invalid), { code: "VES_BRIDGE_CHANNEL_FAILED" });
    if (typeof invalid === "string") {
      assert.throws(() => helperArguments("C:\\run\\pipe-helper.ps1", invalid), { code: "VES_BRIDGE_CHANNEL_FAILED" });
      assert.throws(() => pipeEndpoint(invalid), { code: "VES_BRIDGE_CHANNEL_FAILED" });
    }
  });

test("the helper is one constant script, pinned by digest", () => {
  assert.equal(
    createHash("sha256").update(PIPE_HELPER_SCRIPT).digest("hex"),
    "e3e3667820411e8d8c6d423069c349396156b2bf2c6d88937d3d45b35c6b98b9"
  );
  assert.equal(LINES[0], "param([string] $verchestraPipeName = '')", "its one parameter is the pipe name");
  assert.equal(PIPE_HELPER_SCRIPT.match(/\bparam\(/gu).length, 1);
  assert.ok(
    PIPE_HELPER_SCRIPT.includes(`'${PIPE_NAME.source}'`),
    "the helper re-validates the name with the same shape"
  );
  assert.doesNotMatch(PIPE_HELPER_SCRIPT, /\$input\b/iu, "naming $input would make PowerShell drain stdin first");
  assert.doesNotMatch(
    PIPE_HELPER_SCRIPT,
    /Invoke-Expression|\biex\b|ScriptBlock\]::Create|Add-Type|Start-Process|EncodedCommand|\.Invoke\(/iu,
    "the helper evaluates no text"
  );
  assert.doesNotMatch(
    PIPE_HELPER_SCRIPT,
    /Diagnostics\.Process|Start-(?:Process|Job|ThreadJob)|Invoke-Item|HandleInheritability/iu,
    "the helper starts no process and makes no handle inheritable, so only it holds the pipe's server end"
  );
});

test("the helper refuses logged PowerShell before it creates the pipe", () => {
  const redirect = LINES.indexOf("[Console]::SetOut([Console]::Error)");
  const guard = LINES.indexOf(LOGGING_POLICY_GUARD);
  const coreGuard = LINES.indexOf(POWERSHELL_7_LOGGING_GUARD);
  const created = LINES.findIndex((line) => line.includes("NamedPipeServerStream]::new("));
  assert.ok(redirect > 0 && redirect < guard, "text output is moved off the relay stream first");
  assert.ok(guard < coreGuard && coreGuard < created, "both logging guards run before the pipe exists");
  for (const hive of ["HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER"])
    assert.ok(POWERSHELL_7_LOGGING_GUARD.includes(`'${hive}'`));
  assert.match(POWERSHELL_7_LOGGING_GUARD, /SOFTWARE\\Policies\\Microsoft\\PowerShellCore\\/u);
  assert.match(POWERSHELL_7_LOGGING_GUARD, /@\('ScriptBlockLogging', 'EnableScriptBlockLogging'\)/u);
  assert.match(POWERSHELL_7_LOGGING_GUARD, /@\('Transcription', 'EnableTranscripting'\)/u);
  assert.match(POWERSHELL_7_LOGGING_GUARD, /\$PSHOME, 'powershell\.config\.json'/u);
  assert.match(POWERSHELL_7_LOGGING_GUARD, /'verchestra-credential:error:logging'\); exit 0 \}$/u);
});

test("the helper owns a current-user, first-instance pipe with one instance and relays only bytes", () => {
  const options = LINES.find((line) => line.startsWith("$verchestraOptions = "));
  for (const option of ["CurrentUserOnly", "FirstPipeInstance", "Asynchronous"])
    assert.ok(options.includes(`[System.IO.Pipes.PipeOptions]::${option}`), option);
  assert.ok(
    PIPE_HELPER_SCRIPT.includes(
      "[System.IO.Pipes.NamedPipeServerStream]::new($verchestraPipeName, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, $verchestraOptions)"
    ),
    "one server instance at most"
  );
  assert.ok(PIPE_HELPER_SCRIPT.includes("[Console]::OpenStandardInput().CopyToAsync($verchestraServer)"));
  assert.ok(PIPE_HELPER_SCRIPT.includes("$verchestraServer.CopyToAsync([Console]::OpenStandardOutput())"));
  assert.equal(PIPE_HELPER_SCRIPT.match(/WaitForConnection\(\)/gu).length, 1, "it serves one client and ends");
});

test("PowerShell 7 is launched from its pinned path with the constant script and the name alone", () => {
  assert.equal(POWERSHELL_7_EXECUTABLE, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  assert.ok(win32.isAbsolute(POWERSHELL_7_EXECUTABLE));
  const args = helperArguments("C:\\run\\vpipe-1\\pipe-helper.ps1", NAME);
  assert.deepEqual(args, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\run\\vpipe-1\\pipe-helper.ps1",
    NAME
  ]);
  assert.ok(Object.isFrozen(args));
  for (const flag of ["-Command", "-c", "-EncodedCommand", "-ec"]) assert.equal(args.includes(flag), false, flag);
});

test("the helper environment is an allowlist with a fixed PATH and never the bridge token", () => {
  const environment = helperEnvironment(
    {
      PATH: "C:\\attacker;C:\\Windows\\System32",
      USERPROFILE: "C:\\Users\\owner",
      LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local",
      TEMP: "C:\\Users\\owner\\Temp\nINJECTED=1",
      VERCHESTRA_BRIDGE_TOKEN: "a".repeat(64),
      ANTHROPIC_API_KEY: "sk-test",
      PSModulePath: "C:\\attacker\\modules"
    },
    "C:\\Windows"
  );
  assert.deepEqual(environment, {
    SystemRoot: "C:\\Windows",
    windir: "C:\\Windows",
    PATH: "C:\\Windows\\System32;C:\\Windows",
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off",
    USERPROFILE: "C:\\Users\\owner",
    LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local"
  });
});

for (const [status, code, requirement] of [
  ["verchestra-credential:error:logging", "VES_BRIDGE_NOT_CONFIGURED", "powershell-logging-off"],
  ["verchestra-pipe:error:version", "VES_BRIDGE_NOT_CONFIGURED", "powershell-7"],
  ["verchestra-pipe:error:exists", "VES_BRIDGE_CHANNEL_INSECURE", undefined],
  ["verchestra-pipe:error:name", "VES_BRIDGE_CHANNEL_FAILED", undefined],
  ["verchestra-pipe:error:create", "VES_BRIDGE_CHANNEL_FAILED", undefined],
  ["pwsh : C:\\Users\\owner\\secret detail", "VES_BRIDGE_CHANNEL_FAILED", undefined],
  [undefined, "VES_BRIDGE_CHANNEL_FAILED", undefined]
])
  test(`the helper status ${String(status)} maps to ${code}`, () => {
    const refusal = helperRefusal(status);
    assert.equal(refusal.code, code);
    assert.equal(refusal.requirement, requirement);
    assert.doesNotMatch(refusal.message, /owner|secret|C:\\/u, "no helper text reaches the error");
  });

async function transportOver(host, overrides = {}) {
  const { root } = await plainWorktree();
  const accepted = [];
  const transport = new WindowsNamedPipeBridgeTransport({
    root,
    host,
    environment: { USERPROFILE: "C:\\Users\\owner", VERCHESTRA_BRIDGE_TOKEN: "a".repeat(64) },
    ...overrides
  });
  const runs = async () => (await readdir(root)).filter((entry) => entry.startsWith("vpipe-"));
  return { root, transport, accepted, runs, listen: () => transport.listen((connection) => accepted.push(connection)) };
}

test("off Windows the transport refuses before it checks or creates anything", async () => {
  const host = new FakePipeHost();
  host.platform = "linux";
  const { listen, runs } = await transportOver(host);
  await assert.rejects(listen(), { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" });
  assert.deepEqual([host.checked, host.started, await runs()], [[], [], []]);
});

test("a missing PowerShell 7 is not configured and names the prerequisite", async () => {
  const host = new FakePipeHost();
  host.installed = false;
  const { listen, runs } = await transportOver(host);
  await assert.rejects(listen(), { code: "VES_BRIDGE_NOT_CONFIGURED", requirement: "powershell-7" });
  assert.deepEqual(host.checked, [POWERSHELL_7_EXECUTABLE]);
  assert.deepEqual([host.started, await runs()], [[], []]);
});

test("a per-run directory that cannot be proven owner-only is not configured and is removed", async () => {
  const host = new FakePipeHost();
  host.proof = Object.freeze({ proven: false, step: "verify" });
  const { listen, runs } = await transportOver(host);
  await assert.rejects(listen(), { code: "VES_BRIDGE_NOT_CONFIGURED", requirement: "owner-only-acl" });
  assert.equal(host.secured.length, 1);
  assert.deepEqual([host.started, await runs()], [[], []]);
});

for (const [status, code, requirement] of [
  ["verchestra-credential:error:logging", "VES_BRIDGE_NOT_CONFIGURED", "powershell-logging-off"],
  ["verchestra-pipe:error:version", "VES_BRIDGE_NOT_CONFIGURED", "powershell-7"],
  ["verchestra-pipe:error:exists", "VES_BRIDGE_CHANNEL_INSECURE", undefined],
  ["verchestra-pipe:error:create", "VES_BRIDGE_CHANNEL_FAILED", undefined]
])
  test(`a helper that ends on ${status} is refused, terminated, and cleaned up`, async () => {
    const host = new FakePipeHost((helper) => {
      helper.status("pwsh: unrelated diagnostic");
      helper.status(status);
    });
    const { listen, runs } = await transportOver(host);
    await assert.rejects(listen(), { code, requirement });
    assert.deepEqual(host.terminated, [4242]);
    assert.deepEqual(await runs(), []);
  });

test("a helper that exits without a status line is a failed channel", async () => {
  const host = new FakePipeHost((helper) => helper.exit());
  const { listen, runs } = await transportOver(host);
  await assert.rejects(listen(), { code: "VES_BRIDGE_CHANNEL_FAILED", message: /ended before it listened/u });
  assert.deepEqual(host.terminated, [], "an exited helper's pid is never signalled");
  assert.deepEqual(await runs(), []);
});

test("a helper that never listens is stopped at the startup bound", async () => {
  const host = new FakePipeHost(() => undefined);
  const { listen, runs } = await transportOver(host, { startupTimeoutMs: 20 });
  await assert.rejects(listen(), { code: "VES_BRIDGE_CHANNEL_FAILED", message: /did not listen in time/u });
  assert.deepEqual(host.terminated, [4242]);
  assert.deepEqual(await runs(), []);
});

test("a helper that cannot be started is not configured", async () => {
  const host = new FakePipeHost((helper) => helper.emit("error", new Error("spawn ENOENT")));
  const { listen, runs } = await transportOver(host);
  await assert.rejects(listen(), { code: "VES_BRIDGE_NOT_CONFIGURED", requirement: "powershell-7" });
  assert.deepEqual(await runs(), []);
});

test("a listening helper is the constant script, started in an owner-only directory, behind a fresh name", async () => {
  const host = new FakePipeHost();
  const { listen, runs } = await transportOver(host);
  const first = await listen();
  const second = await listen();
  const [run] = host.started;
  const directory = run.options.cwd;
  assert.equal(run.executable, POWERSHELL_7_EXECUTABLE);
  assert.equal(run.args.at(-2), join(directory, "pipe-helper.ps1"), "the script lives in the per-run directory");
  assert.equal(run.script, PIPE_HELPER_SCRIPT, "the file PowerShell runs is the constant script");
  assert.deepEqual(run.args, helperArguments(run.args.at(-2), run.args.at(-1)));
  assert.equal(first.endpoint, pipeEndpoint(run.args.at(-1)));
  assert.notEqual(first.endpoint, second.endpoint, "every run has its own pipe name");
  assert.deepEqual(host.secured[0], { directory, entries: [] }, "the ACL is proven before anything is written");
  assert.deepEqual(run.options.env, helperEnvironment({ USERPROFILE: "C:\\Users\\owner" }));
  assert.equal((await runs()).length, 2);
  await first.close();
  await second.close();
});

test("a connected client's bytes reach the controller and the controller's bytes reach the client", async () => {
  const host = new FakePipeHost();
  const { listen, accepted } = await transportOver(host);
  const channel = await listen();
  host.helper.status("verchestra-pipe:connected");
  host.helper.stdout.write("from the client\n");
  assert.ok(await eventually(() => accepted.length > 0), "the controller is handed the connection");
  const [connection] = accepted;
  let received = "";
  connection.on("data", (chunk) => (received += chunk));
  connection.write("to the client\n");
  assert.ok(await eventually(() => received !== "" && host.helper.received !== ""));
  assert.equal(received, "from the client\n");
  assert.equal(host.helper.received, "to the client\n");
  await channel.close();
});

test("a connection the controller refuses ends the helper that holds the pipe", async () => {
  const host = new FakePipeHost();
  const { listen, accepted, runs } = await transportOver(host);
  const channel = await listen();
  host.helper.status("verchestra-pipe:connected");
  assert.ok(await eventually(() => accepted.length > 0), "the controller is handed the connection");
  accepted[0].destroy();
  assert.ok(await eventually(() => host.terminated.length > 0), "the helper is terminated");
  assert.deepEqual(host.terminated, [4242]);
  assert.equal((await runs()).length, 1, "the run's directory stays until the channel closes");
  await channel.close();
  assert.deepEqual(host.terminated, [4242], "the tree is terminated once");
  assert.deepEqual(host.helper.kills, [], "a helper its tree termination ended is not killed again");
  assert.deepEqual(await runs(), []);
});

// invariant: SSI-75 when the tree terminator does not end the helper. A
// helper that ignores the end of its streams, whose tree termination misses
// it or never returns, is killed through its own handle within the bound,
// whether the controller refused its client or the channel closed, so the
// pipe's server end closes; it is killed once and the run's directory goes.
for (const tree of ["misses", "hangs"]) {
  test(`a refused client's helper is killed by its handle when the tree termination ${tree}`, async () => {
    const host = new FakePipeHost();
    host.tree = tree;
    const { listen, accepted, runs } = await transportOver(host, { exitWaitMs: 50 });
    const channel = await listen();
    host.helper.status("verchestra-pipe:connected");
    assert.ok(await eventually(() => accepted.length > 0), "the controller is handed the connection");
    accepted[0].destroy();
    assert.ok(await eventually(() => host.helper.exited === true, 2_000), "the helper is ended within the bound");
    assert.deepEqual(host.terminated, [4242]);
    assert.deepEqual(host.helper.kills, ["SIGKILL"]);
    await channel.close();
    assert.deepEqual([host.terminated, host.helper.kills], [[4242], ["SIGKILL"]], "it is ended once");
    assert.deepEqual(await runs(), []);
  });

  test(`closing the channel kills its helper by its handle when the tree termination ${tree}`, async () => {
    const host = new FakePipeHost();
    host.tree = tree;
    const { listen, runs } = await transportOver(host, { exitWaitMs: 50 });
    const channel = await listen();
    const closing = channel.close();
    assert.equal(
      await eventually(() => host.helper.exited === true, 2_000),
      true,
      "the helper is ended within the bound"
    );
    await closing;
    assert.deepEqual([host.terminated, host.helper.kills], [[4242], ["SIGKILL"]]);
    assert.deepEqual(await runs(), []);
  });
}

// invariant: the channel's trace (PipeChannelEvent) names each step of its
// life: the helper's start and status, the connection's close, what began
// the helper's end and whether the helper still ran, how the tree terminator
// returned, a kill through the handle, the helper's exit, and the channel's
// close. The fake helper exits as soon as it is ended, so its exit is traced
// inside the step that ended it.
const STARTED = [
  { step: "helper-started", pid: 4242 },
  { step: "listening" },
  { step: "connected" },
  { step: "connection-closed" },
  { step: "end", trigger: "connection-closed", running: true }
];
const EXITED = { step: "helper-exited", code: 0, signal: null };
const KILLED = { step: "helper-killed", sent: true };
for (const [tree, ending] of [
  ["ends", [EXITED, { step: "tree-terminated", outcome: "returned" }]],
  ["misses", [{ step: "tree-terminated", outcome: "returned" }, EXITED, KILLED]],
  ["hangs", [{ step: "tree-terminated", outcome: "timed-out" }, EXITED, KILLED]]
])
  test(`a refused channel's trace names every step when the tree termination ${tree}`, async () => {
    const host = new FakePipeHost();
    host.tree = tree;
    const events = [];
    const { listen, accepted } = await transportOver(host, { exitWaitMs: 50, observe: (event) => events.push(event) });
    const channel = await listen();
    host.helper.status("verchestra-pipe:connected");
    assert.ok(await eventually(() => accepted.length > 0), "the controller is handed the connection");
    accepted[0].destroy();
    assert.ok(await eventually(() => events.length === STARTED.length + ending.length, 2_000), JSON.stringify(events));
    await channel.close();
    assert.deepEqual(events, [...STARTED, ...ending, { step: "channel-closed" }]);
  });

test("a channel closed before any client traces its close as what began the helper's end", async () => {
  const host = new FakePipeHost();
  const events = [];
  const { listen } = await transportOver(host, { observe: (event) => events.push(event) });
  await (await listen()).close();
  assert.deepEqual(events.slice(2), [
    { step: "channel-closed" },
    { step: "end", trigger: "channel-closed", running: true },
    EXITED,
    { step: "tree-terminated", outcome: "returned" }
  ]);
});

test("an observer that throws changes nothing of the channel", async () => {
  const host = new FakePipeHost();
  const { listen, accepted, runs } = await transportOver(host, {
    observe: () => {
      throw new Error("the observer failed");
    }
  });
  const channel = await listen();
  host.helper.status("verchestra-pipe:connected");
  assert.ok(await eventually(() => accepted.length > 0), "the controller is handed the connection");
  accepted[0].destroy();
  assert.ok(await eventually(() => host.terminated.length > 0), "the helper is terminated");
  await channel.close();
  assert.deepEqual([host.terminated, await runs()], [[4242], []]);
});

test("closing the channel terminates the helper tree once and removes the per-run directory", async () => {
  const host = new FakePipeHost();
  const { listen, runs } = await transportOver(host);
  const channel = await listen();
  await channel.close();
  await channel.close();
  assert.deepEqual(host.terminated, [4242]);
  assert.equal(host.helper.stdin.destroyed, true, "the helper's input is closed");
  assert.deepEqual(await runs(), []);
});
