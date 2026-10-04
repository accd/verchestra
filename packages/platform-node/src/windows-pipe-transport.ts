// invariant: the Windows bridge channel (SSI-71..73, SSI-75, SSI-76, AD-074).
// Node can serve a named pipe but cannot give it an ACL, a first-instance
// guarantee, or a one-instance limit, so a PowerShell 7 helper owns the pipe
// and relays its bytes over the helper's standard streams. The helper parses
// no frame: authentication, framing, the single connection, and the timeouts
// stay in the bridge controller, exactly as they do over the Unix socket.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex, type Readable, type Writable } from "node:stream";

import { LOGGING_POLICY_GUARD, systemRoot } from "./os-secret-backends/windows-credential-manager.ts";
import { terminateProcessTree } from "./process-tree-terminator.ts";
import { proveOwnerOnlyDirectory, type OwnerOnlyProof } from "./windows-acl.ts";

// why: a fixed path under Program Files, which only administrators can
// change, so neither PATH nor a per-user install can substitute the program
// that holds the pipe.
export const POWERSHELL_7_EXECUTABLE = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
// invariant: 128 random bits in a fixed shape, so the name can be neither
// guessed ahead of the run nor read as anything but a name.
export const PIPE_NAME = /^verchestra-[0-9a-f]{32}$/u;
export const POWERSHELL_HELPER_FLAGS = Object.freeze([
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File"
]);
const HELPER_SCRIPT_FILE = "pipe-helper.ps1";
const LISTENING = "verchestra-pipe:listening";
const CONNECTED = "verchestra-pipe:connected";
// why: a cold PowerShell start measured over 4 s on a hosted runner (AD-041);
// the bound stops a helper that never listens, not a slow one.
const STARTUP_TIMEOUT_MS = 30_000;
// why: each step that ends the helper (its tree's termination, then each wait
// for its exit) has this long, so a channel that closed never waits without
// end on a helper that holds the pipe.
const EXIT_WAIT_MS = 5_000;
const MAXIMUM_STATUS_BYTES = 64 * 1024;
const PASSED_VARIABLES = Object.freeze([
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
]);

// invariant: PowerShell 7 takes its logging policy from its own registry key
// and from powershell.config.json as well as from the Windows PowerShell key
// the credential guard reads (the latter when UseWindowsPowerShellPolicySetting
// is set), so the helper refuses when any of them turns logging on. It writes
// the credential guard's own refusal line, so one mapping covers both.
export const POWERSHELL_7_LOGGING_GUARD = [
  "$verchestraCoreLogged = $false;",
  "foreach ($verchestraHive in 'HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER') {",
  "foreach ($verchestraPolicy in @(@('ScriptBlockLogging', 'EnableScriptBlockLogging'), @('Transcription', 'EnableTranscripting'))) {",
  String.raw`$verchestraSetting = [Microsoft.Win32.Registry]::GetValue("$verchestraHive\SOFTWARE\Policies\Microsoft\PowerShellCore\$($verchestraPolicy[0])", $verchestraPolicy[1], $null);`,
  "if ($verchestraSetting -eq 1) { $verchestraCoreLogged = $true } } };",
  "foreach ($verchestraConfig in @([System.IO.Path]::Combine($PSHOME, 'powershell.config.json'), [System.IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'), 'PowerShell', 'powershell.config.json'))) {",
  String.raw`if ([System.IO.File]::Exists($verchestraConfig) -and [System.IO.File]::ReadAllText($verchestraConfig) -match '"Enable(ScriptBlockLogging|Transcripting)"\s*:\s*true') { $verchestraCoreLogged = $true } };`,
  "if ($verchestraCoreLogged) { [Console]::Out.WriteLine('verchestra-credential:error:logging'); exit 0 }"
].join(" ");

