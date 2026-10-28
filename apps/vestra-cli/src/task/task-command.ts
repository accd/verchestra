// why: the only entry point main.ts loads for `vestra task`, always through a
// dynamic import, so no other command pays for (or loads node:sqlite from)
// the governed task composition.
import type { CliCommand, CommandResult } from "@verchestra/application";

import { cliError } from "../cli-errors.ts";
import { approveTask } from "./task-approve.ts";
import { checkTask } from "./task-check.ts";
import {
  executeTaskFamilyCommand,
  type TaskFamily,
  type TaskFamilyHandler,
  type TaskFamilyProcess
} from "./task-dispatch.ts";
import { planTask } from "./task-plan.ts";
import { publicError } from "./task-public-error.ts";
import { reviewTask } from "./task-review.ts";
import { runTask } from "./task-run.ts";
import { cancelTask, statusTask } from "./task-status.ts";

function required(command: CliCommand, option: string): string {
  const value = command.options[option];
  if (typeof value !== "string")
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${option}` }, `--${option} is required`);
  return value;
}

const data = (value: unknown): CommandResult => ({ data: value, diagnostics: [] });

const HANDLERS: Readonly<Record<string, TaskFamilyHandler>> = Object.freeze({
  "task check": async (command, io) => checkTask(io, required(command, "request")),
  "task plan": async (command, io) =>
    data(await planTask(io, required(command, "request"), command.options["dry-run"] === true)),
  "task approve": async (command, io) =>
    data(
      await approveTask(io, {
        runId: required(command, "run-id"),
        bindingDigest: required(command, "binding-digest"),
        confirmStdin: command.options["confirm-stdin"] === true
      })
    ),
  "task start": async (command, io) => {
    const result = await runTask(io, { runId: required(command, "run-id"), resume: false });
    return { data: result.data, diagnostics: [], exitCode: result.exitCode };
  },
  "task resume": async (command, io) => {
    const result = await runTask(io, {
      runId: required(command, "run-id"),
      resume: true,
      reconcile: command.options["reconcile"]
    });
    return { data: result.data, diagnostics: [], exitCode: result.exitCode };
  },
  "task status": async (command, io) => data(await statusTask(io, { runId: required(command, "run-id") })),
  "task cancel": async (command, io) => data(await cancelTask(io, { runId: required(command, "run-id") })),
  "task review": async (command, io) =>
    data(
      await reviewTask(io, {
        runId: required(command, "run-id"),
        outcome: required(command, "outcome"),
        surfaceDigest: required(command, "surface-digest"),
        confirmStdin: command.options["confirm-stdin"] === true
      })
    )
});

const TASK_FAMILY: TaskFamily = Object.freeze({
  handlers: HANDLERS,
  notInstalled: "Task command is not installed",
  publicError
});

export async function executeTaskCommand(command: CliCommand, process_: TaskFamilyProcess): Promise<CommandResult> {
  return executeTaskFamilyCommand(TASK_FAMILY, command, process_);
}
