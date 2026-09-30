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
const addType = "Add-Type -TypeDefinition 'public static class Probe { public static string Hi() { return \"hi\"; } }'\n[Console]::Out.WriteLine([Probe]::Hi())\nexit 0\n";
const pick = (keys) => Object.fromEntries(keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])));
const groups = {
  modules: ["PSModulePath"],
  programFiles: ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432"],
  machine: ["COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION", "OS"],
  shell: ["ComSpec", "PATHEXT"],
  profile: ["ALLUSERSPROFILE", "PUBLIC", "HOMEDRIVE", "HOMEPATH"]
};
for (const [name, keys] of Object.entries(groups))
  await run(`add-type, product env + ${name}`, args, addType, { ...powershellChildEnvironment(), ...pick(keys) });
await run("add-type, product env + all groups", args, addType, { ...powershellChildEnvironment(), ...pick(Object.values(groups).flat()) });
await run("add-type, full env", args, addType, process.env);
const literal = "$p = 'aGVsbG8='\n[Console]::Out.WriteLine('got:' + $p)\nexit 0\n";
await run("literal payload line", args, literal, process.env);
console.log(JSON.stringify(Object.keys(process.env).sort()));
