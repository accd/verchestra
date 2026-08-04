import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FULL_DURABLE_BOUNDARY_IDS,
  semanticFingerprint,
  type DurableCrashPhase,
  type FullDurableBoundaryId
} from "@verchestra/application";
import { FileRecordStore, probeRootFacts } from "@verchestra/self-test";

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
const recordStore = new FileRecordStore({
  root: join(childInput.root, ".verchestra-self-test-crash", "durable-boundaries")
});
const recordKey = `boundary:${childInput.boundaryId}`;
const existing = await recordStore.load<{ readonly boundaryId: FullDurableBoundaryId; readonly logicalId: string }>(
  recordKey
);

const result = await runFullWorkflowScenario(await probeRootFacts(childInput.root), {
  before: async (boundaryId) => {
    if (
      childInput.mode === "crash" &&
      childInput.phase === "before" &&
      boundaryId === childInput.boundaryId &&
      existing === undefined
    )
      process.exit(86);
  },
  after: async (boundaryId) => {
    await recordStore.save(`boundary:${boundaryId}`, { boundaryId, logicalId: `self-test:${boundaryId}` });
    if (childInput.mode === "crash" && childInput.phase === "after" && boundaryId === childInput.boundaryId)
      process.exit(86);
  }
});

await writeFile(
  childInput.factsPath,
  JSON.stringify({
    boundaryId: childInput.boundaryId,
    phase: childInput.phase,
    logicalResultCount:
      (await recordStore.load<{ readonly boundaryId: FullDurableBoundaryId }>(recordKey))?.boundaryId ===
      childInput.boundaryId
        ? 1
        : 0,
    resumed: childInput.mode === "resume",
    semanticFingerprint: semanticFingerprint(result.facts.checks)
  }),
  { mode: 0o600 }
);
