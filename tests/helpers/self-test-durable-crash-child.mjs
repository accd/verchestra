import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function args() {
  const result = {};
  for (let index = 2; index < process.argv.length; index += 2) result[process.argv[index]] = process.argv[index + 1];
  return result;
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { logicalResultCount: 0 };
  }
}

const input = args();
const statePath = join(
  input["--root"],
  ".verchestra-self-test-crash",
  `${input["--boundary"]}-${input["--phase"]}.state.json`
);
const state = await readState(statePath);
const inheritedSyntheticMarker = process.env.VERCHESTRA_TEST_FORBIDDEN_MARKER !== undefined;

if (input["--mode"] === "crash" && input["--phase"] === "before") process.exit(86);

if (state.logicalResultCount === 0) {
  state.logicalResultCount = 1;
  await writeFile(statePath, JSON.stringify(state));
}

if (input["--mode"] === "crash" && input["--phase"] === "after") process.exit(86);

await writeFile(
  input["--facts"],
  JSON.stringify({
    boundaryId: input["--boundary"],
    phase: input["--phase"],
    logicalResultCount: state.logicalResultCount,
    resumed: input["--mode"] === "resume",
    semanticFingerprint: [
      "environment.clean:pass",
      `full.boundaries:${process.env.VERCHESTRA_SELF_TEST === "1" && !inheritedSyntheticMarker ? "pass" : "fail"}`
    ]
  })
);
