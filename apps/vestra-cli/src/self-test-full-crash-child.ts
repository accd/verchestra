import { writeFile } from "node:fs/promises";

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

const childInput = input();
const result = await runFullWorkflowScenario(await probeRootFacts(childInput.root), {
  before: async (boundaryId) => {
    if (childInput.mode === "crash" && childInput.phase === "before" && boundaryId === childInput.boundaryId)
      process.exit(86);
  },
  after: async (boundaryId) => {
    if (childInput.mode === "crash" && childInput.phase === "after" && boundaryId === childInput.boundaryId)
      process.exit(86);
  }
});
const outcome = result.durableOutcomes.find(({ boundaryId }) => boundaryId === childInput.boundaryId);
if (outcome === undefined) throw new Error("Durable boundary outcome was not recovered");

await writeFile(
  childInput.factsPath,
  JSON.stringify({
    ...outcome,
    phase: childInput.phase,
    resumed: childInput.mode === "resume",
    semanticFingerprint: semanticFingerprint(result.facts.checks)
  }),
  { mode: 0o600 }
);