// invariant: the helper is this constant and nothing else; its one argument
// is the validated pipe name and no agent content ever reaches it. Text output
// is redirected to the error stream, which carries the status lines, so
// standard output carries only the bytes the pipe client wrote.
// hazard: the script must never name `$input`. PowerShell then reads all of
// standard input as pipeline input before the script runs, and the relay
// would wait for ever.
export const PIPE_HELPER_SCRIPT = [
  "param([string] $verchestraPipeName = '')",
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
  "[Console]::SetOut([Console]::Error)",
  LOGGING_POLICY_GUARD,
  POWERSHELL_7_LOGGING_GUARD,
  "if (-not [Enum]::IsDefined([System.IO.Pipes.PipeOptions], 'FirstPipeInstance')) { [Console]::Error.WriteLine('verchestra-pipe:error:version'); exit 0 }",
  "if ($verchestraPipeName -cnotmatch '^verchestra-[0-9a-f]{32}$') { [Console]::Error.WriteLine('verchestra-pipe:error:name'); exit 0 }",
  "$verchestraOptions = [System.IO.Pipes.PipeOptions]::CurrentUserOnly -bor [System.IO.Pipes.PipeOptions]::FirstPipeInstance -bor [System.IO.Pipes.PipeOptions]::Asynchronous",
  "try { $verchestraServer = [System.IO.Pipes.NamedPipeServerStream]::new($verchestraPipeName, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, $verchestraOptions) }",
  "catch { $verchestraCause = $_.Exception; while ($null -ne $verchestraCause.InnerException) { $verchestraCause = $verchestraCause.InnerException };",
  "if ($verchestraCause -is [System.UnauthorizedAccessException] -or $verchestraCause -is [System.IO.IOException]) { [Console]::Error.WriteLine('verchestra-pipe:error:exists') } else { [Console]::Error.WriteLine('verchestra-pipe:error:create') }; exit 0 }",
  `[Console]::Error.WriteLine('${LISTENING}')`,
  "$verchestraServer.WaitForConnection()",
  `[Console]::Error.WriteLine('${CONNECTED}')`,
  "$verchestraRelays = [System.Threading.Tasks.Task[]]@([Console]::OpenStandardInput().CopyToAsync($verchestraServer), $verchestraServer.CopyToAsync([Console]::OpenStandardOutput()))",
  "$null = [System.Threading.Tasks.Task]::WaitAny($verchestraRelays)",
  "$verchestraServer.Dispose()",
  "exit 0",
  ""
].join("\n");

export class WindowsPipeTransportError extends Error {
  readonly code: string;
  // invariant: names the missing prerequisite of a `not configured` refusal.
  readonly requirement: string | undefined;

  constructor(code: string, message: string, requirement?: string) {
    super(message);
    this.name = "WindowsPipeTransportError";
    this.code = code;
    this.requirement = requirement;
  }
}

function notConfigured(requirement: string, message: string): WindowsPipeTransportError {
  return new WindowsPipeTransportError("VES_BRIDGE_NOT_CONFIGURED", message, requirement);
}

// invariant: each status line the helper may end on, mapped to the codes the
// Unix transport uses: a name that already exists is an insecure channel, as
// a socket directory that is not private is, and a missing prerequisite is
// `not configured` with the prerequisite named.
const HELPER_REFUSALS: Readonly<
  Record<string, { readonly code: string; readonly message: string; readonly requirement?: string }>
> = Object.freeze({
  "verchestra-credential:error:logging": {
    code: "VES_BRIDGE_NOT_CONFIGURED",
    message: "PowerShell script block logging or transcription is enabled",
    requirement: "powershell-logging-off"
  },
  "verchestra-pipe:error:version": {
    code: "VES_BRIDGE_NOT_CONFIGURED",
    message: "PowerShell 7.4 or later is required",
    requirement: "powershell-7"
  },
  "verchestra-pipe:error:exists": {
    code: "VES_BRIDGE_CHANNEL_INSECURE",
    message: "The bridge pipe name already exists"
  },
  "verchestra-pipe:error:name": { code: "VES_BRIDGE_CHANNEL_FAILED", message: "The pipe helper refused the pipe name" },
  "verchestra-pipe:error:create": {
    code: "VES_BRIDGE_CHANNEL_FAILED",
    message: "The pipe helper could not create the pipe"
  }
});

