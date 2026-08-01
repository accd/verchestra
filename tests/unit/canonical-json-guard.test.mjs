import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeJsonV2 } from "../../packages/domain/src/canonical/canonical-json.ts";
import { assertCanonicalJsonValue } from "../../packages/domain/src/canonical/canonical-guard.ts";

function rejects(value, code) {
  assert.throws(
    () => assertCanonicalJsonValue(value),
    (error) => error.code === code
  );
}

test("an object member value of undefined is rejected", () => {
  rejects({ a: undefined }, "VES_CANONICAL_UNDEFINED_VALUE");
});

test("an array element of undefined is rejected", () => {
  rejects([1, undefined, 2], "VES_CANONICAL_UNDEFINED_VALUE");
});

test("a sparse array is rejected", () => {
  const sparse = [1, 2];
  sparse[4] = 5;
  rejects(sparse, "VES_CANONICAL_SPARSE_ARRAY");
});

test("an accessor property is rejected", () => {
  const value = {};
  Object.defineProperty(value, "a", { enumerable: true, get: () => 1 });
  rejects(value, "VES_CANONICAL_ACCESSOR_PROPERTY");
});

test("a symbol key is rejected", () => {
  const value = { [Symbol("k")]: 1 };
  rejects(value, "VES_CANONICAL_SYMBOL_KEY");
});

test("a cyclic value is rejected", () => {
  const value = {};
  value.self = value;
  rejects(value, "VES_CANONICAL_CYCLIC_VALUE");
});

test("NaN is rejected as a non-finite number", () => {
  rejects({ a: Number.NaN }, "VES_CANONICAL_NON_FINITE_NUMBER");
});

test("Infinity is rejected as a non-finite number", () => {
  rejects({ a: Number.POSITIVE_INFINITY }, "VES_CANONICAL_NON_FINITE_NUMBER");
});

test("a non-plain prototype is rejected", () => {
  rejects({ a: new Date() }, "VES_CANONICAL_INVALID_PROTOTYPE");
});

test("an unpaired high surrogate is rejected as invalid Unicode", () => {
  rejects("\ud800", "VES_CANONICAL_INVALID_UNICODE");
});

test("an unpaired low surrogate is rejected as invalid Unicode", () => {
  rejects("\udc00", "VES_CANONICAL_INVALID_UNICODE");
});

test("depth beyond 128 is rejected with a resource limit", () => {
  let value = { leaf: true };
  for (let level = 0; level < 130; level += 1) value = { nested: value };
  rejects(value, "VES_CANONICAL_RESOURCE_LIMIT");
});

test("more than 100,000 nodes is rejected with a resource limit", () => {
  const value = { items: [] };
  for (let index = 0; index < 100_001; index += 1) value.items.push(index);
  rejects(value, "VES_CANONICAL_RESOURCE_LIMIT");
});

test("canonicalizeJsonV2 calls the guard before encoding", () => {
  assert.throws(
    () => canonicalizeJsonV2({ a: undefined }),
    (error) => error.code === "VES_CANONICAL_UNDEFINED_VALUE"
  );
});
