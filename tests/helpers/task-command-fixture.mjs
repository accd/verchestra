// invariant: a Workspace a `vestra task` command function can open in this
// process: a real repository whose root holds the identity file, and a state
// root under a home that belongs to the fixture. No credential is bound and no
// provider exists, so only what a command does before it reads a credential is
// reachable here. That is every refusal a command raises from the Run record,
// and the whole of `status` and `cancel`, on every platform.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// invariant: a command that got past the refusal a case expects would go on
// to read a credential. With the deny guard installed that attempt throws
// before the OS credential tool is started, so such a case fails without ever
// touching the user's credential store.
import "./deny-keychain-spawn.mjs";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { openRuntime, openTaskWorkspace } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  objectFormatRepository
} from "./git-object-format-fixture.mjs";
import { RUN_ID, WORKSPACE_ID, planRecord } from "./task-run-record-fixture.mjs";

export const cleanupTaskCommandFixtures = cleanupObjectFormatRepositories;

// why: no case here reaches a confirmation, so the input is never read.
const NO_INPUT = Object.freeze({
  isTTY: false,
  on: () => undefined,
  removeAllListeners: () => undefined,
  resume: () => undefined,
  pause: () => undefined
});

export async function listing(directory, prefix = "") {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(...(await listing(join(directory, entry.name), `${prefix}${entry.name}/`)));
    else names.push(`${prefix}${entry.name}`);
  }
  return names.sort((left, right) => Number(left > right) - Number(left < right));
}

export function refusedState(reason) {
  return (error) => {
    if (error?.envelope?.code !== "VES_TASK_STATE_INVALID" || error.envelope.safeDetails.reason !== reason)
      throw new Error(`expected VES_TASK_STATE_INVALID (${reason})`, { cause: error });
    return true;
  };
}

export async function taskCommandFixture() {
  const repository = await objectFormatRepository(OBJECT_FORMATS[0]);
  await mkdir(join(repository.repositoryRoot, ".verchestra"));
  await writeFile(
    join(repository.repositoryRoot, ".verchestra", "workspace.yaml"),
    `schemaVersion: 1\nworkspaceId: ${WORKSPACE_ID}\n`
  );
  const stderr = [];
  const io = {
    controlRoot: repository.repositoryRoot,
    platform: process.platform,
    homeDirectory: join(repository.root, "home"),
    // why: Windows keeps the state root below LOCALAPPDATA, by default
    // `<home>\AppData\Local`; a short one keeps the Workspace state root on
    // the hosted runner at 142 of the 150 bytes Git's limit allows. Other
    // platforms do not read it.
    env: { LOCALAPPDATA: join(repository.root, "l") },
    stdin: NO_INPUT,
    stderr: (value) => stderr.push(value),
    pid: process.pid
  };
  const workspace = await openTaskWorkspace(io);
  const state = (runId = RUN_ID) => {
    const runtime = openRuntime(workspace);
    try {
      return runtime.getRun(runId).state;
    } finally {
      runtime.close();
    }
  };
  // why: a run as `task plan` leaves it and a later command finds it: the
  // sealed plan record in its Run directory and the workflow row in the
  // runtime store, here created directly in the state the case needs.
  const planned = async (workflowState, plan = planRecord()) => {
    const runRecord = openRunRecord(workspace, plan.runId);
    await runRecord.savePlan(plan);
    const runtime = openRuntime(workspace);
    try {
      runtime.createRun({
        runId: plan.runId,
        runKind: "feature",
        state: workflowState,
        version: 0,
        repairCycles: 0,
        approval: undefined,
        terminalCapsuleRequired: false
      });
    } finally {
      runtime.close();
    }
    return { plan, runRecord, directory: join(workspace.tasksRoot, plan.runId) };
  };
  return { root: repository.root, repositoryRoot: repository.repositoryRoot, io, stderr, workspace, state, planned };
}
