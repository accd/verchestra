import { spawnSync } from "node:child_process";

import { isTransientWindowsCleanupFailure } from "./lighthouse-retry.mjs";

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm lifecycle executable is unavailable.");

const run = () =>
  spawnSync(process.execPath, [pnpmCli, "exec", "lhci", "autorun", "--config=./lighthouserc.cjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });

const print = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

const first = run();
print(first);
if (first.status === 0) process.exit(0);

const output = `${first.stdout ?? ""}\n${first.stderr ?? ""}`;
if (!isTransientWindowsCleanupFailure(output)) process.exit(first.status ?? 1);

process.stderr.write("Lighthouse temporary-directory cleanup was locked by Windows; retrying once.\n");
await new Promise((resolve) => setTimeout(resolve, 1_000));
const second = run();
print(second);
process.exit(second.status ?? 1);
