// why: the only entry point main.ts loads for `vestra probe`, always through a
// dynamic import, so no other command loads the probe host or data-probe's
// planner.
import type { CliCommand, CommandResult } from "@verchestra/application";

import { requiredOption } from "../cli-options.ts";
import { DATABASE_ID } from "../database/database-registration-file.ts";
import { APPROVAL_REF } from "../extension/extension-approval-store.ts";
import { resolveSqliteProbeWorker } from "../release-layout.ts";
import {
  executeTaskFamilyCommand,
  type TaskFamily,
  type TaskFamilyHandler,
  type TaskFamilyProcess
} from "../task/task-dispatch.ts";
import { probePublicError } from "./probe-errors.ts";
import { runProbe } from "./probe-run.ts";
import { writeProbeWorker } from "./probe-worker.ts";

// invariant: door 1 and the Surface of
// .specs/features/sqlite-probe-worker/plan.md. The worker written is the
// bundle the running layout carries; each option is refused as an argument
// (exit 2) before anything is read.
function workerHandler(workerBundle: () => string): TaskFamilyHandler {
  return async (command, io) => ({
    data: await writeProbeWorker(io, {
      engine: requiredOption(command, "engine"),
      entry: requiredOption(command, "entry"),
      bundle: workerBundle()
    }),
    diagnostics: []
  });
}

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
  }),
  "probe worker": workerHandler(resolveSqliteProbeWorker)
});

const PROBE_FAMILY: TaskFamily = Object.freeze({
  handlers: HANDLERS,
  notInstalled: "Probe command is not installed",
  publicError: probePublicError
});

// why: a caller may name another layout's worker bundle, as a test of a
// checkout that has not built it does; main.ts never does.
export async function executeProbeCommand(
  command: CliCommand,
  process_: TaskFamilyProcess,
  workerBundle?: () => string
): Promise<CommandResult> {
  const family =
    workerBundle === undefined
      ? PROBE_FAMILY
      : Object.freeze({ ...PROBE_FAMILY, handlers: { ...HANDLERS, "probe worker": workerHandler(workerBundle) } });
  return executeTaskFamilyCommand(family, command, process_);
}
