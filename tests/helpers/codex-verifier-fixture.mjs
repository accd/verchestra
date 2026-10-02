// invariant: a verifier session here is `runCodexVerifier` against the labeled
// DETERMINISTIC FAKE `codex` in tests/helpers/task-cli-fakes. It never
// contacts a provider, and its API key is a fixture value.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCodexVerifier } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { executeTaskCommand } from "../../apps/vestra-cli/src/task/task-command.ts";
import { eventually } from "./process-liveness.mjs";

const fakeCodex = fileURLToPath(new URL("./task-cli-fakes/fake-codex-task.mjs", import.meta.url));
export const VERIFIER_MODEL = "gpt-5.2-codex";
export const WIN32_HOST = process.platform === "win32";

// invariant: on Windows every `vestra task` command is refused before a
// verifier session is reachable, and the fake's wrapper is a POSIX script. A
// case that needs the fake asserts that refusal on win32 instead of skipping.
export async function verifierRefusedOnWin32(t) {
  t.diagnostic("win32: asserting the governed task path is refused instead");
  await assert.rejects(
    executeTaskCommand(
      { name: "task start", options: { "run-id": "run_018f0000-0000-7000-8000-000000001502" } },
      { controlRoot: tmpdir(), platform: "win32", env: {}, stdin: process.stdin, stderr: () => undefined, pid: 1 }
    ),
    (error) => {
      assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
      assert.equal(error.envelope.safeDetails.requirement, "platform");
      return true;
    }
  );
}

async function lines(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const turnLog = (root) => join(root, "log", "fake-codex-turn.log");

// invariant: every process the fake named in a turn log is killed by its id
// after the suite, whether or not its case got as far as reading that log, and
// every root is then removed. A failing case therefore leaves nothing running
// and cannot keep the suite alive.
export function verifierFixtures(after) {
  const roots = [];
  after(async () => {
    for (const root of roots)
      for (const entry of await lines(turnLog(root)))
        for (const pid of Object.values(entry).filter(Number.isSafeInteger)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (error) {
            if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
          }
        }
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  return async function verifierSession({ scenario, meter, signal } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vestra-codex-verifier-")));
    roots.push(root);
    const review = join(root, "review");
    const log = join(root, "log");
    await mkdir(join(review, "src"), { recursive: true });
    await mkdir(join(review, "scripts"));
    await mkdir(log);
    await writeFile(join(review, "src", "value.txt"), "new\n");
    await writeFile(join(review, "scripts", "check-value.mjs"), 'if (value !== "new\\n") process.exit(1);\n');
    const wrapper = join(root, "codex");
    await writeFile(
      wrapper,
      `#!/bin/sh\n# DETERMINISTIC FAKE - not Codex.\nexec '${process.execPath}' '${fakeCodex}' --fixture-log '${log}' "$@"\n`,
      { mode: 0o700 }
    );
    const sessionRoot = join(root, "sessions", "codex-run");
    const run = () =>
      runCodexVerifier({
        workspaceId: "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
        runId: "run_018f0000-0000-7000-8000-000000001502",
        manifestId: `sha256:${"a".repeat(64)}`,
        request: { verifier: { driverId: "codex", model: VERIFIER_MODEL } },
        executable: wrapper,
        credential: "sk-openai-brokered-fixture",
        env: { PATH: process.env.PATH ?? "", TMPDIR: root },
        sessionRoot,
        cwd: review,
        prompt: `Requirements: VES-EXE-001${scenario === undefined ? "" : ` verifier-scenario:${scenario}`}`,
        meter,
        signal: signal ?? new AbortController().signal
      });
    const sessions = () => lines(join(log, "fake-codex.log"));
    // invariant: resolves once the fake has an open turn, with its process id.
    const turns = () => lines(turnLog(root));
    const turn = async () => {
      const entry = await eventually(async () => (await turns())[0]);
      assert.ok(Number.isSafeInteger(entry?.pid), "the fake never opened a turn");
      return entry;
    };
    return { root, run, sessions, sessionRoot, turn, turns };
  };
}
