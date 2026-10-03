// invariant: the framed Driver protocol of T33 has no production caller. It
// lives in packages/drivers/src/driver-framed-protocol.ts, outside the
// package's entry, and its two suites are its only importers. A source that
// starts to use it, or an entry that exports it again, is a decision about
// running a driver behind a framed transport, not a refactor.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const MODULE = "packages/drivers/src/driver-framed-protocol.ts";
const ENTRY = "packages/drivers/src/index.ts";
const SUITES = Object.freeze([
  "tests/contract/driver-protocol.test.mjs",
  "tests/fault-injection/driver-supervisor-faults.test.mjs"
]);
const NAMES = Object.freeze([
  "BoundedDriverEventQueue",
  "DriverFrameDecoder",
  "DriverProtocolEnvelope",
  "DriverSequenceGuard",
  "DriverSupervisor",
  "FramedDriverHostAdapter",
  "encodeDriverFrame",
  "escalateDriverCancellation",
  "negotiateDriverHandshake"
]);

// why: a comment may name the protocol to explain a decision; only code counts.
const code = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");

function sources(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path, extension);
    return extension.test(entry.name) ? [path] : [];
  });
}

const read = (roots, extension) =>
  roots
    .flatMap((root) => sources(join(repositoryRoot, root), extension))
    .map((path) => ({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      source: code(readFileSync(path, "utf8"))
    }));
const importsModule = ({ source }) => /["'][^"']*driver-framed-protocol(?:\.ts)?["']/u.test(source);

test("the module holds the framed protocol and the package's entry neither holds nor exports it", () => {
  const module = code(readFileSync(join(repositoryRoot, MODULE), "utf8"));
  const entry = code(readFileSync(join(repositoryRoot, ENTRY), "utf8"));
  for (const name of NAMES) {
    assert.match(module, new RegExp(`export (?:async )?(?:class|function|interface) ${name}\\b`, "u"), name);
    assert.doesNotMatch(entry, new RegExp(`\\b${name}\\b`, "u"), `${ENTRY} still names ${name}`);
  }
  assert.equal(importsModule({ source: entry }), false, `${ENTRY} reaches the framed protocol`);
});

test("no product source imports the framed protocol", () => {
  const importers = read(["packages", "apps"], /\.(?:ts|mjs)$/u)
    .filter((entry) => entry.path !== MODULE && importsModule(entry))
    .map(({ path }) => path);
  assert.deepEqual(importers, []);
});

test("the framed protocol's only importers are its two suites", () => {
  const importers = read(["tests", "spikes", "scripts"], /\.(?:ts|mjs)$/u)
    .filter((entry) => importsModule(entry) && entry.path !== "tests/architecture/driver-framed-protocol.test.mjs")
    .map(({ path }) => path)
    .sort((left, right) => Number(left > right) - Number(left < right));
  assert.deepEqual(importers, [...SUITES]);
});
