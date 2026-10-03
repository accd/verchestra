// invariant: the Run record's readers return declared records (ADR2-9). The
// module declares a type for each artifact a command reads a member of and
// validates it as it is read, so no reader hands a command an untyped row and
// no command reads a member of one by name.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const taskRoot = fileURLToPath(new URL("../../apps/vestra-cli/src/task/", import.meta.url));

// why: a comment may name a member to explain a decision; only code counts.
function code(name) {
  return readFileSync(join(taskRoot, name), "utf8")
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

const owner = code("task-run-record.ts");

test("each reader of the Run record returns its declared record, never a row", () => {
  for (const [reader, type] of [
    ["loadGrant", "GrantMarker"],
    ["loadOutcome", "OutcomeMarker"],
    ["loadReport", "VerificationReportRecord"],
    ["loadReview", "HumanReviewRecord"],
    ["loadCommit", "TaskRunCommit"],
    ["loadCoordinationLedger", "CoordinationLedger"]
  ])
    assert.match(owner, new RegExp(`\\b${reader}\\(\\): Promise<${type} \\| undefined>`, "u"), reader);
  assert.match(owner, /\bverifiedCommit\(\): Promise<\{[^}]*\breport: VerificationReportRecord \}>/u);
  assert.doesNotMatch(
    owner,
    /^ {2}(?:async )?(?:load\w*|verifiedCommit|activeProcess)\([^)]*\)[^{]*\b(?:Row|Record<string, unknown>)\b/mu,
    "a reader returns an untyped row"
  );
});

test("no command reads a member of a Run record artifact by name", () => {
  const byName = /\[\s*["'`](?:grantId|verdict|outcome|reason|commitId|worktreeRef)["'`]\s*\]/u;
  for (const name of ["task-run.ts", "task-status.ts", "task-surface.ts", "task-review.ts"]) {
    const source = code(name);
    assert.match(source, /\brunRecord\b/u, `${name} was not scanned`);
    assert.doesNotMatch(source, byName, name);
  }
});
