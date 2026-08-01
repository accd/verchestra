// Contract for the analyzer behind scripts/complexity.mjs: the pinned ESLint
// core `complexity` rule, `classic` variant. Every expected value below was
// recorded from the analyzer itself; if an ESLint upgrade changes counting
// semantics, this suite fails before the baseline silently shifts meaning.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { compareToBaseline, hotspotBaseline, scopeOf } from "../../scripts/complexity.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// The fixtures parse through the repository's own ESLint configuration so the
// contract binds the exact parser-and-rule stack the baseline is measured with.
async function complexityOf(code, variant = "classic") {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: resolve(ROOT, "eslint.config.mjs"),
    overrideConfig: [{ rules: { complexity: ["warn", { max: 0, variant }] } }],
    warnIgnored: false
  });
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, "packages/fixture.ts") });
  return result.messages
    .filter((message) => message.ruleId === "complexity")
    .map((message) => Number(message.message.match(/complexity of (\d+)/u)[1]));
}

const CLASSIC_FIXTURES = [
  ["a straight-line function counts 1", "function f(){ return 1; }", [1]],
  ["one if adds one path", "function f(a: number){ if(a) return 1; return 0; }", [2]],
  [
    "if / else if / else counts each decision",
    "function f(a: number){ if(a===1){return 1;} else if(a===2){return 2;} else {return 3;} }",
    [3]
  ],
  [
    "nesting does not multiply, each condition adds one",
    "function f(a: number, b: number){ if(a){ if(b){ return 1; } } return 0; }",
    [3]
  ],
  [
    "each switch case adds one, default does not",
    "function f(a: number){ switch(a){ case 1: return 1; case 2: return 2; case 3: return 3; default: return 0; } }",
    [4]
  ],
  ["a for loop adds one", "function f(n: number){ for(let i=0;i<n;i++){ n; } return n; }", [2]],
  ["a while loop adds one", "function f(n: number){ while(n>0){ n--; } return n; }", [2]],
  ["a catch clause adds one", "function f(){ try { return 1; } catch { return 0; } }", [2]],
  ["a ternary adds one", "function f(a: number){ return a ? 1 : 0; }", [2]],
  ["logical AND adds one", "function f(a: boolean, b: boolean){ return a && b; }", [2]],
  ["logical OR adds one", "function f(a: boolean, b: boolean){ return a || b; }", [2]],
  ["nullish coalescing adds one", "function f(a: number, b: number){ return a ?? b; }", [2]],
  ["each logical assignment adds one", "function f(a: number, b: number){ a ||= b; a &&= b; a ??= b; return a; }", [4]],
  ["each optional-chain link adds one", "function f(a: { b?: { c?: number } }){ return a?.b?.c; }", [3]],
  ["a default parameter adds one", "function f(a = 1){ return a; }", [2]],
  ["destructuring defaults each add one", "function f({a = 1} = {}){ return a; }", [3]],
  ["a class field initializer is its own code path", "const cond = true; class C { x = cond ? 1 : 0; }", [2]],
  ["a static block is its own code path", "class C { static { if (globalThis.crypto) { void 0; } } }", [2]],
  ["async functions count like synchronous ones", "async function f(a: number){ if(a) return 1; return 0; }", [2]],
  ["generator functions count like plain ones", "function* f(a: number){ if(a) yield 1; }", [2]],
  ["anonymous arrow functions are reported too", "export const g = (a: number) => a ? 1 : 0;", [2]]
];

for (const [name, code, expected] of CLASSIC_FIXTURES) {
  test(`classic variant: ${name}`, async () => {
    assert.deepEqual(await complexityOf(code), expected);
  });
}

test("the classic and modified variants disagree on switch, pinning the classic choice", async () => {
  const code =
    "function f(a: number){ switch(a){ case 1: return 1; case 2: return 2; case 3: return 3; default: return 0; } }";
  assert.deepEqual(await complexityOf(code, "classic"), [4]);
  assert.deepEqual(await complexityOf(code, "modified"), [2]);
});