export function isHelperRefusal(status: string): boolean {
  return Object.hasOwn(HELPER_REFUSALS, status);
}

// invariant: no helper output text reaches an error; only the mapped code,
// its fixed message, and the prerequisite name do.
export function helperRefusal(status: string | undefined): WindowsPipeTransportError {
  const refusal = status !== undefined && isHelperRefusal(status) ? HELPER_REFUSALS[status] : undefined;
  if (refusal === undefined)
    return new WindowsPipeTransportError("VES_BRIDGE_CHANNEL_FAILED", "The pipe helper ended before it listened");
  return new WindowsPipeTransportError(refusal.code, refusal.message, refusal.requirement);
}

export function freshPipeName(random: (size: number) => Buffer = randomBytes): string {
  return `verchestra-${random(16).toString("hex")}`;
}

export function assertPipeName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !PIPE_NAME.test(name))
    throw new WindowsPipeTransportError("VES_BRIDGE_CHANNEL_FAILED", "The bridge pipe name is not valid");
}

export function pipeEndpoint(name: string): string {
  assertPipeName(name);
  return `\\\\.\\pipe\\${name}`;
}

export function helperArguments(scriptPath: string, pipeName: string): readonly string[] {
  assertPipeName(pipeName);
  return Object.freeze([...POWERSHELL_HELPER_FLAGS, scriptPath, pipeName]);
}

// invariant: the helper sees the variables PowerShell needs to start for the
// invoking user, a fixed PATH, and its own telemetry and update checks
// switched off; never the bridge token, a credential, or the caller's PATH.
export function helperEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  root: string = systemRoot()
): Record<string, string> {
  const environment: Record<string, string> = {
    SystemRoot: root,
    windir: root,
    PATH: `${root}\\System32;${root}`,
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    POWERSHELL_UPDATECHECK: "Off"
  };
  for (const key of PASSED_VARIABLES) {
    const value = source[key];
    if (value !== undefined && !/[\0\r\n]/u.test(value)) environment[key] = value;
  }
  return environment;
}

export interface PipeHelperProcess {
  readonly pid?: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  // invariant: ends this one process through the handle its parent holds, so
  // it never reaches another process that reused the pid.
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

// invariant: everything the transport needs from the machine. The node host
// is the only production one; a test hands a fake to observe the transport on
// any platform.
export interface WindowsPipeHost {
  readonly platform: NodeJS.Platform;
  powershellInstalled(executable: string): Promise<boolean>;
  secureDirectory(directory: string): Promise<OwnerOnlyProof>;
  startHelper(
    executable: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> }
  ): PipeHelperProcess;
  terminateTree(pid: number): Promise<void>;
}

export const nodeWindowsPipeHost: WindowsPipeHost = Object.freeze({
  platform: process.platform,
  powershellInstalled: async (executable: string) => (await stat(executable).catch(() => undefined))?.isFile() === true,
  secureDirectory: (directory: string) => proveOwnerOnlyDirectory(directory),
  startHelper: (
    executable: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> }
  ) =>
    spawn(executable, [...args], {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }),
  terminateTree: (pid: number) =>
    terminateProcessTree(pid, () => {
      throw new WindowsPipeTransportError("VES_BRIDGE_CHANNEL_FAILED", "The pipe helper outlived its termination");
    })
});

// why: resolves whether the promise settled before the bound, never rejects.
function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    const settled = () => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(settled, settled);
  });
}

function readStatusLines(stream: Readable, onLine: (line: string) => void): void {
  let pending = "";
  let received = 0;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    received += chunk.length;
    // hazard: a helper that floods its status stream is still drained, so it
    // never blocks on a full pipe, but nothing past the bound is parsed.
    if (received > MAXIMUM_STATUS_BYTES) return;
    const lines = `${pending}${chunk}`.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line.replace(/\r$/u, ""));
  });
}

