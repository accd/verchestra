// TEMPORARY diagnostic for #379 CI iteration; removed before review.
import { spawn } from "node:child_process";

import {
  credentialProgram,
  powershellChildEnvironment,
  powershellExecutable
} from "../../../packages/platform-node/src/index.ts";

const locator = { namespace: "verchestra/workspace_6e2f1a0b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", logicalName: "probe-name" };

function run(label, args, stdin, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(powershellExecutable(), args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      console.log(`=== ${label}: exit ${code} after ${Date.now() - started} ms`);
      console.log(`stdout: ${JSON.stringify(out.slice(0, 2000))}`);
      console.log(`stderr: ${JSON.stringify(err.slice(0, 2000))}`);
      resolve();
    });
    child.stdin.end(stdin);
  });
}

const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"];
for (let attempt = 1; attempt <= 3; attempt += 1)
  await run(`has program ${attempt}, product env`, args, credentialProgram("Has", locator), powershellChildEnvironment());
