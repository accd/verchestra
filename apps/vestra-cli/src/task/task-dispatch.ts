import { homedir } from "node:os";

import type { CliCommand, CommandResult } from "@verchestra/application";
import type { PublicErrorException } from "@verchestra/domain";

import { cliError } from "../cli-errors.ts";
import type { TaskCommandIo, TaskConfirmationInput } from "./task-io.ts";

export type TaskFamilyHandler = (command: CliCommand, io: TaskCommandIo) => Promise<CommandResult>;

// invariant: everything a `vestra task` or `vestra extension` command reads
// from its process, as main.ts hands it over.
export interface TaskFamilyProcess {
  readonly controlRoot: string;
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: TaskConfirmationInput;
  readonly stderr: (value: string) => void;
  readonly pid: number;
}

export interface TaskFamily {
  readonly handlers: Readonly<Record<string, TaskFamilyHandler>>;
  // why: each family names itself in the refusal of a command it lacks.
  readonly notInstalled: string;
  readonly publicError: (error: unknown) => PublicErrorException;
}

// invariant: one dispatch for the command families that share the task
// command io: a command the family lacks is an argument error; the io carries
// the home directory and, when given, the keychain path; anything a handler
// throws leaves as the family's public error.
export async function executeTaskFamilyCommand(
  family: TaskFamily,
  command: CliCommand,
  process_: TaskFamilyProcess
): Promise<CommandResult> {
  const handler = family.handlers[command.name];
  if (handler === undefined)
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: command.name }, family.notInstalled);
  const keychain = command.options["keychain"];
  const io: TaskCommandIo = {
    ...process_,
    homeDirectory: homedir(),
    ...(typeof keychain === "string" ? { keychainPath: keychain } : {})
  };
  try {
    return await handler(command, io);
  } catch (error) {
    throw family.publicError(error);
  }
}
