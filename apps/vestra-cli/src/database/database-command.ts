// why: the only entry point main.ts loads for `vestra database`, always
// through a dynamic import, so no other command loads data-probe.
import type { CliCommand, CommandResult } from "@verchestra/application";

import { cliError } from "../cli-errors.ts";
import { SIGNING_PASSPHRASE, readCredentials } from "../task/task-credentials.ts";
import {
  executeTaskFamilyCommand,
  type TaskFamily,
  type TaskFamilyHandler,
  type TaskFamilyProcess
} from "../task/task-dispatch.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { workspaceSigner, workspaceTrustRoot } from "../task/task-signing.ts";
import { openTaskWorkspace, type TaskWorkspace } from "../task/task-workspace.ts";
import { readDefinition, registrationDocument } from "./database-definition.ts";
import { databasePublicError } from "./database-errors.ts";
import {
  DATABASE_ID,
  DatabaseRegistrationFiles,
  type DatabaseRegistrationEntry
} from "./database-registration-file.ts";

// invariant: an option a command needs is refused as an argument (exit 2),
// naming the option, before anything is read.
function required(command: CliCommand, option: string, pattern?: RegExp): string {
  const value = command.options[option];
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value)))
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${option}` }, `--${option} is missing or malformed`);
  return value;
}

// invariant: door 1. Registrations live in the Workspace's repository and
// verify against the pinned anchor of its evidence key; with no anchor there
// is nothing to verify against, so no registration verifies.
function registrationFiles(workspace: TaskWorkspace): DatabaseRegistrationFiles {
  return new DatabaseRegistrationFiles({
    repositoryRoot: workspace.repositoryRoot,
    workspaceId: workspace.workspaceId,
    trust: () => workspaceTrustRoot(workspace).catch(() => undefined)
  });
}

async function unlockedSigner(io: TaskCommandIo, workspace: TaskWorkspace) {
  const keychain = io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath };
  const source = { workspaceId: workspace.workspaceId, platform: io.platform, ...keychain };
  const credentials = await readCredentials(source, [SIGNING_PASSPHRASE]);
  return workspaceSigner(workspace, credentials.get(SIGNING_PASSPHRASE) as string);
}

// invariant: AC 1 to AC 8. The definition is read and validated, and the
// record on file for its id compared, before the signing passphrase is read,
// so a refused definition reads no credential; nothing is written unless the
// exclusive create succeeds.
async function addDatabase(io: TaskCommandIo, definitionPath: string) {
  const definition = await readDefinition(io.controlRoot, definitionPath);
  const workspace = await openTaskWorkspace(io);
  const document = registrationDocument(definition, workspace.workspaceId, new Date().toISOString());
  const files = registrationFiles(workspace);
  const receipt =
    (await files.existing(document)) ?? (await files.create(document, await unlockedSigner(io, workspace)));
  const { databaseId, registrationDigest } = document.registration;
  return { databaseId, registrationDigest, created: receipt.created };
}

function listing(entry: DatabaseRegistrationEntry) {
  const registration = entry.document?.registration;
  if (registration === undefined) return { databaseId: entry.databaseId, state: "invalid" };
  return {
    databaseId: registration.databaseId,
    engine: registration.engine,
    logicalEnvironment: registration.logicalEnvironment,
    classification: registration.classification,
    production: registration.production,
    registrationDigest: registration.registrationDigest,
    state: "valid"
  };
}

// invariant: AC 9 to AC 11. list and remove read no credential.
async function listDatabases(io: TaskCommandIo) {
  const workspace = await openTaskWorkspace(io, { ensure: false });
  return { databases: (await registrationFiles(workspace).entries()).map(listing) };
}

async function removeDatabase(io: TaskCommandIo, databaseId: string) {
  const workspace = await openTaskWorkspace(io, { ensure: false });
  await registrationFiles(workspace).remove(databaseId);
  return { databaseId, removed: true };
}

const data = (value: unknown): CommandResult => ({ data: value, diagnostics: [] });

const HANDLERS: Readonly<Record<string, TaskFamilyHandler>> = Object.freeze({
  "database add": async (command, io) => data(await addDatabase(io, required(command, "definition"))),
  "database list": async (_command, io) => data(await listDatabases(io)),
  "database remove": async (command, io) => data(await removeDatabase(io, required(command, "database", DATABASE_ID)))
});

const DATABASE_FAMILY: TaskFamily = Object.freeze({
  handlers: HANDLERS,
  notInstalled: "Database command is not installed",
  publicError: databasePublicError
});

export async function executeDatabaseCommand(command: CliCommand, process_: TaskFamilyProcess): Promise<CommandResult> {
  return executeTaskFamilyCommand(DATABASE_FAMILY, command, process_);
}
