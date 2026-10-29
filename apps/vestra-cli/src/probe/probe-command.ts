// why: the only entry point main.ts loads for `vestra probe`, always through a
// dynamic import, so no other command loads the probe host or data-probe's
// planner.
import type { CliCommand, CommandResult } from "@verchestra/application";

import { requiredOption } from "../cli-options.ts";
import { DATABASE_ID } from "../database/database-registration-file.ts";
import { APPROVAL_REF } from "../extension/extension-approval-store.ts";
import {
  executeTaskFamilyCommand,
  type TaskFamily,
  type TaskFamilyHandler,
  type TaskFamilyProcess
} from "../task/task-dispatch.ts";
import { probePublicError } from "./probe-errors.ts";
import { runProbe } from "./probe-run.ts";

// invariant: door 5 and the Surface of .specs/features/probe-run/plan.md. Each
// option is refused as an argument (exit 2) before anything is read.
const HANDLERS: Readonly<Record<string, TaskFamilyHandler>> = Object.freeze({
  "probe run": async (command, io) => ({
    data: await runProbe(io, {
      databaseId: requiredOption(command, "database", DATABASE_ID),
      approvalRef: requiredOption(command, "approval-ref", APPROVAL_REF),
      requestPath: requiredOption(command, "request"),
      confirmStdin: command.options["confirm-stdin"] === true
    }),
    diagnostics: []
  })
});

const PROBE_FAMILY: TaskFamily = Object.freeze({
  handlers: HANDLERS,
  notInstalled: "Probe command is not installed",
  publicError: probePublicError
});

export async function executeProbeCommand(command: CliCommand, process_: TaskFamilyProcess): Promise<CommandResult> {
  return executeTaskFamilyCommand(PROBE_FAMILY, command, process_);
}
