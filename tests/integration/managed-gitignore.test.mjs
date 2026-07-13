import assert from "node:assert/strict";
import { test } from "node:test";

import { MANAGED_GITIGNORE_LINES, editManagedGitignore } from "../../packages/workspace/src/index.ts";

const lfBlock = `${MANAGED_GITIGNORE_LINES.join("\n")}\n`;

test("absent .gitignore becomes the minimal managed block", () => {
  assert.deepEqual(editManagedGitignore(undefined), { changed: true, content: lfBlock, newline: "lf" });
});

test("empty .gitignore becomes the minimal managed block", () => {
  assert.deepEqual(editManagedGitignore(""), { changed: true, content: lfBlock, newline: "lf" });
});

test("managed block appends after an existing final newline", () => {
  const original = "dist/\n.env\n";
  assert.equal(editManagedGitignore(original).content, `${original}${lfBlock}`);
});

test("managed block adds one separator newline without changing user text", () => {
  assert.equal(editManagedGitignore("dist/").content, `dist/\n${lfBlock}`);
});

test("CRLF files receive a CRLF managed block", () => {
  const result = editManagedGitignore("dist/\r\n.env\r\n");
  assert.equal(result.newline, "crlf");
  assert.equal(result.content, `dist/\r\n.env\r\n${MANAGED_GITIGNORE_LINES.join("\r\n")}\r\n`);
});

test("outdated single managed block is replaced in place", () => {
  const original = "before\n# >>> verchestra managed: local safety fallback\n.old/\n# <<< verchestra managed\nafter\n";
  assert.equal(editManagedGitignore(original).content, `before\n${lfBlock}after\n`);
});

test("current managed block is an exact no-op", () => {
  const original = `before\n${lfBlock}after\n`;
  assert.deepEqual(editManagedGitignore(original), { changed: false, content: original, newline: "lf" });
});

test("duplicate managed blocks fail without choosing one", () => {
  assert.throws(() => editManagedGitignore(`${lfBlock}${lfBlock}`), { code: "VES_INIT_GITIGNORE_AMBIGUOUS" });
});

test("unterminated managed block fails without deleting user rules", () => {
  assert.throws(() => editManagedGitignore("user-rule\n# >>> verchestra managed: local safety fallback\n.local/\n"), {
    code: "VES_INIT_GITIGNORE_AMBIGUOUS"
  });
});

test("unexpected closing delimiter fails closed", () => {
  assert.throws(() => editManagedGitignore("user-rule\n# <<< verchestra managed\n"), {
    code: "VES_INIT_GITIGNORE_AMBIGUOUS"
  });
});

test("managed rules contain no broad canonical-artifact or secret pattern", () => {
  for (const forbidden of [".verchestra/", ".specs/", "*.json", "*.db", ".env*"]) {
    assert.equal(MANAGED_GITIGNORE_LINES.includes(forbidden), false);
  }
  assert.deepEqual(MANAGED_GITIGNORE_LINES, [
    "# >>> verchestra managed: local safety fallback",
    ".verchestra/.local/",
    ".verchestra/.runtime/",
    ".verchestra/.cache/",
    ".verchestra/.sessions/",
    ".verchestra/.worktrees/",
    ".verchestra/.secrets/",
    "# <<< verchestra managed"
  ]);
});

test("user negation, comments, blanks, and broad personal rules remain byte-identical", () => {
  const original = "# user\n.verchestra/\n!.verchestra/workspace.yaml\n\ncustom/**\n";
  const edited = editManagedGitignore(original).content;
  assert.equal(edited.slice(0, original.length), original);
});

test("mixed newline input is rejected instead of normalized", () => {
  assert.throws(() => editManagedGitignore("first\r\nsecond\n"), { code: "VES_INIT_GITIGNORE_NEWLINE_AMBIGUOUS" });
});
