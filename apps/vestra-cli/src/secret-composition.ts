// why: the only place the CLI composes the OS credential store (#379). main.ts
// loads this module with a dynamic import, and it reaches platform-node only
// through the ./secrets subpath, so no other command pays for it and nothing
// here loads node:sqlite.
import type { CliCommand, CommandResult } from "@verchestra/application";
import { PublicErrorException } from "@verchestra/domain";
import {
  type CredentialToolRunner,
  MAX_CREDENTIAL_VALUE_BYTES,
  type OsCredentialStore,
  type SecretAdapter,
  createOsCredentialStore,
  isValidCredentialValue,
  isValidLogicalSecretName,
  platformSecurityPublicErrorRegistry
} from "@verchestra/platform-node/secrets";
import { initPublicErrorRegistry, readWorkspaceIdentity } from "@verchestra/workspace";

import { cliError, cliPublicErrorRegistry } from "./cli-errors.ts";

// invariant: the credential deep doctor observes is the one the governed task
// command injects for Claude Code (#405); both name it here.
export const DOCTOR_CREDENTIAL_NAME = "anthropic-api-key";

export interface SecretInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeAllListeners(): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface SecretCommandIo {
  readonly controlRoot: string;
  readonly platform: string;
  readonly stdin: SecretInput;
  readonly stderr: (value: string) => void;
  readonly runner?: CredentialToolRunner;
}

function publicError(error: unknown, command: string): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = (error as { readonly code?: unknown })?.code;
  for (const registry of [platformSecurityPublicErrorRegistry, initPublicErrorRegistry]) {
    if (typeof code === "string" && registry.codes.includes(code))
      return new PublicErrorException(registry.create(code, {}), "Credential command failed", { cause: error });
  }
  return new PublicErrorException(
    cliPublicErrorRegistry.create("VES_CLI_COMMAND_FAILED", { command }),
    "Credential command failed",
    { cause: error }
  );
}

function valueError(message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code: "VES_SECRET_VALUE_INVALID" });
}

type InputOutcome = "done" | "cancelled" | "overflow" | "unreadable";

const OUTCOME_MESSAGES: Readonly<Record<Exclude<InputOutcome, "done">, string>> = Object.freeze({
  cancelled: "Credential entry was cancelled",
  overflow: "Credential value exceeds the size limit",
  unreadable: "Credential input could not be read"
});

// invariant: the only buffer that ever holds the whole credential while it is
// being entered; every exit path zeroes it.
class CredentialCollector {
  readonly #buffer = Buffer.alloc(MAX_CREDENTIAL_VALUE_BYTES + 2);
  #length = 0;

  push(byte: number): boolean {
    if (this.#length >= this.#buffer.length) return false;
    this.#buffer[this.#length] = byte;
    this.#length += 1;
    return true;
  }

  erase(): void {
    if (this.#length === 0) return;
    this.#length -= 1;
    this.#buffer[this.#length] = 0;
  }

  // why: piped input conventionally ends in one newline (or CRLF), which is
  // not part of the credential; anything beyond that one is a policy error.
  take(stripTrailingNewline: boolean): Buffer {
    let end = this.#length;
    if (stripTrailingNewline && end > 0 && this.#buffer[end - 1] === 0x0a)
      end -= end > 1 && this.#buffer[end - 2] === 0x0d ? 2 : 1;
    const value = Buffer.from(this.#buffer.subarray(0, end));
    this.wipe();
    return value;
  }

  wipe(): void {
    this.#buffer.fill(0);
    this.#length = 0;
  }
}

function interactiveByte(collector: CredentialCollector, byte: number): InputOutcome | undefined {
  if (byte === 0x0d || byte === 0x0a) return "done";
  if (byte === 0x03) return "cancelled";
  if (byte === 0x7f || byte === 0x08) {
    collector.erase();
    return undefined;
  }
  return pipedByte(collector, byte);
}

function pipedByte(collector: CredentialCollector, byte: number): InputOutcome | undefined {
  return collector.push(byte) ? undefined : "overflow";
}

// hazard: the buffer this returns holds the credential; the caller zeroes it.
// Input stops at the first byte past the budget, so an oversize value is
// refused before any process is spawned and is never echoed anywhere.
export function readCredentialValue(io: SecretCommandIo, logicalName: string): Promise<Buffer> {
  const interactive = io.stdin.isTTY === true;
  if (interactive && typeof io.stdin.setRawMode !== "function")
    return Promise.reject(valueError("Hidden terminal input is unavailable"));
  const collector = new CredentialCollector();
  return new Promise<Buffer>((resolveValue, rejectValue) => {
    let settled = false;
    const settle = (outcome: InputOutcome) => {
      if (settled) return;
      settled = true;
      io.stdin.removeAllListeners();
      io.stdin.pause();
      if (interactive) {
        io.stdin.setRawMode?.(false);
        io.stderr("\n");
      }
      if (outcome !== "done") {
        collector.wipe();
        rejectValue(valueError(OUTCOME_MESSAGES[outcome]));
        return;
      }
      const value = collector.take(!interactive);
      if (isValidCredentialValue(value)) return resolveValue(value);
      value.fill(0);
      rejectValue(valueError("Credential value is empty, oversize, or not printable"));
    };
    io.stdin.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        const outcome = interactive ? interactiveByte(collector, byte) : pipedByte(collector, byte);
        if (outcome !== undefined) {
          settle(outcome);
          break;
        }
      }
      chunk.fill(0);
    });
    io.stdin.on("end", () => settle("done"));
    io.stdin.on("close", () => settle("done"));
    io.stdin.on("error", () => settle("unreadable"));
    if (interactive) {
      io.stderr(`Enter the value for ${logicalName} (input is hidden): `);
      io.stdin.setRawMode?.(true);
    }
    io.stdin.resume();
  });
}

function requiredName(command: CliCommand): string {
  const name = command.options["name"];
  if (!isValidLogicalSecretName(name))
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: "--name" }, "Logical credential name is invalid");
  return name;
}

