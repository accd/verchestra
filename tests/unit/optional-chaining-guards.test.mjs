import assert from "node:assert/strict";
import { test } from "node:test";

import { meetsMinimum } from "../../packages/drivers/src/driver-version-probe.ts";

// SonarCloud S6582 (T8): `x === undefined || x.a !== y` became `x?.a !== y`
// only where `y` is always defined, so both forms agree. Where an input could
// carry an undefined field, the undefined guard became its own statement with
// the same failure instead. These pin the boundaries of one such split guard.

const VERSION = /(\d{1,9})\.(\d{1,9})\.(\d{1,9})/u;

test("a version meets a minimum only on its own major line at or above it", () => {
  assert.equal(meetsMinimum("2.1.0", "2.0.5", VERSION), true);
  assert.equal(meetsMinimum("2.0.5", "2.0.5", VERSION), true);
  assert.equal(meetsMinimum("2.0.4", "2.0.5", VERSION), false);
  assert.equal(meetsMinimum("3.0.0", "2.0.5", VERSION), false);
});

test("text that is not a version never meets a minimum, on either side", () => {
  assert.equal(meetsMinimum("unknown", "2.0.5", VERSION), false);
  assert.equal(meetsMinimum("2.0.5", "unknown", VERSION), false);
  assert.equal(meetsMinimum("unknown", "unknown", VERSION), false);
});
