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

const minimal = "[Console]::Out.WriteLine('hello')\nexit 0\n";
const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"];
await run("minimal, full env", args, minimal, process.env);
await run("minimal, product env", args, minimal, powershellChildEnvironment());
const addType = "Add-Type -TypeDefinition 'public static class Probe { public static string Hi() { return \"hi\"; } }'\n[Console]::Out.WriteLine([Probe]::Hi())\nexit 0\n";
await run("add-type, full env", args, addType, process.env);
await run("add-type, product env", args, addType, powershellChildEnvironment());
await run("has program, full env", args, credentialProgram("Has", locator), process.env);
await run("has program, product env", args, credentialProgram("Has", locator), powershellChildEnvironment());
const readline = "$p = [Console]::In.ReadLine()\n#aGVsbG8=\n[Console]::Out.WriteLine('got:' + $p)\nexit 0\n";
await run("readline interplay, full env", args, readline, process.env);
console.log(JSON.stringify(Object.keys(powershellChildEnvironment())));
