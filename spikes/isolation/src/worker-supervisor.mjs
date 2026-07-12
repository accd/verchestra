import { spawn } from "node:child_process";
import { once } from "node:events";

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
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
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
