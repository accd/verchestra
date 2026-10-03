// invariant: the Codex client cannot send a method outside its allowlist
// (SSI-57, TM-006). The driver writes to its App Server in one place, through
// codexWireFrame, which refuses any method not on CODEX_CLIENT_METHODS; every
// method the driver names is a literal on that list; and no product source
// spells a method that buys, consumes, or advertises credits, or logs in.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CODEX_CLIENT_METHODS } from "../../packages/drivers/src/codex-driver.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const DRIVER = "packages/drivers/src/codex-driver.ts";
const DENIED = [
  "account/rateLimitResetCredit/consume",
  "account/sendAddCreditsNudgeEmail",
  "account/login",
  "account/logout",
  "account/bedrock/setup"
];

// why: a comment may name a method to explain the allowlist; only code counts.
const code = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:ts|mjs)$/u.test(entry.name) ? [path] : [];
  });
}

const driver = code(readFileSync(join(repositoryRoot, DRIVER), "utf8"));

test("the Codex driver writes to its App Server in one place, and only a frame codexWireFrame made", () => {
  const writes = [...driver.matchAll(/channel\.write\(([^)]*)\)/gu)].map((match) => match[1].trim());
  assert.deepEqual(writes, ["frame"]);
  assert.match(driver, /frame = codexWireFrame\(message\);/u);
  assert.equal([...driver.matchAll(/channel\.end\(/gu)].length, 0, "the App Server input is never ended with a frame");
});

test("every method the Codex driver names is a literal on the allowlist", () => {
  const calls = [...driver.matchAll(/\b(rpc|notify)\(([^,)]*)/gu)].map((match) => match[2].trim());
  assert.ok(calls.length >= 7, `only ${calls.length} method calls were found`);
  for (const argument of calls) {
    if (argument === "method") continue;
    const literal = /^"([^"]+)"$/u.exec(argument)?.[1];
    assert.ok(literal !== undefined, `a method is named by ${argument}, not by a literal`);
    assert.ok(CODEX_CLIENT_METHODS.includes(literal), `${literal} is not on the allowlist`);
  }
});

test("no product source spells a method that buys, consumes, or advertises credits, or logs in", () => {
  const offenders = ["packages", "apps"]
    .flatMap((root) => sources(join(repositoryRoot, root)))
    .map((path) => ({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: code(readFileSync(path, "utf8"))
    }))
    .filter(({ path }) => /^(?:packages|apps)\/[^/]+\/src\//u.test(path))
    .flatMap(({ path, source }) =>
      DENIED.filter((method) => source.includes(method)).map((method) => `${path}: ${method}`)
    );
  assert.deepEqual(offenders, []);
});
