// DETERMINISTIC FIXTURE - the owner's extra-usage confirmation (decision D3),
// written by a test in place of the owner's own statement. It names each
// provider's subscription method and states that extra usage is off; it holds
// nothing about any real account.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// why: the latest billing regime's start. A statement dated there is never in
// the future of a clock that runs this suite and never predates its regime.
export const CONFIRMED_AT = "2026-10-03T00:00:00.000Z";

export function extraUsageConfirmation(overrides = {}) {
  return {
    schemaVersion: 1,
    providers: {
      "claude-code": { auth: "subscription", extraUsage: "disabled", confirmedAt: CONFIRMED_AT },
      codex: { auth: "chatgpt", planType: "plus", extraUsage: "disabled", confirmedAt: CONFIRMED_AT },
      ...overrides
    }
  };
}

// why: the file sits beside `task-providers.json` in the Workspace's
// machine-local state root, where the owner writes it.
export async function confirmExtraUsage(workspaceRoot, value = extraUsageConfirmation()) {
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "task-billing.json"), typeof value === "string" ? value : JSON.stringify(value));
}
