// invariant: #379, the Windows Credential Manager backend's program and result
// protocol, against a fake PowerShell runner. Platform-independent: nothing
// here spawns a process.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CREDENTIAL_PERSISTENCE,
  CredentialToolUnavailableError,
  LOGGING_POLICY_GUARD,
  MAX_CREDENTIAL_VALUE_BYTES,
  POWERSHELL_ARGUMENTS,
  PRESENCE_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  WindowsCredentialManagerBackend,
  createOsCredentialStore,
  credentialProgram,
  credentialTarget,
  powershellChildEnvironment,
  powershellExecutable
} from "../../packages/platform-node/src/index.ts";
import { DOCTOR_PROBE_TIMEOUT_MS } from "../../packages/application/src/index.ts";
import { fakePowerShellRunner } from "../helpers/fake-credential-tool-runners.mjs";

const workspaceId = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const locator = Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName: "anthropic-api-key" });
const target = `verchestra/${workspaceId}/anthropic-api-key`;
const VALUE = "sk-ant-unit-value-123";
const value = () => new TextEncoder().encode(VALUE);
const answer =
  (stdout, exitCode = 0) =>
  async () => ({ exitCode, stdout, stderr: "" });

test("reads, writes, and deletes run Windows PowerShell with the program on stdin; presence runs cmdkey", async () => {
  assert.deepEqual(
    [...POWERSHELL_ARGUMENTS],
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"]
  );
  const fake = fakePowerShellRunner();
  const backend = new WindowsCredentialManagerBackend({ runner: fake.runner });
  await backend.store(locator, value());
  await backend.has(locator);
  await backend.read(locator);
  await backend.delete(locator);
  assert.deepEqual(
    fake.invocations.map((invocation) => [invocation.tool, invocation.timeoutMs]),
    [
      ["powershell", WRITE_TIMEOUT_MS],
      ["cmdkey", PRESENCE_TIMEOUT_MS],
      ["cmdkey", PRESENCE_TIMEOUT_MS],
      ["powershell", READ_TIMEOUT_MS],
      ["powershell", WRITE_TIMEOUT_MS]
    ]
  );
  for (const invocation of fake.invocations) {
    if (invocation.tool === "cmdkey") {
      assert.deepEqual(invocation.args, [`/list:${target}`]);
      assert.equal(invocation.stdin, "", "presence sends nothing on stdin");
    } else assert.deepEqual(invocation.args, [...POWERSHELL_ARGUMENTS]);
  }
  assert.ok(PRESENCE_TIMEOUT_MS < DOCTOR_PROBE_TIMEOUT_MS);
});

