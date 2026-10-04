// why: the only entry point main.ts loads for `vestra task`, always through a
// dynamic import, so no other command pays for (or loads node:sqlite from)
// the governed task composition.
import { homedir } from "node:os";

import type { CliCommand, CommandResult } from "@verchestra/application";
import { PublicErrorException, type PublicErrorRegistry } from "@verchestra/domain";
import { platformSecurityPublicErrorRegistry, runtimePublicErrorRegistry } from "@verchestra/platform-node";
import { initPublicErrorRegistry } from "@verchestra/workspace";

import { cliError } from "../cli-errors.ts";
import { approveTask } from "./task-approve.ts";
import { stableCode, taskError } from "./task-errors.ts";
import type { TaskCommandIo, TaskConfirmationInput } from "./task-io.ts";
import { planTask } from "./task-plan.ts";
import { reviewTask } from "./task-review.ts";
import { runTask } from "./task-run.ts";
import { cancelTask, statusTask } from "./task-status.ts";

const REGISTRIES: readonly PublicErrorRegistry[] = [
  platformSecurityPublicErrorRegistry,
  runtimePublicErrorRegistry,
  initPublicErrorRegistry
];

function publicError(error: unknown): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = stableCode(error);
  for (const registry of REGISTRIES)
    if (registry.codes.includes(code)) {
      const definition = registry.definitions.find((entry) => entry.code === code);
      if (definition !== undefined && Object.keys(definition.safeDetails).length === 0)
        return new PublicErrorException(registry.create(code, {}), "Task command failed", { cause: error });
    }
  return taskError("VES_TASK_FAILED", { reason: code }, "Task command failed", { cause: error });
}

function required(command: CliCommand, option: string): string {
  const value = command.options[option];
  if (typeof value !== "string")
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${option}` }, `--${option} is required`);
  return value;
}

type Handler = (command: CliCommand, io: TaskCommandIo) => Promise<CommandResult>;

const data = (value: unknown): CommandResult => ({ data: value, diagnostics: [] });

const HANDLERS: Readonly<Record<string, Handler>> = Object.freeze({
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

export async function executeTaskCommand(
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
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: command.name }, "Task command is not installed");
  const keychain = command.options["keychain"];
  const io: TaskCommandIo = {
    ...process_,
    homeDirectory: homedir(),
    ...(typeof keychain === "string" ? { keychainPath: keychain } : {})
  };
  try {
    return await handler(command, io);
  } catch (error) {
    throw publicError(error);
  }
}
