import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { CliCommand } from "@verchestra/application";
import { codeUnitCompare } from "@verchestra/domain";

import { cliError } from "./cli-errors.ts";

type Row = Readonly<Record<string, unknown>>;

// invariant: an option a command needs is refused as an argument (exit 2),
// naming the option, before anything is read.
export function requiredOption(command: CliCommand, option: string, pattern?: RegExp): string {
  const value = command.options[option];
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value)))
    throw cliError("VES_CLI_ARGUMENT_INVALID", { argument: `--${option}` }, `--${option} is missing or malformed`);
  return value;
}

// why: an exact key set compares as one string, in code-unit order.
export const keyList = (keys: readonly string[]): string => [...keys].sort(codeUnitCompare).join(",");

export function hasKeys(value: unknown, keys: string): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) && keyList(Object.keys(value)) === keys;
}

export function argumentRefused(argument: string, message: string): never {
  throw cliError("VES_CLI_ARGUMENT_INVALID", { argument }, message);
}

// invariant: a file a command option names is JSON in a regular file of at
// most `maximumBytes`; a file that is missing, a link, larger, unreadable or
// not JSON is an argument error naming the option (exit 2), refused before
// the Workspace is opened.
export async function readArgumentJson(
  controlRoot: string,
  path: string,
  argument: string,
  maximumBytes: number
): Promise<unknown> {
  const target = isAbsolute(path) ? path : resolve(controlRoot, path);
  const metadata = await lstat(target).catch(() => undefined);
  if (metadata?.isFile() !== true || metadata.size > maximumBytes)
    argumentRefused(argument, `${argument} names no regular file of at most ${maximumBytes / 1024} KiB`);
  const text = await readFile(target, "utf8").catch(() => argumentRefused(argument, `${argument} is unreadable`));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return argumentRefused(argument, `${argument} is not JSON`);
  }
}
