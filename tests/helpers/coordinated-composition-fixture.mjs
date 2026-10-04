// DETERMINISTIC FAKES - not providers. The coordinated run's composition
// (apps/vestra-cli/src/task/task-coordination.ts) with its real node adapters,
// the production ClaudeCodeDriver and CodexDriver, and the real bridge, run
// against the labeled fake `claude` and `codex` of the driver spikes through
// POSIX wrappers. No provider is contacted and every credential is a fixture
// value. The Windows task path takes only a native executable from PATH, so a
// case that needs a wrapper asserts the Windows path instead (WIN32_HOST).
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { coordinatedDriver } from "../../apps/vestra-cli/src/task/task-coordination.ts";
import { ProviderProcesses } from "../../apps/vestra-cli/src/task/task-process-tree.ts";
import { InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { MemoryRecords, control, driverRequest } from "./coordinated-driver-fixture.mjs";
import { temporaryDirectory } from "./temporary-directory.mjs";

export const WIN32_HOST = process.platform === "win32";
export const CLAUDE_CREDENTIAL = "sk-ant-api03-fixture-composition-7c41";
export const CODEX_CREDENTIAL = "sk-proj-fixture-composition-2b9e";
// why: the spike's fake Codex lists this one model; the composition passes a
// node's model to its driver as the approved plan names it.
export const FAKE_CODEX_MODEL = "gpt-5.5-codex";

const FAKE_CLAUDE = fileURLToPath(
  new URL("../../spikes/claude-code-driver/test/fake-claude-mediated.mjs", import.meta.url)
);
const FAKE_CODEX = fileURLToPath(new URL("../../spikes/codex-driver/test/fake-codex-app-server.mjs", import.meta.url));
const VIEW_OBSERVER = fileURLToPath(new URL("./codex-view-observer.mjs", import.meta.url));
const quoted = (value) => `'${value}'`;

async function wrapper(path, name, command, environment = {}) {
  const assignments = Object.entries(environment).map(([key, value]) => `${key}=${quoted(value)} `);
  const line = [process.execPath, ...command].map(quoted).join(" ");
  await writeFile(path, `#!/bin/sh\n# DETERMINISTIC FAKE - not ${name}.\n${assignments.join("")}exec ${line} "$@"\n`, {
    mode: 0o700
  });
  return path;
}

// why: a plan normalization would refuse the spike fake's model (it has no
// priced entry), and the composition never normalizes again, so a case swaps
// it in on the normalized plan.
export function withFakeCodexModel(request) {
  const nodes = request.execution.nodes.map((node) =>
    node.driver.driverId === "codex" ? { ...node, driver: { ...node.driver, model: FAKE_CODEX_MODEL } } : node
  );
  return { ...request, execution: { ...request.execution, nodes } };
}

// invariant: one coordinated run of `request` through the composition, in a
// worktree holding `files` (logical path to content), with each Codex session
// started as the fake in `codex.mode`, behind the view observer when
// `codex.observeView` is set.
export async function compositionFixture(t, request, options = {}) {
  const root = await realpath(await temporaryDirectory(t, "vestra-composition-"));
  const worktree = join(root, "worktree");
  const observations = join(root, "observations");
  const sessionsRoot = join(root, "sessions");
  for (const directory of [worktree, observations, sessionsRoot]) await mkdir(directory, { recursive: true });
  for (const [path, content] of Object.entries(options.files ?? { "src/a.txt": "alpha\n" })) {
    await mkdir(join(worktree, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(worktree, ...path.split("/")), content);
  }
  const claude = await wrapper(join(root, "claude"), "Claude Code", [
    FAKE_CLAUDE,
    "--fixture-observations",
    observations
  ]);
  const codex = await wrapper(join(root, "codex"), "Codex", [options.codex?.observeView ? VIEW_OBSERVER : FAKE_CODEX], {
    FAKE_CODEX_VERSION: "0.159.3",
    FAKE_CODEX_MODE: options.codex?.mode ?? "structured",
    FAKE_CODEX_OBSERVATIONS: observations
  });
  const records = new MemoryRecords();
  const executor = control();
  const stderr = [];
  const driver = coordinatedDriver({
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
    runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
    request,
    manifest: { manifestId: `sha256:${"a".repeat(64)}`, fragments: [], omissions: [] },
    claude: { executable: claude, auth: "api-key", credential: CLAUDE_CREDENTIAL },
    codex: { executable: codex, credential: options.codex?.credential ?? CODEX_CREDENTIAL },
    env: { PATH: process.env.PATH ?? "", TMPDIR: root },
    sessionsRoot,
    providers: new ProviderProcesses({ stderr: (line) => stderr.push(line) }),
    worktrees: {
      resolvePath: () => Promise.resolve(worktree),
      inspect: () => Promise.resolve({ changeDigest: `sha256:${"4".repeat(64)}` })
    },
    payloads: new InMemoryExecutionPayloadStore(),
    records,
    feedback: undefined,
    remainingDurationMs: () => 60_000,
    onWorktree: () => Promise.resolve(),
    reconcile: undefined
  });
  return {
    root,
    worktree,
    sessionsRoot,
    records,
    executor,
    stderr,
    run: () => driver.execute(driverRequest(request), executor.control),
    claudeObservation: async () =>
      JSON.parse(await readFile(join(observations, "fake-claude-observation.json"), "utf8")),
    codexViews: async () => {
      const names = (await readdir(observations)).filter((name) => name.startsWith("codex-view-"));
      return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(observations, name), "utf8"))));
    }
  };
}
