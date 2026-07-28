#!/usr/bin/env node

import { compileAgentContext } from "./agent-readiness.mjs";

const snapshot = await compileAgentContext();
if (process.argv.slice(2).includes("--json")) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `${snapshot.repository} ${snapshot.version}`,
      `revision: ${snapshot.revision}`,
      `branch: ${snapshot.branch ?? "(detached or unavailable)"}`,
      `worktree: ${snapshot.dirty ? "dirty" : "clean"}`,
      `qualification: T${snapshot.qualification.highestVerifiedTask} complete; ${snapshot.qualification.nextTask} next`,
      "required reads:",
      ...snapshot.requiredReads.map((path) => `  - ${path}`),
      "active features:",
      ...(snapshot.activeFeatures.length === 0
        ? ["  - none"]
        : snapshot.activeFeatures.map(
            (feature) => `  - ${feature.slug}: ${feature.status}; next ${feature.nextTask} (${feature.handoffPath})`
          )),
      "gates:",
      ...Object.entries(snapshot.gates).map(([name, command]) => `  - ${name}: ${command}`)
    ].join("\n") + "\n"
  );
}
