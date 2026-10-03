// invariant: the one task-path rule, proven at its interface. Every stage of
// the task path asks this module, so a case here is a case for the bridge, the
// executor, the worktree tool, the Git adapters, the gate, and the verifier.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import {
  isProtectedTaskPath,
  isTaskPath,
  isWithinTaskPath,
  isWithinTaskScope,
  LogicalPath,
  namesGitMetadata,
  taskPathSegments,
  taskPathsOverlap
} from "../../packages/domain/src/index.ts";

// why: `.` and the separator spellings are task paths because the schema
// admits them; every comparison below reads them by what they name. A Unicode
// lookalike of `src` or `.git`, and a letter whose lower case is ASCII, are
// not, so case folding never reaches a non-ASCII letter.
const GRAMMAR = [
  ["src/a.ts", true],
  ["src", true],
  ["a-b_c@d+e.f", true],
  ["...", true],
  [".git", true],
  [".", true],
  ["./src", true],
  ["src/", true],
  ["src//a", true],
  ["src/./a", true],
  ["", false],
  ["/", false],
  ["/etc/passwd", false],
  ["/absolute", false],
  ["..", false],
  ["../x", false],
  ["../outside", false],
  ["src/..", false],
  ["src/../x", false],
  ["src/../docs/secret.txt", false],
  ["src/../../escape.txt", false],
  ["C:/x", false],
  ["C:/outside", false],
  ["C:/windows/x", false],
  ["src\\a", false],
  ["src\\..\\x", false],
  ["a b", false],
  ["a\tb", false],
  ["a\u0000b", false],
  ["\u0455rc", false],
  ["\uff53rc", false],
  [".g\u0131t", false],
  [".G\u0130T", false],
  ["\u212Aey", false],
  ["caf\u00e9", false],
  ["src/\ud83d\ude00", false],
  [7, false],
  [undefined, false],
  [null, false],
  [["src"], false]
];

for (const [value, expected] of GRAMMAR)
  test(`grammar: ${JSON.stringify(value)} is ${expected ? "" : "not "}a task path`, () => {
    assert.equal(isTaskPath(value), expected);
  });

const SEGMENTS = [
  [".", []],
  ["./", []],
  ["src", ["src"]],
  ["src/", ["src"]],
  ["./src//a/./b/", ["src", "a", "b"]],
  ["...", ["..."]],
  ["SRC/A", ["SRC", "A"]]
];

for (const [path, expected] of SEGMENTS)
  test(`a task path names its segments: ${JSON.stringify(path)}`, () => {
    assert.deepEqual(taskPathSegments(path), expected);
  });

// invariant: containment compares what both paths name, in the letter case
// the entry is written; rows are [path, entry, within].
const CONTAINMENT = [
  ["src/a.ts", "src", true],
  ["src", "src", true],
  ["src/a/b", "src/a", true],
  ["srcx/a", "src", false],
  ["packages/application/src/executionish/file.ts", "packages/application/src/execution", false],
  ["src", "src/a", false],
  ["docs/x", "src", false],
  ["anything/at/all", ".", true],
  [".", ".", true],
  [".", "src", false],
  ["src/a", "src/", true],
  ["src/a", "./src", true],
  ["src/a", "src//", true],
  ["src/./a", "src", true],
  ["SRC/a", "src", false],
  ["src/a", "SRC", false],
  ["CLI.js", "cli.js", false],
  ["cli.js", "cli.js", true]
];

for (const [path, entry, expected] of CONTAINMENT)
  test(`containment: ${JSON.stringify(path)} is ${expected ? "" : "not "}within ${JSON.stringify(entry)}`, () => {
    assert.equal(isWithinTaskPath(path, entry), expected);
  });

test("scope: a path is in scope when one entry contains it, and an empty scope holds nothing", () => {
  const scope = ["src", "cli.js"];
  assert.equal(isWithinTaskScope("src/a.ts", scope), true);
  assert.equal(isWithinTaskScope("cli.js", scope), true);
  assert.equal(isWithinTaskScope("CLI.js", scope), false);
  assert.equal(isWithinTaskScope("docs/x", scope), false);
  assert.equal(isWithinTaskScope("src/a.ts", []), false);
});

// invariant: a protected entry protects what it names in every letter case and
// every spelling; rows are [path, protected entries, protected].
const PROTECTED = [
  [".verchestra/policy.json", [".verchestra"], true],
  [".VERCHESTRA/x", [".verchestra"], true],
  [".Verchestra", [".verchestra"], true],
  [".Verchestra/Policy/x", [".verchestra/policy"], true],
  [".git/config", [".git", ".verchestra/policy"], true],
  ["src/Protected/key.txt", [".git", "src/protected"], true],
  ["src/generated/out.js", ["src/Generated"], true],
  ["src/LOCKED.json", ["src/locked.json"], true],
  ["src/Protected/config.json", ["src/protected"], true],
  ["src/vendor/lib.js", ["src/vendor/"], true],
  ["src/vendor/lib.js", ["./src//vendor"], true],
  ["src/vendor/lib.js", ["src/./vendor"], true],
  ["src/./vendor/lib.js", ["src/vendor"], true],
  ["src//vendor/lib.js", ["src/vendor"], true],
  ["anything", ["."], true],
  ["src/vendorx/a", ["src/vendor"], false],
  ["src", ["src/vendor"], false],
  ["src/value.txt", [".git", ".verchestra", "src/protected"], false],
  ["src/a", [], false]
];