// invariant: the controller's view of one pipe client. Bytes the client wrote
// arrive on the helper's standard output, bytes the controller writes leave
// on its standard input, and the connection ends when either side does, as a
// socket without half-open support would.
class HelperConnection extends Duplex {
  readonly #helper: PipeHelperProcess;

  constructor(helper: PipeHelperProcess) {
    super({ allowHalfOpen: false });
    this.#helper = helper;
    helper.stdout.on("data", (chunk: Buffer) => {
      if (!this.push(chunk)) helper.stdout.pause();
    });
    helper.stdout.once("end", () => this.push(null));
  }

  override _read(): void {
    this.#helper.stdout.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.#helper.stdin.write(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.#helper.stdin.end(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#helper.stdin.destroy();
    this.#helper.stdout.destroy();
    callback(error);
  }
}

// invariant: one helper for one run. Whatever ends the run (a refused start,
// a refused connection, or the channel's close), the helper's tree is
// terminated once and the per-run directory is removed (SSI-75).
class PipeHelperRun {
  readonly #host: WindowsPipeHost;
  readonly #directory: string;
  readonly #accept: (connection: Duplex) => void;
  readonly #helper: PipeHelperProcess;
  readonly #exited: Promise<void>;
  readonly #ended: Promise<void>;
  readonly #exitWaitMs: number;
  #gone = false;
  #starting: ((refusal?: WindowsPipeTransportError) => void) | undefined;
  #connection: HelperConnection | undefined;
  #termination: Promise<void> | undefined;
  #closing: Promise<void> | undefined;

