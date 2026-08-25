import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalizeJsonV2, dropUndefinedMembers } from "../../packages/domain/src/index.ts";

test("an undefined object member is dropped so the encoder accepts the value", () => {
  const material = { kept: 1, absent: undefined };
  assert.throws(() => canonicalizeJsonV2(material));
  assert.equal(canonicalizeJsonV2(dropUndefinedMembers(material)), '{"kept":1}');
});

test("the drop reaches nested objects and objects inside arrays", () => {
  const material = { outer: { absent: undefined, kept: "a" }, list: [{ absent: undefined, kept: "b" }] };
  assert.equal(canonicalizeJsonV2(dropUndefinedMembers(material)), '{"list":[{"kept":"b"}],"outer":{"kept":"a"}}');
});

test("an undefined array element is preserved, not dropped, so array identity fails closed", () => {
  assert.throws(() => canonicalizeJsonV2(dropUndefinedMembers([1, undefined, 2])));
});

test("only undefined is dropped: null, non-finite numbers, and functions keep their existing behavior", () => {
  assert.equal(canonicalizeJsonV2(dropUndefinedMembers({ nulled: null })), '{"nulled":null}');
  assert.throws(() => canonicalizeJsonV2(dropUndefinedMembers({ broken: Number.NaN })));
  assert.throws(() => canonicalizeJsonV2(dropUndefinedMembers({ broken: () => undefined })));
});

test("dropping is deterministic and does not mutate the caller's value", () => {
  const material = Object.freeze({ b: undefined, a: 1 });
  assert.equal(canonicalizeJsonV2(dropUndefinedMembers(material)), '{"a":1}');
  assert.equal(Object.hasOwn(material, "b"), true);
});