function keychainOption(command: CliCommand): string | undefined {
  const keychain = command.options["keychain"];
  return typeof keychain === "string" ? keychain : undefined;
}

function openStore(io: SecretCommandIo, keychainPath: string | undefined): OsCredentialStore {
  return createOsCredentialStore({
    platform: io.platform,
    ...(keychainPath === undefined ? {} : { keychainPath }),
    ...(io.runner === undefined ? {} : { runner: io.runner })
  });
}

export async function executeSecretCommand(command: CliCommand, io: SecretCommandIo): Promise<CommandResult> {
  try {
    const logicalName = requiredName(command);
    const identity = await readWorkspaceIdentity(io.controlRoot);
    if (identity === undefined) {
      throw new PublicErrorException(
        initPublicErrorRegistry.create("VES_INIT_WORKSPACE_MISSING", {}),
        "No Workspace is initialized in this directory"
      );
    }
    const store = openStore(io, keychainOption(command));
    await store.verify();
    const base = {
      workspaceId: identity.workspaceId,
      logicalName,
      store: store.storeId,
      keychain: store.keychain
    };
    if (command.name === "secret set") {
      const value = await readCredentialValue(io, logicalName);
      try {
        await store.store(identity.workspaceId, logicalName, value);
      } finally {
        value.fill(0);
      }
      return { data: { ...base, stored: true }, diagnostics: [] };
    }
    if (command.name === "secret status") {
      return {
        data: { ...base, present: await store.adapter.has(identity.workspaceId, logicalName) },
        diagnostics: []
      };
    }
    if (command.name === "secret delete") {
      return { data: { ...base, deleted: await store.delete(identity.workspaceId, logicalName) }, diagnostics: [] };
    }
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: command.name }, "Credential command is not installed");
  } catch (error) {
    throw publicError(error, command.name);
  }
}

export interface DoctorSecretProbe {
  readonly workspaceId?: string;
  readonly secret?: { readonly logicalName: string; readonly adapter: Pick<SecretAdapter, "has"> };
}

// why: deep doctor gets a presence closure, never the adapter, so `read` is
// structurally unreachable from the diagnostic. An uninitialized or unreadable
// Workspace, or a platform without a qualified credential store, leaves the
// port unset and the check honestly blocked. A qualified store that is not
// running in this session (no Secret Service on the bus, no Credential
// Manager for this logon) is "not configured" too, so it also reads as
// blocked; a store that is present but cannot answer stays a failure.
export async function composeDoctorSecretProbe(options: {
  readonly controlRoot: string;
  readonly platform: string;
  readonly keychainPath?: string;
  readonly runner?: CredentialToolRunner;
}): Promise<DoctorSecretProbe> {
  const identity = await readWorkspaceIdentity(options.controlRoot).catch(() => undefined);
  if (identity === undefined) return {};
  let store: OsCredentialStore;
  try {
    store = createOsCredentialStore(options);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "VES_SECRET_STORE_UNQUALIFIED") return {};
    throw error;
  }
  const adapter = store.adapter;
  return Object.freeze({
    workspaceId: identity.workspaceId,
    secret: Object.freeze({
      logicalName: DOCTOR_CREDENTIAL_NAME,
      adapter: Object.freeze({
        has: async (workspaceId: string, logicalName: string) => {
          try {
            return await adapter.has(workspaceId, logicalName);
          } catch (error) {
            if ((error as { readonly code?: unknown }).code === "VES_SECRET_STORE_UNAVAILABLE") return false;
            throw error;
          }
        }
      })
    })
  });
}
