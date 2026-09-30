// invariant: the Windows credential backend stores a generic credential in
// the invoking user's Credential Manager through Windows PowerShell and a
// small inline P/Invoke of advapi32 CredReadW, CredWriteW, and CredDeleteW
// (#379, AD-041). The program reaches PowerShell on stdin; the value reaches
// it on stdin too, as one base64 data line the program consumes as data, so it
// is never parsed as script, never in argv, and never in the environment.
import { PlatformSecurityError } from "../platform-security-errors.ts";
import type { OsSecretBackend, OsSecretLocator } from "../secret-broker.ts";
import {
  type CredentialToolResult,
  type CredentialToolRunner,
  assertLocator,
  backendFailure,
  pickEnvironment,
  runBounded,
  spawnCredentialTool,
  storeUnavailable
} from "./credential-tool.ts";
import { PRESENCE_TIMEOUT_MS, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, isValidCredentialValue } from "./darwin-keychain.ts";

export const POWERSHELL_ARGUMENTS = Object.freeze([
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "-"
]);

const WINDOWS_ROOT = /^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]*$/u;

function systemRoot(): string {
  const root = process.env["SystemRoot"];
  return typeof root === "string" && WINDOWS_ROOT.test(root) ? root.replace(/\\+$/u, "") : "C:\\Windows";
}

