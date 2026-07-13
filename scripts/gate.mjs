import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const stages = {
  quick: ["format:check", "lint", "typecheck", "test:unit"],
  full: [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:fault"
  ],
  build: [
    "format:check",
    "lint",
    "typecheck",
    "build",
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:architecture",
    "test:qualification"
  ],
  security: [
    "format:check",
    "lint",
    "typecheck",
    "build",
    "test:unit",
    "test:architecture",
    "test:qualification",
    "test:security",
    "test:fault"
  ],
  release: [
    "format:check",
    "lint",
    "typecheck",
    "build",
    "test:unit",
    "test:architecture",
    "test:qualification",
    "test:security",
    "test:fault",
    "test:release"
  ]
};

const [gate, option] = process.argv.slice(2);
if (!Object.hasOwn(stages, gate)) {
  process.stderr.write("unknown gate\n");
  process.exit(2);
}
if (option === "--smoke") {
  process.stdout.write(`gate:${gate} smoke PASS\n`);
  process.exit(0);
}

for (const stage of stages[gate]) {
  process.stdout.write(`gate:${gate} stage:${stage}\n`);
  const command = process.platform === "win32" ? process.execPath : "corepack";
  const prefix =
    process.platform === "win32"
      ? [join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js")]
      : [];
  const result = spawnSync(command, [...prefix, "pnpm@10.34.5", "run", stage], { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`gate:${gate} stage:${stage} spawn failed: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write(`gate:${gate} PASS\n`);
