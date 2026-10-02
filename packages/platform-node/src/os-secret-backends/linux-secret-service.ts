// invariant: the Linux credential backend drives the Secret Service (#379,
// AD-041). The value crosses the process boundary only on `secret-tool`'s
// stdin (store) or captured stdout (read), and never in any argv or
// environment. Presence is the Secret Service's own attribute search
// (SearchItems, through `dbus-send`), which returns item paths and never a
// secret, and which alone tells a locked item apart from a missing one.
import { statSync } from "node:fs";
import { join } from "node:path";

import type { OsSecretBackend, OsSecretLocator } from "../secret-broker.ts";
import {
  type CredentialProvisioner,
  type CredentialToolResult,
  type CredentialToolRunner,
  PRESENCE_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  assertLocator,
  assertStorable,
  backendFailure,
  interactionRequired,
  pickEnvironment,
  runBounded,
  spawnCredentialTool,
  storeUnavailable
} from "./credential-tool.ts";
import type { PlatformSecurityError } from "../platform-security-errors.ts";

// why: fixed paths, never a PATH lookup, so an ambient PATH entry cannot
// substitute a program that receives the credential or answers for the store.
export const SECRET_TOOL_EXECUTABLE = "/usr/bin/secret-tool";
export const DBUS_SEND_EXECUTABLE = "/usr/bin/dbus-send";

const LINUX_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  "secret-tool": SECRET_TOOL_EXECUTABLE,
  "dbus-send": DBUS_SEND_EXECUTABLE
});

export const SECRET_TOOL_LABEL_PREFIX = "Verchestra credential";

export function secretToolChildEnvironment(): NodeJS.ProcessEnv {
  // invariant: only what `secret-tool` and `dbus-send` need to reach the
  // invoking user's session bus. DISPLAY is withheld on purpose: without a bus, libdbus would
  // otherwise autolaunch a new one through X11 instead of failing.
  // LC_ALL=C keeps the tool's diagnostics in the wording classified below.
  return pickEnvironment(["HOME", "USER", "LOGNAME", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"], {
    PATH: "/usr/bin:/bin",
    LC_ALL: "C"
  });
}

// invariant: runs `secret-tool` unless the invocation names `dbus-send`; any
// other tool name is refused before anything is spawned.
export const nodeSecretServiceRunner: CredentialToolRunner = (invocation) => {
  const executable = LINUX_TOOLS[invocation.tool ?? "secret-tool"];
  if (executable === undefined) return Promise.reject(new Error("unknown Secret Service tool"));
  return spawnCredentialTool(executable, secretToolChildEnvironment)(invocation);
};

// why: measured on the real tools (docs/qualification/os-secret-backend-linux.md).
// A `secret-tool` lookup or clear that matches nothing exits 1 and prints
// nothing; every real error exits 1 too, but always names itself on stderr.
// The wording below is the tools' own (LC_ALL=C), and it only selects an
// error code: no stderr text ever reaches an error.
const NO_SESSION_BUS =
  /autolaunch|Could not connect|Failed to connect|Failed to open connection|No such file or directory|was not provided by any \.service files|ServiceUnknown|Error spawning command line/iu;
const WAITING_FOR_A_PERSON = /locked|prompt|dismiss|cancel/iu;
const SEARCH_ITEMS = "org.freedesktop.Secret.Service.SearchItems";
const OBJECT_PATH = /object path "\/org\/freedesktop\/secrets\/[^"\n]*"/gu;

interface SearchResult {
  readonly unlocked: number;
  readonly locked: number;
}