// why: an absolute path under the system root, never a PATH lookup, so an
// ambient PATH entry cannot substitute the program that receives the value.
export function powershellExecutable(): string {
  return `${systemRoot()}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export function powershellChildEnvironment(): NodeJS.ProcessEnv {
  // invariant: the profile and temporary directories Windows PowerShell and
  // Add-Type need, the variables that locate the user's Credential Manager,
  // and a fixed PATH; never an ambient credential.
  const root = systemRoot();
  return pickEnvironment(
    [
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
    ],
    {
      SystemRoot: root,
      windir: root,
      PATH: `${root}\\System32;${root};${root}\\System32\\WindowsPowerShell\\v1.0`
    }
  );
}

export const nodePowerShellRunner: CredentialToolRunner = (invocation) =>
  spawnCredentialTool(powershellExecutable(), powershellChildEnvironment)(invocation);

// why: CRED_PERSIST_LOCAL_MACHINE keeps the credential for this user on this
// machine across logon sessions. CRED_PERSIST_ENTERPRISE would also copy it
// into a roaming profile, which moves a local provider key to other machines
// and profile servers the user never chose.
export const CREDENTIAL_PERSISTENCE = "CRED_PERSIST_LOCAL_MACHINE";

// invariant: one line of C#, because `powershell -Command -` runs stdin one
// line at a time and a statement split over lines would need a blank line to
// end it. No single quote appears in it, so it sits inside a PowerShell
// single-quoted string unchanged. Every buffer that held the value is zeroed
// before it is freed; .NET strings cannot be, and the base64 line is one.
const CREDENTIAL_MANAGER_SOURCE = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class VerchestraCredentialManager {",
  "[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
  "private struct Credential { public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;",
  "public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize;",
  "public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes;",
  "public IntPtr TargetAlias; public IntPtr UserName; }",
  '[DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]',
  "private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);",
  '[DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]',
  "private static extern bool CredWrite(ref Credential credential, uint flags);",
  '[DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]',
  "private static extern bool CredDelete(string target, uint type, uint flags);",
  '[DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);',
  "private const uint Generic = 1; private const uint PersistLocalMachine = 2; private const int NotFound = 1168;",
  'private const string Marker = "verchestra-credential:";',
  "private static string Failure() { int code = Marshal.GetLastWin32Error();",
  'return code == NotFound ? Marker + "absent" : Marker + "error:" + code; }',
  "private static void Wipe(IntPtr blob, int size) { if (blob != IntPtr.Zero && size > 0) Marshal.Copy(new byte[size], 0, blob, size); }",
  "public static string Has(string target) { IntPtr pointer; if (!CredRead(target, Generic, 0, out pointer)) return Failure();",
  "try { Credential found = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));",
  "Wipe(found.CredentialBlob, (int)found.CredentialBlobSize); } finally { CredFree(pointer); }",
  'return Marker + "present"; }',
  "public static string Read(string target) { IntPtr pointer; if (!CredRead(target, Generic, 0, out pointer)) return Failure();",
  "byte[] value = new byte[0]; try { Credential found = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));",
  "value = new byte[found.CredentialBlobSize]; if (value.Length > 0) Marshal.Copy(found.CredentialBlob, value, 0, value.Length);",
  "Wipe(found.CredentialBlob, value.Length);",
  'return Marker + "value:" + Convert.ToBase64String(value); } finally { Array.Clear(value, 0, value.Length); CredFree(pointer); } }',
  'public static string Write(string target, string user, string line) { if (line == null || !line.StartsWith("#")) return Marker + "error:payload";',
  "byte[] value = Convert.FromBase64String(line.Substring(1)); IntPtr blob = Marshal.AllocHGlobal(Math.Max(value.Length, 1));",
  "IntPtr targetName = Marshal.StringToHGlobalUni(target); IntPtr userName = Marshal.StringToHGlobalUni(user);",
  "try { Marshal.Copy(value, 0, blob, value.Length); Credential credential = new Credential(); credential.Type = Generic;",
  "credential.TargetName = targetName; credential.UserName = userName; credential.CredentialBlobSize = (uint)value.Length;",
  "credential.CredentialBlob = blob; credential.Persist = PersistLocalMachine;",
  'if (!CredWrite(ref credential, 0)) return Marker + "error:" + Marshal.GetLastWin32Error(); return Marker + "stored"; }',
  "finally { Wipe(blob, value.Length); Array.Clear(value, 0, value.Length); Marshal.FreeHGlobal(blob);",
  "Marshal.FreeHGlobal(targetName); Marshal.FreeHGlobal(userName); } }",
  'public static string Delete(string target) { if (!CredDelete(target, Generic, 0)) return Failure(); return Marker + "deleted"; }',
  "}"
].join(" ");

const TARGET = /^verchestra\/workspace_[0-9a-f-]{36}\/[a-z][a-z0-9.-]{0,126}[a-z0-9]$/u;

export function credentialTarget(locator: Readonly<OsSecretLocator>): string {
  const target = `${locator.namespace}/${locator.logicalName}`;
  // invariant: the target is spliced into a single-quoted PowerShell literal,
  // so it must be exactly the canonical binding and hold no quote.
  if (!TARGET.test(target))
    throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", "Credential locator is not a canonical binding");
  return target;
}

type Operation = "Has" | "Read" | "Write" | "Delete";

const PREAMBLE = [
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
  `Add-Type -TypeDefinition '${CREDENTIAL_MANAGER_SOURCE}'`
];

export function credentialProgram(operation: Operation, locator: Readonly<OsSecretLocator>): string {
  const target = credentialTarget(locator);
  const call =
    operation === "Write"
      ? `[VerchestraCredentialManager]::Write('${target}', '${locator.logicalName}', $verchestraPayload)`
      : `[VerchestraCredentialManager]::${operation}('${target}')`;
  return [...PREAMBLE, `[Console]::Out.WriteLine(${call})`, "exit 0", ""].join("\n");
}

// invariant: the value line sits between the statement that reads it and the
// call that consumes it, and starts with `#`. Should PowerShell ever read that
// line as script instead of handing it to ReadLine, it is a comment: nothing
// runs, nothing is echoed, and the write fails closed on a missing payload.
function writeInput(locator: Readonly<OsSecretLocator>, value: Uint8Array): Buffer {
  const target = credentialTarget(locator);
  const head = Buffer.from([...PREAMBLE, "$verchestraPayload = [Console]::In.ReadLine()", "#"].join("\n"), "latin1");
  const encoded = Buffer.from(Buffer.from(value).toString("base64"), "latin1");
  const tail = Buffer.from(
    [
      "",
      `[Console]::Out.WriteLine([VerchestraCredentialManager]::Write('${target}', '${locator.logicalName}', $verchestraPayload))`,
      "$verchestraPayload = $null",
      "exit 0",
      ""
    ].join("\n"),
    "latin1"
  );
  const input = Buffer.concat([head, encoded, tail]);
  encoded.fill(0);
  return input;
}

const RESULT = /^verchestra-credential:(present|absent|stored|deleted|value:([A-Za-z0-9+/]*={0,2})|error:(\w+))\r?$/mu;

// why: Win32 errors that mean "no Credential Manager for this logon", such as
// a network or service logon without a loaded profile, not a broken store.
const NO_CREDENTIAL_SESSION = new Set(["1312", "1004"]);

interface Outcome {
  readonly status: string;
  readonly value?: Uint8Array;
}

function outcome(result: CredentialToolResult, operation: Operation): Outcome {
  const match = result.exitCode === 0 ? RESULT.exec(result.stdout) : null;
  if (match === null) throw backendFailure(`Credential Manager ${operation.toLowerCase()} failed`, result.exitCode);
  const [, status = "", encoded, error] = match;
  if (error !== undefined) {
    if (NO_CREDENTIAL_SESSION.has(error)) throw storeUnavailable();
    throw backendFailure(`Credential Manager ${operation.toLowerCase()} failed`, result.exitCode);
  }
  if (encoded !== undefined) return { status: "value", value: Uint8Array.from(Buffer.from(encoded, "base64")) };
  return { status };
}

function unexpected(operation: Operation): PlatformSecurityError {
  return backendFailure(`Credential Manager ${operation.toLowerCase()} returned an unexpected result`);
}

export class WindowsCredentialManagerBackend implements OsSecretBackend {
  readonly #runner: CredentialToolRunner;

  constructor(options: { readonly runner?: CredentialToolRunner } = {}) {
    this.#runner = options.runner ?? nodePowerShellRunner;
  }

  async #run(operation: Operation, stdin: Uint8Array, timeoutMs: number): Promise<Outcome> {
    const result = await runBounded(this.#runner, { args: POWERSHELL_ARGUMENTS, stdin, timeoutMs });
    return outcome(result, operation);
  }

  async has(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    const { status } = await this.#run("Has", Buffer.from(credentialProgram("Has", locator)), PRESENCE_TIMEOUT_MS);
    if (status === "present") return true;
    if (status === "absent") return false;
    throw unexpected("Has");
  }

  async read(locator: Readonly<OsSecretLocator>): Promise<Uint8Array | undefined> {
    assertLocator(locator);
    const { status, value } = await this.#run("Read", Buffer.from(credentialProgram("Read", locator)), READ_TIMEOUT_MS);
    if (status === "absent") return undefined;
    if (status === "value" && value !== undefined) return value;
    throw unexpected("Read");
  }

  // why: CredWriteW replaces a credential with the same target and type, so
  // a rotation is one call and never leaves the credential absent.
  async store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void> {
    if (!isValidCredentialValue(value)) {
      throw new PlatformSecurityError(
        "VES_SECRET_VALUE_INVALID",
        "Credential value is empty, oversize, or not printable"
      );
    }
    assertLocator(locator);
    const stdin = writeInput(locator, value);
    let status: string;
    try {
      ({ status } = await this.#run("Write", stdin, WRITE_TIMEOUT_MS));
    } finally {
      stdin.fill(0);
    }
    if (status !== "stored") throw unexpected("Write");
    if (!(await this.has(locator))) throw backendFailure("Credential Manager write did not persist");
  }

  async delete(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    const { status } = await this.#run("Delete", Buffer.from(credentialProgram("Delete", locator)), WRITE_TIMEOUT_MS);
    if (status === "deleted") return true;
    if (status === "absent") return false;
    throw unexpected("Delete");
  }
}