for (const [path, entries, expected] of PROTECTED)
  test(`protected: ${JSON.stringify(path)} is ${expected ? "" : "not "}protected by ${JSON.stringify(entries)}`, () => {
    assert.equal(isProtectedTaskPath(path, entries), expected);
  });

const GIT_METADATA = [
  [".git", true],
  [".git/config", true],
  ["src/.git/config", true],
  ["src/.GIT/config", true],
  [".Git/", true],
  ["x/.gIt", true],
  ["./.git/HEAD", true],
  [".github/workflows/ci.yml", false],
  [".gitignore", false],
  ["git", false],
  ["src/.git.bak", false]
];

for (const [path, expected] of GIT_METADATA)
  test(`Git metadata: ${JSON.stringify(path)} ${expected ? "names" : "does not name"} Git metadata`, () => {
    assert.equal(namesGitMetadata(path), expected);
  });

// invariant: overlap is answered for the worse, so a case variant of a scope
// entry overlaps it; rows are [left, right, overlap].
const OVERLAP = [
  ["src", "src/a", true],
  ["src/a", "src", true],
  ["src", "SRC", true],
  ["Src/A", "src/a/b", true],
  ["src/", "./src", true],
  [".", "anything", true],
  ["src", "srcx", false],
  ["src/a", "src/b", false]
];

for (const [left, right, expected] of OVERLAP)
  test(`overlap: ${JSON.stringify(left)} and ${JSON.stringify(right)} ${expected ? "overlap" : "are disjoint"}`, () => {
    assert.equal(taskPathsOverlap(left, right), expected);
  });

function* strings(alphabet, maximumLength) {
  let level = [""];
  yield "";
  for (let length = 1; length <= maximumLength; length += 1) {
    const next = [];
    for (const prefix of level)
      for (const character of alphabet) {
        next.push(prefix + character);
        yield prefix + character;
      }
    level = next;
  }
}

const schema = JSON.parse(
  await readFile(new URL("../../schemas/task-request/1.schema.json", import.meta.url), "utf8")
).properties;

// why: the schema's patterns are applied only here, to short generated
// inputs; product code checks a task path with the linear scan.
test("the grammar accepts exactly what the task request schema accepts for every path field", () => {
  const scope = schema.task.properties.changeScope.items.pattern;
  assert.equal(schema.task.properties.protectedPaths.items.pattern, scope);
  const patterns = [new RegExp(scope, "u"), new RegExp(schema.gates.items.properties.cwd.pattern, "u")];
  let compared = 0;
  for (const value of strings(["a", "G", ".", "/", "\\", ":", "-", "\u00e9"], 6)) {
    for (const pattern of patterns) assert.equal(isTaskPath(value), pattern.test(value), JSON.stringify(value));
    compared += 1;
  }
  assert.equal(compared, 299_593);
});

test("an overlong path and a long run of separators are decided in bounded time", () => {
  const run = "/".repeat(100_000);
  const long = `${"a/".repeat(50_000)}b`;
  const started = performance.now();
  assert.equal(isTaskPath(`a${run}b`), true);
  assert.equal(isTaskPath(`a${run}!`), false);
  assert.equal(isTaskPath(`${"a/".repeat(50_000)}..`), false);
  assert.equal(isTaskPath(`${"a/".repeat(50_000)}\\`), false);
  assert.equal(isTaskPath(long), true);
  assert.deepEqual(taskPathSegments(`a${run}b`), ["a", "b"]);
  assert.equal(isWithinTaskPath(long, "a"), true);
  assert.equal(isProtectedTaskPath(`A${run}B`, ["a/b"]), true);
  assert.equal(namesGitMetadata(`${"a/".repeat(50_000)}.GIT`), true);
  assert.equal(taskPathsOverlap(long, `${"A/".repeat(50_000)}B`), true);
  assert.ok(performance.now() - started < 1_000, "task-path decisions must stay linear");
});

// why: the domain's LogicalPath is a different rule, not a stricter spelling
// of this one; each admits paths the other refuses, so they are not merged.
test("the task-path grammar and LogicalPath are different rules, neither containing the other", () => {
  const logicalPath = (value) => {
    try {
      LogicalPath.parse(value);
      return true;
    } catch {
      return false;
    }
  };
  for (const value of [".", "src/", "src//a", "src/a.", "aux.c"]) {
    assert.equal(isTaskPath(value), true, value);
    assert.equal(logicalPath(value), false, value);
  }
  for (const value of ["a b", "café", "notes#1"]) {
    assert.equal(isTaskPath(value), false, value);
    assert.equal(logicalPath(value), true, value);
  }
});
