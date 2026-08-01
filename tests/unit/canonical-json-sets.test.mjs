import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeJsonV2 } from "../../packages/domain/src/canonical/canonical-json.ts";
import { normalizeDeclaredSet } from "../../packages/domain/src/canonical/canonical-sets.ts";

test("normalizeDeclaredSet orders items by their extracted key", () => {
  const items = [{ id: "b" }, { id: "a" }, { id: "c" }];
  assert.deepEqual(
    normalizeDeclaredSet(items, (item) => item.id).map((item) => item.id),
    ["a", "b", "c"]
  );
});

test("normalizeDeclaredSet never mutates its input", () => {
  const items = [{ id: "b" }, { id: "a" }];
  const original = [...items];
  normalizeDeclaredSet(items, (item) => item.id);
  assert.deepEqual(items, original);
});

test("normalizeDeclaredSet returns a new array, not the same reference", () => {
  const items = [{ id: "a" }];
  assert.notEqual(
    normalizeDeclaredSet(items, (item) => item.id),
    items
  );
});

test("ordering is code-unit, not locale — a key pair whose localeCompare order differs from code-unit order", () => {
  // Code-unit: "B" (0x42) < "a" (0x61), so B sorts first.
  // Locale (en): localeCompare treats "a" as sorting before "B".
  assert.equal("B".localeCompare("a"), 1);
  assert.deepEqual(
    normalizeDeclaredSet(["a", "B"], (item) => item),
    ["B", "a"]
  );
});

test("an empty collection normalizes to an empty array", () => {
  assert.deepEqual(
    normalizeDeclaredSet([], (item) => item),
    []
  );
});

test("normalizing an already-sorted collection is idempotent", () => {
  const sorted = normalizeDeclaredSet(["a", "b", "c"], (item) => item);
  assert.deepEqual(
    normalizeDeclaredSet(sorted, (item) => item),
    sorted
  );
});

test("a sequence left un-normalized keeps its input order through canonicalizeJsonV2", () => {
  assert.equal(canonicalizeJsonV2({ items: ["b", "a", "c"] }), '{"items":["b","a","c"]}');
});

test("a collection normalized as a declared set produces order-independent canonical bytes", () => {
  const key = (item) => item;
  const first = normalizeDeclaredSet(["b", "a", "c"], key);
  const second = normalizeDeclaredSet(["c", "b", "a"], key);
  assert.equal(canonicalizeJsonV2({ items: first }), canonicalizeJsonV2({ items: second }));
});
