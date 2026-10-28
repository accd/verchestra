import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscoveryRouter } from "../../packages/agent-runtime/src/discovery/discovery-router.ts";
import { parseMongoDbReadOperation } from "../../packages/data-probe/src/mongodb-adapter.ts";
import { ProhibitedContentScanner } from "../../packages/evidence/src/support-bundle/support-bundle.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { output } from "../helpers/discovery-fixture.mjs";
import { findCommand } from "../helpers/mongodb-probe-fixture.mjs";

// SonarCloud S7737 (T8): a parameter default that was an object literal is now
// a fresh object built at the call, a frozen constant, or a destructured
// option. These pin that every call still starts from its own budget and the
// same default limits.

test("each content scan starts a fresh node budget, so a reused scanner never accumulates", () => {
  const scanner = new ProhibitedContentScanner();
  // Arrays hold at most 100 entries, so the budget is filled with distinct
  // arrays of 100 strings: one node per array and one per string.
  const grid = (rows) => Array.from({ length: rows }, () => Array.from({ length: 100 }, () => "safe"));
  const wide = grid(60);
  scanner.assertSafe(wide);
  scanner.assertSafe(wide);
  assert.throws(() => scanner.assertSafe(grid(100)), {
    code: "VES_SUPPORT_CONTENT_PROHIBITED",
    message: "diagnostic content exceeds scanner bounds"
  });
});

test("each MongoDB command is preflighted from depth zero with a fresh node budget", () => {
  const options = {
    protectedRequestRef: request().operation.protectedRequestRef,
    parameterClassifications: ["internal"]
  };
  for (let index = 0; index < 600; index += 1) parseMongoDbReadOperation(findCommand(), options);
  let deep = { $param: 0 };
  for (let level = 0; level < 17; level += 1) deep = { nested: deep };
  assert.throws(() => parseMongoDbReadOperation(findCommand({ filter: deep }), options), {
    code: "VES_MONGODB_COMMAND_INVALID",
    message: "MongoDB command exceeds structural bounds"
  });
});

test("a discovery router built without limits keeps the default content bound", () => {
  const sized = (bytes) => output({ evidence: [{ ...output().evidence[0], content: "x".repeat(bytes) }] });
  assert.equal(new DiscoveryRouter().normalize(sized(1_000)).evidence.length, 1);
  assert.throws(() => new DiscoveryRouter().normalize(sized(1_000_001)), { code: "VES_DISCOVERY_OUTPUT_LIMIT" });
});
