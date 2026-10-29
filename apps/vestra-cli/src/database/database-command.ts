// why: the only entry point main.ts loads for `vestra database`, always
// through a dynamic import, so no other command loads data-probe.
import type { CliCommand, CommandResult } from "@verchestra/application";

import { requiredOption } from "../cli-options.ts";
import {
  executeTaskFamilyCommand,
  type TaskFamily,
  type TaskFamilyHandler,
  type TaskFamilyProcess
} from "../task/task-dispatch.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { unlockedSigner, workspaceTrustRoot } from "../task/task-signing.ts";
import { openTaskWorkspace, type TaskWorkspace } from "../task/task-workspace.ts";
import { readDefinition, registrationDocument } from "./database-definition.ts";
import { databasePublicError } from "./database-errors.ts";
import {
  DATABASE_ID,
  DatabaseRegistrationFiles,
  type DatabaseRegistrationEntry,
  type DatabaseRegistrationFilesOptions
} from "./database-registration-file.ts";

// invariant: door 1. Registrations live in the Workspace's repository and
// verify against the pinned anchor of its evidence key; with no anchor there
// is nothing to verify against, so no registration verifies. `vestra probe
// run` reads them through the same options.
export function registrationOptions(workspace: TaskWorkspace): DatabaseRegistrationFilesOptions {
  return {
    repositoryRoot: workspace.repositoryRoot,
    workspaceId: workspace.workspaceId,
    trust: () => workspaceTrustRoot(workspace).catch(() => undefined)
  };
}

function registrationFiles(workspace: TaskWorkspace): DatabaseRegistrationFiles {
  return new DatabaseRegistrationFiles(registrationOptions(workspace));
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
  "database add": async (command, io) => data(await addDatabase(io, requiredOption(command, "definition"))),
  "database list": async (_command, io) => data(await listDatabases(io)),
  "database remove": async (command, io) =>
    data(await removeDatabase(io, requiredOption(command, "database", DATABASE_ID)))
});

const DATABASE_FAMILY: TaskFamily = Object.freeze({
  handlers: HANDLERS,
  notInstalled: "Database command is not installed",
  publicError: databasePublicError
});

export async function executeDatabaseCommand(command: CliCommand, process_: TaskFamilyProcess): Promise<CommandResult> {
  return executeTaskFamilyCommand(DATABASE_FAMILY, command, process_);
}