// invariant: SearchItems replies with two arrays of item paths, unlocked then
// locked, and nothing else; a reply of any other shape is a failure.
function parseSearch(stdout: string): SearchResult | undefined {
  if (!stdout.startsWith("method return ")) return undefined;
  const arrays = stdout.split(/^ *array \[/mu).slice(1);
  if (arrays.length !== 2) return undefined;
  const count = (text: string) => text.match(OBJECT_PATH)?.length ?? 0;
  return { unlocked: count(arrays[0] ?? ""), locked: count(arrays[1] ?? "") };
}

function classify(result: CredentialToolResult, operation: string): PlatformSecurityError {
  if (NO_SESSION_BUS.test(result.stderr)) return storeUnavailable();
  if (WAITING_FOR_A_PERSON.test(result.stderr)) return interactionRequired();
  return backendFailure(`Secret Service ${operation} failed`, result.exitCode);
}

function isNotFound(result: CredentialToolResult): boolean {
  return result.exitCode === 1 && result.stderr.trim() === "";
}

function attributes(locator: Readonly<OsSecretLocator>): string[] {
  return ["service", locator.namespace, "account", locator.logicalName];
}

export function searchItemsArguments(locator: Readonly<OsSecretLocator>): string[] {
  return [
    "--session",
    "--print-reply",
    "--dest=org.freedesktop.secrets",
    "/org/freedesktop/secrets",
    SEARCH_ITEMS,
    `dict:string:string:${attributes(locator).join(",")}`
  ];
}

// why: without a session bus address or the per-user bus socket, libdbus has no
// session to reach, and the tools then fail with wording that varies by
// distribution. Deciding "not available here" before any spawn keeps that
// outcome deterministic instead of depending on stderr text.
export function sessionBusReachable(environment: NodeJS.ProcessEnv = process.env): boolean {
  if ((environment["DBUS_SESSION_BUS_ADDRESS"] ?? "") !== "") return true;
  const runtime = environment["XDG_RUNTIME_DIR"] ?? "";
  if (runtime === "") return false;
  try {
    return statSync(join(runtime, "bus")).isSocket();
  } catch {
    return false;
  }
}

export class LinuxSecretServiceBackend implements OsSecretBackend, CredentialProvisioner {
  readonly #runner: CredentialToolRunner;
  readonly #busReachable: () => boolean;

  constructor(options: { readonly runner?: CredentialToolRunner; readonly sessionBusReachable?: () => boolean } = {}) {
    this.#runner = options.runner ?? nodeSecretServiceRunner;
    this.#busReachable =
      options.sessionBusReachable ?? (options.runner === undefined ? () => sessionBusReachable() : () => true);
  }

  #requireSessionBus(): void {
    if (!this.#busReachable()) throw storeUnavailable();
  }

  async #search(locator: Readonly<OsSecretLocator>): Promise<SearchResult> {
    const result = await runBounded(this.#runner, {
      tool: "dbus-send",
      args: searchItemsArguments(locator),
      timeoutMs: PRESENCE_TIMEOUT_MS
    });
    if (result.exitCode !== 0) throw classify(result, "presence search");
    const found = parseSearch(result.stdout);
    if (found === undefined) throw backendFailure("Secret Service returned an unrecognized search reply");
    return found;
  }

  // invariant: an item that exists only in a locked collection is neither
  // present nor absent; it needs the user to unlock the keyring.
  async has(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    this.#requireSessionBus();
    const { unlocked, locked } = await this.#search(locator);
    if (unlocked > 0) return true;
    if (locked > 0) throw interactionRequired();
    return false;
  }

  async read(locator: Readonly<OsSecretLocator>): Promise<Uint8Array | undefined> {
    assertLocator(locator);
    this.#requireSessionBus();
    const result = await runBounded(this.#runner, {
      args: ["lookup", ...attributes(locator)],
      timeoutMs: READ_TIMEOUT_MS
    });
    if (result.exitCode === 0) {
      // invariant: `secret-tool` appends a newline only when stdout is a
      // terminal; through a pipe the stdout bytes are exactly the value.
      return Uint8Array.from(Buffer.from(result.stdout, "utf8"));
    }
    if (!isNotFound(result)) throw classify(result, "read");
    // hazard: a lookup whose unlock prompt cannot be shown (no prompter in
    // this session) reports a locked item exactly like a missing one, so a
    // miss is confirmed by an attribute search before it is called absent.
    if (await this.has(locator)) throw backendFailure("Secret Service lookup missed an unlocked item");
    return undefined;
  }

  // why: `secret-tool store` replaces the item whose attributes match, so a
  // rotation is one call and never leaves the credential absent.
  async store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void> {
    assertStorable(locator, value);
    this.#requireSessionBus();
    const stdin = Buffer.from(value);
    try {
      const result = await runBounded(this.#runner, {
        args: [
          "store",
          `--label=${SECRET_TOOL_LABEL_PREFIX} ${locator.namespace}/${locator.logicalName}`,
          ...attributes(locator)
        ],
        stdin,
        timeoutMs: WRITE_TIMEOUT_MS
      });
      if (result.exitCode !== 0) throw classify(result, "write");
    } finally {
      stdin.fill(0);
    }
    if (!(await this.has(locator))) throw backendFailure("Secret Service write did not land in the default collection");
  }

  // why: `secret-tool clear` exits 1 silently when nothing matched, exactly
  // like a lookup miss, so the reported outcome comes from presence before
  // and after, never from its exit status alone.
  async delete(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    if (!(await this.has(locator))) return false;
    const result = await runBounded(this.#runner, {
      args: ["clear", ...attributes(locator)],
      timeoutMs: WRITE_TIMEOUT_MS
    });
    if (result.exitCode !== 0 && !isNotFound(result)) throw classify(result, "delete");
    if (await this.has(locator)) throw backendFailure("Secret Service delete left the item in place");
    return true;
  }
}