  constructor(
    host: WindowsPipeHost,
    directory: string,
    accept: (connection: Duplex) => void,
    helper: PipeHelperProcess,
    exitWaitMs: number
  ) {
    this.#host = host;
    this.#directory = directory;
    this.#accept = accept;
    this.#helper = helper;
    this.#exitWaitMs = exitWaitMs;
    for (const stream of [helper.stdin, helper.stdout, helper.stderr]) stream.on("error", () => undefined);
    this.#exited = new Promise((resolve) => {
      helper.on("exit", () => {
        this.#gone = true;
        resolve();
      });
      helper.on("error", () => resolve());
    });
    this.#ended = new Promise((resolve) => {
      helper.on("close", () => resolve());
      helper.on("error", () => resolve());
    });
    readStatusLines(helper.stderr, (line) => this.#status(line));
  }

  started(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.#starting?.(
            new WindowsPipeTransportError("VES_BRIDGE_CHANNEL_FAILED", "The pipe helper did not listen in time")
          ),
        timeoutMs
      );
      this.#starting = (refusal) => {
        clearTimeout(timer);
        this.#starting = undefined;
        if (refusal === undefined) resolve();
        else reject(refusal);
      };
      this.#helper.on("error", () =>
        this.#starting?.(notConfigured("powershell-7", "PowerShell 7 could not be started"))
      );
      void this.#ended.then(() => this.#starting?.(helperRefusal(undefined)));
    });
  }

  close(): Promise<void> {
    return (this.#closing ??= this.#shutdown());
  }

  #status(line: string): void {
    if (line === LISTENING) this.#starting?.();
    else if (line === CONNECTED) this.#connect();
    else if (isHelperRefusal(line)) this.#starting?.(helperRefusal(line));
  }

  // why: the controller refuses a connection by destroying it, and the pipe
  // client sees that refusal only when the helper holding the pipe ends.
  #connect(): void {
    if (this.#connection !== undefined || this.#closing !== undefined) return;
    const connection = new HelperConnection(this.#helper);
    this.#connection = connection;
    connection.once("close", () => void this.#terminate());
    this.#accept(connection);
  }

  #terminate(): Promise<void> {
    this.#termination ??= this.#endHelper();
    return this.#termination;
  }

  // invariant: SSI-75. However the channel ends (a refused client, a client
  // that left, or the channel's close), the helper that holds the pipe ends
  // within a bound, so the pipe's server end closes and its client sees it.
  // Its tree is terminated, and a helper still running once that is done or
  // its bound has passed is killed through its own handle: the tree
  // terminator's outcome is not trusted alone.
  // hazard: a helper that has exited may have its pid reused, so its tree is
  // terminated only while it is known to be running.
  async #endHelper(): Promise<void> {
    const pid = this.#helper.pid;
    if (pid === undefined || this.#gone) return;
    await settlesWithin(
      this.#host.terminateTree(pid).catch(() => undefined),
      this.#exitWaitMs
    );
    if (await settlesWithin(this.#exited, this.#exitWaitMs)) return;
    this.#helper.kill("SIGKILL");
    await settlesWithin(this.#exited, this.#exitWaitMs);
  }

  async #shutdown(): Promise<void> {
    this.#connection?.destroy();
    this.#helper.stdin.destroy();
    await this.#terminate();
    await settlesWithin(this.#ended, this.#exitWaitMs);
    await rm(this.#directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export interface WindowsNamedPipeTransportOptions {
  // invariant: the parent of the per-run directory; the OS temp dir by default.
  readonly root?: string;
  readonly host?: WindowsPipeHost;
  readonly pipeName?: () => string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly startupTimeoutMs?: number;
  readonly exitWaitMs?: number;
}

// invariant: satisfies agent-runtime's BridgeTransport by shape; the
// composition root, which may import both packages, hands it to the bridge.
export class WindowsNamedPipeBridgeTransport {
  readonly #root: string | undefined;
  readonly #host: WindowsPipeHost;
  readonly #pipeName: () => string;
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #startupTimeoutMs: number;
  readonly #exitWaitMs: number;

  constructor(options: WindowsNamedPipeTransportOptions = {}) {
    this.#root = options.root;
    this.#host = options.host ?? nodeWindowsPipeHost;
    this.#pipeName = options.pipeName ?? (() => freshPipeName());
    this.#environment = options.environment ?? process.env;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.#exitWaitMs = options.exitWaitMs ?? EXIT_WAIT_MS;
  }

  async listen(accept: (connection: Duplex) => void): Promise<{ readonly endpoint: string; close(): Promise<void> }> {
    if (this.#host.platform !== "win32")
      throw new WindowsPipeTransportError(
        "VES_BRIDGE_PLATFORM_UNSUPPORTED",
        "The named-pipe bridge transport runs only on Windows"
      );
    if (!(await this.#host.powershellInstalled(POWERSHELL_7_EXECUTABLE)))
      throw notConfigured("powershell-7", "PowerShell 7 is not installed at its pinned path");
    const name = this.#pipeName();
    assertPipeName(name);
    const directory = await mkdtemp(join(this.#root ?? tmpdir(), "vpipe-"));
    let run: PipeHelperRun | undefined;
    try {
      if (!(await this.#host.secureDirectory(directory)).proven)
        throw notConfigured("owner-only-acl", "The per-run directory could not be proven owner-only");
      const script = join(directory, HELPER_SCRIPT_FILE);
      await writeFile(script, PIPE_HELPER_SCRIPT, { flag: "wx", mode: 0o600 });
      const helper = this.#host.startHelper(POWERSHELL_7_EXECUTABLE, helperArguments(script, name), {
        cwd: directory,
        env: helperEnvironment(this.#environment)
      });
      const started = new PipeHelperRun(this.#host, directory, accept, helper, this.#exitWaitMs);
      run = started;
      await started.started(this.#startupTimeoutMs);
      return Object.freeze({ endpoint: pipeEndpoint(name), close: () => started.close() });
    } catch (error) {
      await (run?.close() ?? rm(directory, { recursive: true, force: true }));
      throw error;
    }
  }
}
