import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FULL_DURABLE_BOUNDARY_IDS,
  semanticFingerprint,
  type DurableCrashPhase,
  type FullDurableBoundaryId
} from "@verchestra/application";
import { probeRootFacts } from "@verchestra/self-test";

import { runFullWorkflowScenario } from "./self-test-full-scenario.ts";

interface ChildInput {
  readonly root: string;
  readonly boundaryId: FullDurableBoundaryId;
  readonly phase: DurableCrashPhase;
  readonly factsPath: string;
  readonly mode: "crash" | "resume";
}

interface BoundaryState {
  readonly completed: readonly FullDurableBoundaryId[];
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function input(): ChildInput {
  const phase = argument("--phase");
  const mode = argument("--mode");
  const boundaryId = argument("--boundary");
  if (!(phase === "before" || phase === "after")) throw new Error("Invalid crash phase");
  if (!(mode === "crash" || mode === "resume")) throw new Error("Invalid child mode");
  if (!FULL_DURABLE_BOUNDARY_IDS.includes(boundaryId as FullDurableBoundaryId))
    throw new Error("Invalid durable boundary");
  if (process.env["VERCHESTRA_SELF_TEST"] !== "1") throw new Error("Self-Test child authority is missing");
  return {
    root: argument("--root"),
    boundaryId: boundaryId as FullDurableBoundaryId,
    phase,
    factsPath: argument("--facts"),
    mode
  };
}

async function readState(path: string): Promise<BoundaryState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { readonly completed?: unknown };
    if (!Array.isArray(value.completed) || value.completed.some((entry) => typeof entry !== "string"))
      throw new Error("Invalid boundary state");
    return { completed: value.completed as FullDurableBoundaryId[] };
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
    return { completed: [] };
  }
}

async function writeState(path: string, state: BoundaryState): Promise<void> {
  const staging = `${path}.${process.pid}.tmp`;
  await writeFile(staging, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  await rename(staging, path);
}

const childInput = input();
const statePath = join(
  childInput.root,
  ".verchestra-self-test-crash",
  `${childInput.boundaryId}-${childInput.phase}.state.json`
);
let state = await readState(statePath);

const result = await runFullWorkflowScenario(await probeRootFacts(childInput.root), {
  before: async (boundaryId) => {
    if (
      childInput.mode === "crash" &&
      childInput.phase === "before" &&
      boundaryId === childInput.boundaryId &&
      !state.completed.includes(boundaryId)
    )
      process.exit(86);
  },
  after: async (boundaryId) => {
    if (!state.completed.includes(boundaryId)) {
      state = { completed: [...state.completed, boundaryId] };
      await writeState(statePath, state);
    }
    if (childInput.mode === "crash" && childInput.phase === "after" && boundaryId === childInput.boundaryId)
      process.exit(86);
  }
});

await writeFile(
  childInput.factsPath,
  JSON.stringify({
    boundaryId: childInput.boundaryId,
    phase: childInput.phase,
    logicalResultCount: state.completed.filter((entry) => entry === childInput.boundaryId).length,
    resumed: childInput.mode === "resume",
    semanticFingerprint: semanticFingerprint(result.facts.checks)
  }),
  { mode: 0o600 }
);