test("presence is the cmdkey target line, never the header that echoes the query", async () => {
  const has = (stdout, exitCode = 0) =>
    new WindowsCredentialManagerBackend({ runner: answer(stdout, exitCode) }).has(locator);
  const header = `\r\nCurrently stored credentials for ${target}:\r\n\r\n`;
  assert.equal(await has(`${header}    Target: ${target}\r\n    Type: Generic \r\n`), true);
  assert.equal(await has(`${header}    Ziel: ${target}\r\n`), true, "a localized label still counts");
  assert.equal(await has(`${header}* NONE *\r\n`), false);
  assert.equal(await has(`${header}    Target: ${target}-other\r\n`), false, "another target never counts");
  assert.equal(await has(`    Target: x${target}\r\n`), false);
  await assert.rejects(has(`${header}    Target: ${target}\r\n`, 1), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("the program is one complete statement per line and names the operation and target once", () => {
  for (const operation of ["Read", "Delete"]) {
    const program = credentialProgram(operation, locator);
    const lines = program.split("\n");
    assert.equal(lines.at(-1), "", "the program ends with a newline");
    assert.equal(lines[0], "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'");
    assert.match(
      lines[1],
      /^\$verchestraOptions = \[System\.CodeDom\.Compiler\.CompilerParameters\]::new\(\); \$verchestraOptions\.GenerateInMemory = \$true; \$verchestraBuild = \[Microsoft\.CSharp\.CSharpCodeProvider\]::new\(\)\.CompileAssemblyFromSource\(\$verchestraOptions, \[string\[\]\]@\('[^']*'\)\); if /u,
      "the C# source holds no single quote"
    );
    assert.doesNotMatch(
      lines[1],
      /Add-Type|Import-Module|New-Object/u,
      "no cmdlet, so no module is discovered or loaded"
    );
    const call = operation === "Read" ? 3 : 2;
    if (operation === "Read")
      assert.equal(lines[2], LOGGING_POLICY_GUARD, "a read, which prints the value, is guarded");
    else assert.equal(program.includes(LOGGING_POLICY_GUARD), false, "presence and delete carry no value");
    assert.equal(lines[call], `[Console]::Out.WriteLine($verchestraType::${operation}('${target}'))`);
    assert.equal(lines[call + 1], "exit 0");
    assert.equal(lines.length, call + 3);
  }
});

test("the logging-policy guard checks script block logging and transcription in both policy hives", () => {
  for (const hive of ["HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER"]) assert.ok(LOGGING_POLICY_GUARD.includes(`'${hive}'`));
  assert.match(LOGGING_POLICY_GUARD, /@\('ScriptBlockLogging', 'EnableScriptBlockLogging'\)/u);
  assert.match(LOGGING_POLICY_GUARD, /@\('Transcription', 'EnableTranscripting'\)/u);
  assert.ok(LOGGING_POLICY_GUARD.includes("\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\"));
  assert.match(
    LOGGING_POLICY_GUARD,
    /\[Console\]::Out\.WriteLine\('verchestra-credential:error:logging'\); exit 0 \}$/u
  );
  assert.doesNotMatch(LOGGING_POLICY_GUARD, /\n/u, "one statement line");
});

test("a machine that records PowerShell input or output refuses reads and writes before the value moves", async () => {
  const logged = new WindowsCredentialManagerBackend({ runner: answer("verchestra-credential:error:logging\r\n") });
  await assert.rejects(logged.read(locator), { code: "VES_SECRET_STORE_LOGGED" });
  await assert.rejects(logged.store(locator, value()), { code: "VES_SECRET_STORE_LOGGED" });
  const fake = fakePowerShellRunner();
  await new WindowsCredentialManagerBackend({ runner: fake.runner }).store(locator, value());
  const lines = fake.invocations[0].stdin.split("\n");
  const guard = lines.indexOf(LOGGING_POLICY_GUARD);
  const payload = lines.findIndex((line) => line.startsWith("$verchestraPayload = '"));
  assert.ok(guard > 0 && guard < payload, "the guard runs, and can exit, before the payload line");
});

test("the inline P/Invoke is advapi32 CredReadW, CredWriteW, and CredDeleteW on generic, machine-local credentials", () => {
  const source = credentialProgram("Delete", locator).split("\n")[1];
  for (const entry of ["CredReadW", "CredWriteW", "CredDeleteW"])
    assert.match(source, new RegExp(`\\[DllImport\\("advapi32\\.dll", EntryPoint = "${entry}"`, "u"));
  assert.match(source, /private const uint Generic = 1;/u, "CRED_TYPE_GENERIC");
  assert.match(source, /private const uint PersistLocalMachine = 2;/u, "CRED_PERSIST_LOCAL_MACHINE");
  assert.match(source, /credential\.Persist = PersistLocalMachine;/u);
  assert.match(source, /private const int NotFound = 1168;/u, "ERROR_NOT_FOUND");
  assert.equal(CREDENTIAL_PERSISTENCE, "CRED_PERSIST_LOCAL_MACHINE");
  assert.doesNotMatch(source, /Persist(?:Enterprise|Session)|= 3;/u);
});

test("a write carries the value only as the base64 literal of one assignment line", async () => {
  const fake = fakePowerShellRunner();
  await new WindowsCredentialManagerBackend({ runner: fake.runner }).store(locator, value());
  const { stdin, args } = fake.invocations[0];
  const encoded = Buffer.from(VALUE).toString("base64");
  const lines = stdin.split("\n");
  const payload = lines.indexOf(`$verchestraPayload = '${encoded}'`);
  assert.equal(payload, 3, "the payload follows the preamble and the logging-policy guard");
  assert.equal(
    lines[payload + 1],
    `[Console]::Out.WriteLine($verchestraType::Write('${target}', 'anthropic-api-key', $verchestraPayload))`
  );
  assert.equal(lines[payload + 2], "$verchestraPayload = $null");
  assert.equal(lines[payload + 3], "exit 0");
  assert.equal(stdin.split(encoded).length, 2, "the encoded value appears exactly once");
  assert.doesNotMatch(
    lines[payload],
    /Add-Type|DllImport|FromBase64String|Marshal|Invoke/iu,
    "the value line holds no keyword that triggers automatic script block logging"
  );
  assert.equal(stdin.includes(VALUE), false, "the raw value is never in the program");
  assert.equal(stdin.includes(Buffer.from(VALUE).toString("hex")), false);
  assert.equal(args.join(" ").includes(encoded), false);
  assert.equal(fake.items.get(target).user, "anthropic-api-key");
  assert.deepEqual([...fake.items.get(target).value], [...value()]);
});

test("result lines map to value and outcome; errors are classified without their text", async () => {
  const backend = (stdout, exitCode) => new WindowsCredentialManagerBackend({ runner: answer(stdout, exitCode) });
  assert.equal(await backend("noise\r\nverchestra-credential:absent\r\n").read(locator), undefined);
  assert.deepEqual(
    await backend(`verchestra-credential:value:${Buffer.from(VALUE).toString("base64")}\r\n`).read(locator),
    value()
  );
  assert.equal(await backend("verchestra-credential:deleted\r\n").delete(locator), true);
  assert.equal(await backend("verchestra-credential:absent\r\n").delete(locator), false);
  for (const [stdout, exitCode, code] of [
    ["verchestra-credential:error:1312\r\n", 0, "VES_SECRET_STORE_UNAVAILABLE"],
    ["verchestra-credential:error:1004\r\n", 0, "VES_SECRET_STORE_UNAVAILABLE"],
    ["verchestra-credential:error:5\r\n", 0, "VES_SECRET_BACKEND_FAILURE"],
    ["verchestra-credential:error:payload\r\n", 0, "VES_SECRET_BACKEND_FAILURE"],
    ["verchestra-credential:error:compile\r\n", 1, "VES_SECRET_BACKEND_FAILURE"],
    ["", 0, "VES_SECRET_BACKEND_FAILURE"],
    ["verchestra-credential:deleted\r\n", 1, "VES_SECRET_BACKEND_FAILURE"],
    ["verchestra-credential:stored\r\n", 0, "VES_SECRET_BACKEND_FAILURE"],
    ["verchestra-credential:value:!!\r\n", 0, "VES_SECRET_BACKEND_FAILURE"]
  ]) {
    await assert.rejects(backend(stdout, exitCode).read(locator), { code }, JSON.stringify(stdout));
  }
  await assert.rejects(backend("verchestra-credential:value:c2s=\r\n").delete(locator), {
    code: "VES_SECRET_BACKEND_FAILURE"
  });
});

test("a timeout is a retryable failure, never a prompt, and a missing PowerShell is not configured", async () => {
  const timedOut = new WindowsCredentialManagerBackend({
    runner: async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" })
  });
  const missing = new WindowsCredentialManagerBackend({
    runner: async () => {
      throw new CredentialToolUnavailableError();
    }
  });
  for (const operation of ["has", "read", "delete"]) {
    await assert.rejects(timedOut[operation](locator), { code: "VES_SECRET_BACKEND_FAILURE" });
    await assert.rejects(missing[operation](locator), { code: "VES_SECRET_STORE_UNAVAILABLE" });
  }
  await assert.rejects(timedOut.store(locator, value()), { code: "VES_SECRET_BACKEND_FAILURE" });
  await assert.rejects(missing.store(locator, value()), { code: "VES_SECRET_STORE_UNAVAILABLE" });
});

test("a rotation is one replacing write, and a write that did not persist is a failure", async () => {
  const fake = fakePowerShellRunner();
  const backend = new WindowsCredentialManagerBackend({ runner: fake.runner });
  await backend.store(locator, value());
  fake.invocations.length = 0;
  await backend.store(locator, new TextEncoder().encode("sk-ant-rotated"));
  assert.equal(fake.invocations.length, 2, "one write and one presence check");
  assert.equal(new TextDecoder().decode(await backend.read(locator)), "sk-ant-rotated");
  const forgetful = new WindowsCredentialManagerBackend({
    runner: async (invocation) => {
      const program = Buffer.from(invocation.stdin ?? []).toString("latin1");
      return {
        exitCode: 0,
        stdout: program.includes("::Write(") ? "verchestra-credential:stored\r\n" : "verchestra-credential:absent\r\n",
        stderr: ""
      };
    }
  });
  await assert.rejects(forgetful.store(locator, value()), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("an invalid locator or value is refused before any process runs", async () => {
  const fake = fakePowerShellRunner();
  const backend = new WindowsCredentialManagerBackend({ runner: fake.runner });
  for (const bad of [
    { namespace: "verchestra/not-a-workspace", logicalName: "anthropic-api-key" },
    { namespace: locator.namespace, logicalName: "a'b" },
    { namespace: `verchestra/${workspaceId}'`, logicalName: "anthropic-api-key" }
  ]) {
    await assert.rejects(backend.has(bad), { code: "VES_SECRET_BINDING_INVALID" });
    await assert.rejects(backend.store(bad, value()), { code: "VES_SECRET_BINDING_INVALID" });
    assert.throws(() => credentialTarget(bad), { code: "VES_SECRET_BINDING_INVALID" });
  }
  for (const invalid of [
    new Uint8Array(),
    new TextEncoder().encode("two words"),
    new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)
  ])
    await assert.rejects(backend.store(locator, invalid), { code: "VES_SECRET_VALUE_INVALID" });
  assert.equal(fake.invocations.length, 0);
});

test("PowerShell is resolved under the system root, and the child environment is an allowlist", () => {
  const saved = { ...process.env };
  try {
    process.env.SystemRoot = "D:\\Windows";
    process.env.ANTHROPIC_API_KEY = "sk-ant-ambient";
    process.env.PATH = "C:\\evil;C:\\Windows\\System32";
    assert.equal(powershellExecutable(), "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const environment = powershellChildEnvironment();
    assert.equal(environment.ANTHROPIC_API_KEY, undefined);
    assert.equal(environment.PATH, "D:\\Windows\\System32;D:\\Windows;D:\\Windows\\System32\\WindowsPowerShell\\v1.0");
    assert.equal(environment.SystemRoot, "D:\\Windows");
    for (const key of Object.keys(environment))
      assert.ok(
        [
          "SystemRoot",
          "windir",
          "PATH",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA",
          "USERNAME",
          "USERDOMAIN",
          "TEMP",
          "TMP",
          "SystemDrive",
          "ProgramData",
          "PROCESSOR_ARCHITECTURE"
        ].includes(key),
        key
      );
    process.env.SystemRoot = "\\\\server\\share";
    assert.equal(powershellExecutable(), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the win32 store is the qualified Credential Manager adapter and refuses a keychain path", () => {
  const store = createOsCredentialStore({ platform: "win32", runner: fakePowerShellRunner().runner });
  assert.equal(store.storeId, "windows-credential-manager");
  assert.equal(store.keychain, "default");
  assert.throws(() => createOsCredentialStore({ platform: "win32", keychainPath: "C:\\a.keychain-db" }), {
    code: "VES_SECRET_KEYCHAIN_INVALID"
  });
});
