import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function escalateCancellation({ sendProtocolCancel, waitForExit, sendSignal, killTree }) {
  const evidence = ["protocol-cancel"];
  await sendProtocolCancel();
  if (await waitForExit()) return { terminated: true, stage: "protocol-cancel", evidence: [...evidence, "protocol-exit"] };
  evidence.push("grace-expired", "process-signal");
  await sendSignal();
  if (await waitForExit()) return { terminated: true, stage: "process-signal", evidence: [...evidence, "signal-exit"] };
  evidence.push("signal-grace-expired", "process-tree-kill");
  await killTree();
  return { terminated: true, stage: "process-tree-kill", evidence };
}

async function run(command, args) {
  const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
  const [code] = await once(child, "exit");
  if (code !== 0 && code !== 128) throw Object.assign(new Error(`tree kill command failed with exit ${code}`), { code: "VES_PROCESS_TREE_KILL_FAILED" });
}

export async function killProcessTree(pid, { platform = process.platform } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("pid must be a positive safe integer");
  if (platform === "win32") {
    await run("taskkill.exe", ["/pid", String(pid), "/t", "/f"]);
    return;
  }

  const processes = await readPosixProcessTree();
  if (!processes.has(pid)) {
    if (await isProcessAlive(pid)) throw processTreeFailure("Target process is absent from the POSIX process table");
    return;
  }

  const descendants = descendantsFirst(pid, processes);
  for (const target of descendants) {
    try {
      process.kill(target, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH" || (await isProcessAlive(target))) throw error;
    }
  }
}

function processTreeFailure(message, options) {
  return Object.assign(new Error(message, options), { code: "VES_PROCESS_TREE_KILL_FAILED" });
}

async function readPosixProcessTree() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", windowsHide: true }));
  } catch (error) {
    throw processTreeFailure("Unable to enumerate the POSIX process tree", { cause: error });
  }
  const processes = new Map();
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (match === null) continue;
    const processId = Number.parseInt(match[1], 10);
    const parentId = Number.parseInt(match[2], 10);
    if (Number.isSafeInteger(processId) && Number.isSafeInteger(parentId)) processes.set(processId, parentId);
  }
  return processes;
}

function descendantsFirst(root, processes) {
  const children = new Map();
  for (const [processId, parentId] of processes) {
    const siblings = children.get(parentId) ?? [];
    siblings.push(processId);
    children.set(parentId, siblings);
  }
  const result = [];
  const visit = (processId) => {
    for (const child of children.get(processId) ?? []) visit(child);
    result.push(processId);
  };
  visit(root);
  return result;
}

export async function isProcessAlive(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}
