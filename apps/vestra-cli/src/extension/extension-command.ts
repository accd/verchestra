// why: the only entry point main.ts loads for `vestra extension`, always
// through a dynamic import, so no other command loads the skill registry or
// the probe host's admission.
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

import type { CliCommand, CommandResult } from "@verchestra/application";

import { cliError } from "../cli-errors.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "../task/task-credentials.ts";
import type { TaskCommandIo, TaskConfirmationInput } from "../task/task-io.ts";
import { workspaceSigner } from "../task/task-signing.ts";
import { openTaskWorkspace, requireWorkspaceStateContained } from "../task/task-workspace.ts";
import { addExtension } from "./extension-add.ts";
import { APPROVAL_REF } from "./extension-approval-store.ts";
import { approveExtension } from "./extension-approve.ts";
import { checkExtension } from "./extension-check.ts";
import { extensionPublicError } from "./extension-errors.ts";
import { approvalStore } from "./extension-workspace.ts";
import { EXTENSION_LICENSES } from "./skill-lock-file.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_APPROVAL_DAYS = 365;
// invariant: the shapes the registry and admission accept, refused here as
// arguments (exit 2) before anything is read.
const SKILL_ID = /^[a-z0-9][a-z0-9._:@/+-]{0,255}$/u;
const EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const ENVIRONMENT = /^([^=]+)=(.*)$/su;

type Handler = (command: CliCommand, io: TaskCommandIo) => Promise<CommandResult>;

function invalid(option: string, message: string): never {
  throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${option}` }, message);
}

function required(command: CliCommand, option: string, pattern?: RegExp): string {
  const value = command.options[option];
  if (typeof value !== "string") invalid(option, `--${option} is required`);
  if (pattern !== undefined && !pattern.test(value)) invalid(option, `--${option} is malformed`);
  return value;
}

function repeated(command: CliCommand, option: string): readonly string[] {
  const value = command.options[option];
  return Array.isArray(value) ? value : [];
}

function extensionId(command: CliCommand): string {
  const value = required(command, "extension", EXTENSION_ID);
  // why: admission reserves this namespace for product workers.
  if (value.startsWith("probe-worker:")) invalid("extension", "--extension claims the product namespace");
  return value;
}

function license(command: CliCommand): string {
  const value = required(command, "license");
  if (!EXTENSION_LICENSES.includes(value))
    invalid("license", `--license must be one of ${EXTENSION_LICENSES.join(", ")}`);
  return value;
}

function environment(command: CliCommand): Readonly<Record<string, string>> {
  const pairs: Record<string, string> = {};
  for (const entry of repeated(command, "env")) {
    const match = ENVIRONMENT.exec(entry);
    if (match === null || Object.hasOwn(pairs, match[1] as string))
      invalid("env", "--env takes NAME=value, once per name");
    pairs[match[1] as string] = match[2] as string;
  }
  return Object.freeze(pairs);
}

// invariant: an approval expires at an instant after now and at most 365 days
// ahead (plan assumption); anything else is an argument error.
function expiresAt(command: CliCommand, now = Date.now()): string | undefined {
  const value = command.options["expires"];
  if (value === undefined) return undefined;
  const instant = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(instant)) invalid("expires", "--expires must be an ISO 8601 instant");
  if (instant <= now || instant > now + MAXIMUM_APPROVAL_DAYS * DAY_MS)
    invalid("expires", `--expires must be after now and at most ${MAXIMUM_APPROVAL_DAYS} days ahead`);
  return new Date(instant).toISOString();
}

function executable(command: CliCommand): string {
  const value = required(command, "executable");
  if (!isAbsolute(value)) invalid("executable", "--executable must be an absolute path");
  return value;
}

async function listExtensions(io: TaskCommandIo) {
  const workspace = await openTaskWorkspace(io, { ensure: false });
  await requireWorkspaceStateContained(workspace.layout);
  return { approvals: await approvalStore(workspace).list() };
}

async function revokeExtension(io: TaskCommandIo, approvalRef: string) {
  const workspace = await openTaskWorkspace(io);
  const store = approvalStore(workspace);
  // why: an unknown or already revoked reference is refused before any
  // credential is read, so nothing is unlocked to write nothing.
  await store.assertRevocable(approvalRef);
  const credentials = await readCredentials(
    {
      workspaceId: workspace.workspaceId,
      platform: io.platform,
      ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
    },
    [SIGNING_PASSPHRASE]
  );
  return store.revoke(approvalRef, await workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string));
}

const data = (value: unknown): CommandResult => ({ data: value, diagnostics: [] });

const HANDLERS: Readonly<Record<string, Handler>> = Object.freeze({
  "extension add": async (command, io) =>
    data(
      await addExtension(io, {
        skillId: required(command, "skill", SKILL_ID),
        extensionId: extensionId(command),
        entry: required(command, "entry"),
        approvalRef: required(command, "approval-ref", APPROVAL_REF),
        version: required(command, "version", VERSION),
        license: license(command)
      })
    ),
  "extension approve": async (command, io) =>
    data(
      await approveExtension(io, {
        approvalRef: required(command, "approval-ref", APPROVAL_REF),
        executable: executable(command),
        args: repeated(command, "arg"),
        environment: environment(command),
        expiresAt: expiresAt(command),
        confirmStdin: command.options["confirm-stdin"] === true
      })
    ),
  "extension list": async (_command, io) => data(await listExtensions(io)),
  "extension revoke": async (command, io) =>
    data(await revokeExtension(io, required(command, "approval-ref", APPROVAL_REF))),
  "extension check": async (command, io) => checkExtension(io, required(command, "approval-ref", APPROVAL_REF))
});

export async function executeExtensionCommand(
  command: CliCommand,
  process_: {
    readonly controlRoot: string;
    readonly platform: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly stdin: TaskConfirmationInput;
    readonly stderr: (value: string) => void;
    readonly pid: number;
  }
): Promise<CommandResult> {
  const handler = HANDLERS[command.name];
  if (handler === undefined)
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: command.name }, "Extension command is not installed");
  const keychain = command.options["keychain"];
  const io: TaskCommandIo = {
    ...process_,
    homeDirectory: homedir(),
    ...(typeof keychain === "string" ? { keychainPath: keychain } : {})
  };
  try {
    return await handler(command, io);
  } catch (error) {
    throw extensionPublicError(error);
  }
}
