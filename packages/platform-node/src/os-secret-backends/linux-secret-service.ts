// invariant: the Linux credential backend drives the Secret Service through
// libsecret's `secret-tool` (#379, AD-041). The value crosses the process
// boundary only on the child's stdin (store) or captured stdout (read), and
// never in any argv or environment. Presence runs a lookup whose stdout is the
// null device, so the value never enters this process.
import type { OsSecretBackend, OsSecretLocator } from "../secret-broker.ts";
import {
  type CredentialToolResult,
  type CredentialToolRunner,
  assertLocator,
  backendFailure,
  interactionRequired,
  pickEnvironment,
  runBounded,
  spawnCredentialTool,
  storeUnavailable
} from "./credential-tool.ts";
import { PRESENCE_TIMEOUT_MS, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, isValidCredentialValue } from "./darwin-keychain.ts";
import { PlatformSecurityError } from "../platform-security-errors.ts";

// why: a fixed path, never a PATH lookup, so an ambient PATH entry cannot
// substitute the program that receives the credential.
export const SECRET_TOOL_EXECUTABLE = "/usr/bin/secret-tool";

export const SECRET_TOOL_LABEL_PREFIX = "Verchestra credential";

export function secretToolChildEnvironment(): NodeJS.ProcessEnv {
  // invariant: only what `secret-tool` needs to reach the invoking user's
  // session bus. DISPLAY is withheld on purpose: without a bus, libdbus would
  // otherwise autolaunch a new one through X11 instead of failing.
  // LC_ALL=C keeps the tool's diagnostics in the wording classified below.
  return pickEnvironment(["HOME", "USER", "LOGNAME", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"], {
    PATH: "/usr/bin:/bin",
    LC_ALL: "C"
  });
}

export const nodeSecretToolRunner: CredentialToolRunner = spawnCredentialTool(
  SECRET_TOOL_EXECUTABLE,
  secretToolChildEnvironment
);

// why: measured on libsecret's `secret-tool` (docs/qualification/os-secret-backend-linux.md).
// A lookup that matches nothing exits 1 and prints nothing; every real error
// exits 1 too, but always names itself on stderr. The wording below is the
// tool's own (LC_ALL=C), and it only selects an error code: no stderr text
// ever reaches an error.
const NO_SESSION_BUS =
  /Cannot autolaunch D-Bus|Could not connect|Failed to connect|No such file or directory|was not provided by any \.service files|ServiceUnknown|Error spawning command line|dbus-launch/u;
const WAITING_FOR_A_PERSON = /locked|prompt|dismiss|cancel/iu;

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

export class LinuxSecretServiceBackend implements OsSecretBackend {
  readonly #runner: CredentialToolRunner;

  constructor(options: { readonly runner?: CredentialToolRunner } = {}) {
    this.#runner = options.runner ?? nodeSecretToolRunner;
  }

  async has(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    const result = await runBounded(this.#runner, {
      args: ["lookup", ...attributes(locator)],
      timeoutMs: PRESENCE_TIMEOUT_MS,
      discardStdout: true
    });
    if (result.exitCode === 0) return true;
    if (isNotFound(result)) return false;
    throw classify(result, "presence lookup");
  }

  async read(locator: Readonly<OsSecretLocator>): Promise<Uint8Array | undefined> {
    assertLocator(locator);
    const result = await runBounded(this.#runner, {
      args: ["lookup", ...attributes(locator)],
      timeoutMs: READ_TIMEOUT_MS
    });
    if (isNotFound(result)) return undefined;
    if (result.exitCode !== 0) throw classify(result, "read");
    // invariant: `secret-tool` appends a newline only when stdout is a
    // terminal; through a pipe the stdout bytes are exactly the value.
    return Uint8Array.from(Buffer.from(result.stdout, "utf8"));
  }

  // why: `secret-tool store` replaces the item whose attributes match, so a
  // rotation is one call and never leaves the credential absent.
  async store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void> {
    if (!isValidCredentialValue(value)) {
      throw new PlatformSecurityError(
        "VES_SECRET_VALUE_INVALID",
        "Credential value is empty, oversize, or not printable"
      );
    }
    assertLocator(locator);
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

  // why: `secret-tool clear` exits 0 whether or not an item matched, so the
  // reported outcome comes from presence before and after, never from it.
  async delete(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    if (!(await this.has(locator))) return false;
    const result = await runBounded(this.#runner, {
      args: ["clear", ...attributes(locator)],
      timeoutMs: WRITE_TIMEOUT_MS
    });
    if (result.exitCode !== 0) throw classify(result, "delete");
    if (await this.has(locator)) throw backendFailure("Secret Service delete left the item in place");
    return true;
  }
}
