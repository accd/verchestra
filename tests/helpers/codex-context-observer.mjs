import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

for (const key of ["HOME", "USERPROFILE", "CODEX_HOME"]) assert.equal(process.env[key], process.cwd());
assert.ok(process.env.PATH === undefined || process.env.PATH === "");
assert.equal(Object.hasOwn(process.env, "CODEX_THREAD_ID"), false);
assert.equal(Object.hasOwn(process.env, "CODEX_TURN_ID"), false);

const phase = process.argv.includes("--version") ? "probe" : "start";
writeFileSync(
  `${phase}.json`,
  JSON.stringify({
    cwd: process.cwd(),
    marker: process.env.VERCH_CONTEXT_MARKER,
    inherited: ["HOME", "USERPROFILE", "CODEX_HOME", "PATH", "CODEX_THREAD_ID", "CODEX_TURN_ID"].filter((key) =>
      process.env[key]?.startsWith("synthetic-controller-")
    )
  })
);
await import("../../spikes/codex-driver/test/fake-codex-app-server.mjs");
