import { spawn } from "node:child_process";

const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.stdout.write(`${JSON.stringify({ parent: process.pid, child: descendant.pid })}\n`);
setInterval(() => {}, 1000);
