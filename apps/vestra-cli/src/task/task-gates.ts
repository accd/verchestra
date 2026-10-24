import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { GateCommandProfile } from "@verchestra/platform-node";

import { notConfigured } from "./task-errors.ts";
import { objectRow, readJsonFile } from "./task-files.ts";
import type { PlannedTaskRequest } from "./task-plan-record.ts";
import type { TaskWorkspace } from "./task-workspace.ts";

const COMMAND_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const PROTOCOLS = new Set(["exit-code", "test-summary"]);

// invariant: a gate's executable comes only from this machine-local file,
// which the user writes; a task request names a `commandRef` and arguments,
// never a program to run.
export const GATE_ALLOWLIST_FILE = "task-gates.json";

export function gateAllowlistPath(workspace: TaskWorkspace): string {
  return join(workspace.layout.workspaceRoot, GATE_ALLOWLIST_FILE);
}

function invalid(message: string): never {
  throw notConfigured("gate-allowlist", message);
}

function stringsWithoutNul(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && !entry.includes("\0"));
}

async function executableFile(path: string): Promise<boolean> {
  const metadata = await stat(path).catch(() => undefined);
  if (metadata?.isFile() !== true) return false;
  return access(path, constants.X_OK).then(
    () => true,
    () => false
  );
}

async function profile(value: unknown): Promise<GateCommandProfile> {
  const row = objectRow(value, "gate allowlist entry");
  const executable = row["executable"];
  const fixedArgs = row["fixedArgs"] ?? [];
  const protocols = row["protocols"];
  if (typeof executable !== "string" || !isAbsolute(executable) || executable.includes("\0"))
    invalid("A gate allowlist executable must be an absolute path");
  if (!stringsWithoutNul(fixedArgs)) invalid("Gate allowlist fixedArgs must be strings");
  if (!Array.isArray(protocols) || protocols.length === 0 || protocols.some((entry) => !PROTOCOLS.has(entry)))
    invalid("Gate allowlist protocols must name exit-code or test-summary");
  if (!(await executableFile(executable))) invalid("A gate allowlist executable does not exist or is not executable");
  return Object.freeze({
    executable,
    fixedArgs: Object.freeze([...fixedArgs]),
    protocols: Object.freeze([...(protocols as GateCommandProfile["protocols"][number][])])
  });
}

// why: the owner is told the one file that provisions the requirement, with an
// entry per command the request names. The path is machine-local, so it is
// shown on the terminal only, never in a public error or a record. A
// commandRef matches COMMAND_REF and a protocol is one of two names, so both
// are written into the template as they are.
function explainMissing(path: string, request: Pick<PlannedTaskRequest, "gates">, stderr: (value: string) => void) {
  const protocols = new Map<string, Set<string>>();
  for (const gate of request.gates) {
    const known = protocols.get(gate.commandRef) ?? new Set<string>();
    known.add(gate.resultProtocol);
    protocols.set(gate.commandRef, known);
  }
  const entries = [...protocols].map(([commandRef, admitted]) => {
    const names = [...admitted]
      .sort()
      .map((name) => `"${name}"`)
      .join(", ");
    return `    "${commandRef}": { "executable": "<absolute path of the program>", "fixedArgs": [], "protocols": [${names}] }`;
  });
  stderr(
    "A task runs its gates only through programs you allow on this machine. Write this file:\n" +
      `  ${path}\n` +
      `{\n  "schemaVersion": 1,\n  "commands": {\n${entries.join(",\n")}\n  }\n}\n`
  );
}

export async function loadGateAllowlist(
  workspace: TaskWorkspace,
  request: Pick<PlannedTaskRequest, "gates">,
  stderr: (value: string) => void
): Promise<Readonly<Record<string, GateCommandProfile>>> {
  const path = gateAllowlistPath(workspace);
  const stored = await readJsonFile(path, "gate allowlist");
  if (stored === undefined) {
    explainMissing(path, request, stderr);
    throw notConfigured("gate-allowlist", "No machine-local gate allowlist exists");
  }
  const row = objectRow(stored, "gate allowlist");
  if (row["schemaVersion"] !== 1) invalid("The gate allowlist schemaVersion must be 1");
  const commands = objectRow(row["commands"], "gate allowlist commands");
  const profiles: Record<string, GateCommandProfile> = {};
  for (const gate of request.gates) {
    if (!COMMAND_REF.test(gate.commandRef) || !Object.hasOwn(commands, gate.commandRef))
      throw notConfigured(`gate-command:${gate.commandRef}`, "A gate commandRef is not in the local allowlist");
    const entry = await profile(commands[gate.commandRef]);
    if (!entry.protocols.includes(gate.resultProtocol))
      throw notConfigured(`gate-command:${gate.commandRef}`, "The allowlisted command does not admit this protocol");
    profiles[gate.commandRef] = entry;
  }
  return Object.freeze(profiles);
}