test("the analyzer discriminates: adding one decision construct raises the measured value", async () => {
  const before = "function f(a: number, b: boolean){ if(a) return 1; return 0; }";
  const after = "function f(a: number, b: boolean){ if(a && b) return 1; return 0; }";
  const [beforeValue] = await complexityOf(before);
  const [afterValue] = await complexityOf(after);
  assert.equal(afterValue, beforeValue + 1);
});

test("scope classification separates production from tests and site sources", () => {
  assert.equal(scopeOf("packages/evidence/src/integrity/canonical.ts"), "packages-src");
  assert.equal(scopeOf("apps/vestra-cli/src/cli.ts"), "vestra-cli");
  assert.equal(scopeOf("apps/site/src/lib/repository-content.ts"), "site-src");
  assert.equal(scopeOf("scripts/gate.mjs"), "scripts");
  assert.equal(scopeOf("tests/unit/example.test.mjs"), "tests");
  assert.equal(scopeOf("packages/evidence/tests/example.test.mjs"), "tests");
  assert.equal(scopeOf("apps/site/tests/unit/example.test.mjs"), "site-tests");
});

test("the ratchet fails closed in every drift direction", () => {
  const baseline = { target: 10, variant: "classic", hotspots: { "packages/a/src/x.ts :: Function 'f'": [15] } };
  const same = { target: 10, variant: "classic", hotspots: { "packages/a/src/x.ts :: Function 'f'": [15] } };
  assert.deepEqual(compareToBaseline(same, baseline), []);

  const increased = { ...same, hotspots: { "packages/a/src/x.ts :: Function 'f'": [16] } };
  assert.match(compareToBaseline(increased, baseline)[0], /exceeds the baselined/u);

  const improved = { ...same, hotspots: { "packages/a/src/x.ts :: Function 'f'": [12] } };
  assert.match(compareToBaseline(improved, baseline)[0], /improved on the baselined/u);

  const gone = { ...same, hotspots: {} };
  assert.match(compareToBaseline(gone, baseline)[0], /no longer above 10/u);

  const newHotspot = { ...same, hotspots: { ...same.hotspots, "packages/a/src/y.ts :: Function 'g'": [11] } };
  assert.match(compareToBaseline(newHotspot, baseline)[0], /no baseline entry/u);

  const extraOccurrence = { ...same, hotspots: { "packages/a/src/x.ts :: Function 'f'": [15, 15] } };
  assert.match(compareToBaseline(extraOccurrence, baseline)[0], /exceeds the baselined/u);
});

test("the committed baseline is portable: relative forward-slash paths, sorted keys, no local directories", async () => {
  const raw = await readFile(new URL("../../complexity-baseline.json", import.meta.url), "utf8");
  const baseline = JSON.parse(raw);
  assert.equal(baseline.target, 10);
  assert.equal(baseline.variant, "classic");
  const keys = Object.keys(baseline.hotspots);
  assert.ok(keys.length > 0);
  assert.deepEqual(keys, [...keys].sort(), "keys must be deterministically ordered");
  for (const key of keys) {
    assert.doesNotMatch(key, /\\|^[A-Za-z]:|^\//u, `machine-local or absolute path in ${key}`);
    assert.match(key, /^(packages|apps|scripts)\/.* :: /u, `unexpected scope in ${key}`);
  }
});

test("the hotspot baseline keeps only production functions above the target, keyed without line numbers", () => {
  const entries = [
    { file: "packages/a/src/x.ts", symbol: "Function 'big'", line: 10, value: 15, scope: "packages-src" },
    { file: "packages/a/src/x.ts", symbol: "Arrow function", line: 20, value: 12, scope: "packages-src" },
    { file: "packages/a/src/x.ts", symbol: "Arrow function", line: 30, value: 11, scope: "packages-src" },
    { file: "packages/a/src/x.ts", symbol: "Function 'small'", line: 40, value: 10, scope: "packages-src" },
    { file: "tests/unit/y.test.mjs", symbol: "Function 'huge'", line: 1, value: 40, scope: "tests" }
  ];
  const baseline = hotspotBaseline(entries);
  assert.equal(baseline.target, 10);
  assert.equal(baseline.variant, "classic");
  assert.deepEqual(baseline.hotspots, {
    "packages/a/src/x.ts :: Arrow function": [11, 12],
    "packages/a/src/x.ts :: Function 'big'": [15]
  });
});
