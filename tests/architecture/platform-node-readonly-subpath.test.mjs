import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// DDL-12 (#207): @verchestra/platform-node/readonly is the narrow entry point
// a live doctor probe (T12-T19) is allowed to import — the package root
// re-exports genuine writers (RuntimeStore, SecretBroker, and others), and
// widening the doctor's read-only import allowlist to the whole package would
// widen its reachable graph past what
// tests/architecture/doctor-readonly-graph.test.mjs proves is read-only.
// Proven statically: the subpath's own export list names only the two
// approved symbols, using named re-exports (never `export *`, which could
// silently admit a future writer added to either source file).

const source = readFileSync(new URL("../../packages/platform-node/src/readonly.ts", import.meta.url), "utf8");

const FORBIDDEN_SYMBOLS = Object.freeze([
  "RuntimeStore",
  "SecretBroker",
  "MockSecretAdapter",
  "QualifiedOsSecretAdapter",
  "RuntimeMachineProfileStore",
  "RuntimeSyncStateStore",
  "RuntimePolicyViewStore",
  "RuntimeAuthorityStore",
  "RuntimeLocalLease",
  "EncryptedFileKeyProvider"
]);

test("the readonly subpath exports no `export *` — every re-export is named", () => {
  assert.doesNotMatch(source, /export\s*\*/u, "readonly.ts must name every export explicitly, never `export *`");
});

test("the readonly subpath's export surface is exactly the approved read-only symbols", () => {
  const braceExports = [...source.matchAll(/export\s+(?:type\s+)?\{\s*([^}]+)\s*\}/gu)]
    .flatMap((match) => match[1].split(","))
    .map(
      (entry) =>
        entry
          .trim()
          .replace(/^type\s+/u, "")
          .split(/\s+as\s+/u)[0]
    )
    .filter((entry) => entry.length > 0);
  // A symbol may also be a function declared directly in this file (T10,
  // secretPresence), not only a re-export from another module.
  const declaredFunctionExports = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gu)].map(
    (match) => match[1]
  );
  const exported = [...braceExports, ...declaredFunctionExports];
  assert.deepEqual(
    [...exported].sort(),
    ["ProtectedPathBroker", "ProtectedPathHandle", "SecretAdapter", "inspectRuntimeDatabase", "secretPresence"].sort()
  );
});

test("the readonly subpath names no writer adapter", () => {
  for (const forbidden of FORBIDDEN_SYMBOLS)
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`, "u"), `readonly.ts must not reach ${forbidden}`);
});

test("the package declares the ./readonly export subpath", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../packages/platform-node/package.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.exports["./readonly"], "./src/readonly.ts");
});
