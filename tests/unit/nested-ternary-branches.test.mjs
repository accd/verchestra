import assert from "node:assert/strict";
import { test } from "node:test";

import { IsoInstant } from "../../packages/domain/src/index.ts";
import { offlineGuard } from "../../packages/self-test/src/index.ts";

// SonarCloud S3358 (T8): nested conditional expressions became if/else
// chains, lookup tables, or subtraction comparators. These pin each branch of
// two of them so the flattening is shown to choose as before.

test("an instant compares as before, below, equal, and above", () => {
  const earlier = IsoInstant.parse("2026-10-28T09:00:00.000Z");
  const later = IsoInstant.parse("2026-10-28T09:00:00.001Z");
  assert.equal(earlier.compare(later), -1);
  assert.equal(later.compare(later), 0);
  assert.equal(later.compare(earlier), 1);
});

test("the offline guard names a fetch target by string, URL, or neither", async () => {
  const guard = offlineGuard();
  try {
    await assert.rejects(fetch("https://a.invalid/x"));
    await assert.rejects(fetch(new URL("https://b.invalid/y")));
    await assert.rejects(fetch(new Request("https://c.invalid/z")));
  } finally {
    guard.restore();
  }
  assert.deepEqual(
    guard.attempts().map((attempt) => attempt.target),
    ["https://a.invalid/x", "https://b.invalid/y", "unknown target"]
  );
});
