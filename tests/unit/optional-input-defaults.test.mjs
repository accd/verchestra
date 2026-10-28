import assert from "node:assert/strict";
import { test } from "node:test";

import { editManagedGitignore, MANAGED_GITIGNORE_LINES } from "../../packages/workspace/src/init/managed-gitignore.ts";
import { SafeInitService } from "../../packages/workspace/src/init/safe-init.ts";

// SonarCloud S7760, S7744 (T8): the managed gitignore edit takes its empty
// default as a default parameter, and safe init spreads its optional hooks
// without an empty-object fallback. These pin that a missing input still
// behaves as the empty one.

const block = `${MANAGED_GITIGNORE_LINES.join("\n")}\n`;

test("a missing gitignore edits exactly as an empty one", () => {
  const expected = { changed: true, content: block, newline: "lf" };
  assert.deepEqual(editManagedGitignore(undefined), expected);
  assert.deepEqual(editManagedGitignore(), expected);
  assert.deepEqual(editManagedGitignore(""), expected);
  assert.deepEqual(editManagedGitignore("dist/\n"), { changed: true, content: `dist/\n${block}`, newline: "lf" });
  assert.throws(() => editManagedGitignore("a\0b"), { code: "VES_INIT_GITIGNORE_AMBIGUOUS" });
});

test("safe init accepts absent, undefined, null, or given hooks", () => {
  for (const options of [undefined, {}, { hooks: undefined }, { hooks: null }, { hooks: { afterStage: () => {} } }]) {
    assert.ok(new SafeInitService(options) instanceof SafeInitService);
  }
});
