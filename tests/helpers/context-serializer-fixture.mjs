import { DeterministicContextCompiler } from "../../packages/agent-runtime/src/index.ts";
import { compileInput, compilerFixture, snapshotFixture } from "./context-compiler-fixture.mjs";

export const targets = ["pi", "claude-code", "codex", "opencode"];

export async function manifestFixture(options = {}) {
  const base = await snapshotFixture(options);
  const manifest = await new DeterministicContextCompiler(compilerFixture()).compile(
    compileInput(base.inputRecipe, base.snapshot)
  );
  return manifest;
}

export function serializerFixture(overrides = {}) {
  const estimates = [];
  return {
    estimate: {
      estimate(target, serialized) {
        estimates.push({ target, serialized });
        return Math.ceil(JSON.stringify(serialized).length / 4);
      }
    },
    estimates,
    ...overrides
  };
}
