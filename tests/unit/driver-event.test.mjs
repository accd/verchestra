import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVER_EVENT_FIELDS,
  isDriverEventType,
  usageCount,
  usageUpdated
} from "../../packages/domain/src/driver-event/driver-event.ts";

// why: the Driver event module is asserted here at its interface: the field
// table, the event types, and the usage rule. That each driver reads its
// provider's counts through the rule is pinned by the usage axis of
// tests/contract/driver-lifecycle-matrix.test.mjs.

test("the field table names the eight event types a session reports, in the order a session reports them", () => {
  assert.deepEqual(Object.keys(DRIVER_EVENT_FIELDS), [
    "session.started",
    "model.resolved",
    "content.delta",
    "tool.requested",
    "usage.updated",
    "warning",
    "error",
    "session.closed"
  ]);
  assert.equal(Object.isFrozen(DRIVER_EVENT_FIELDS), true);
  for (const row of Object.values(DRIVER_EVENT_FIELDS)) assert.equal(Object.isFrozen(row), true);
});

test("every field has a kind the table declares, and no row names the type or the sequence", () => {
  const kinds = new Set(["text", "count", "flag", "value", "texts", "passport", "outcome"]);
  for (const [type, row] of Object.entries(DRIVER_EVENT_FIELDS)) {
    assert.equal(Object.hasOwn(row, "type"), false, type);
    assert.equal(Object.hasOwn(row, "sequence"), false, type);
    for (const [field, kind] of Object.entries(row))
      assert.equal(kinds.has(kind.replace(/\?$/u, "")), true, `${type}.${field} has the kind ${kind}`);
  }
});

test("the fields every driver sets and the fields only some set are the ones the drivers emit", () => {
  const always = (type) =>
    Object.entries(DRIVER_EVENT_FIELDS[type])
      .filter(([, kind]) => !kind.endsWith("?"))
      .map(([field]) => field);
  const sometimes = (type) =>
    Object.entries(DRIVER_EVENT_FIELDS[type])
      .filter(([, kind]) => kind.endsWith("?"))
      .map(([field]) => field);
  assert.deepEqual(always("usage.updated"), ["inputTokens", "outputTokens"]);
  assert.deepEqual(sometimes("usage.updated"), ["reasoningTokens", "cacheReadTokens", "cacheWriteTokens"]);
  assert.deepEqual(always("model.resolved"), ["passportRef"]);
  assert.deepEqual(sometimes("model.resolved"), ["provider", "api", "resolvedModel"]);
  assert.deepEqual(always("tool.requested"), ["toolCallId", "name", "input"]);
  assert.deepEqual(sometimes("tool.requested"), ["patterns"]);
  assert.deepEqual(always("error"), ["code", "message", "retryable"]);
  assert.deepEqual(always("session.closed"), ["outcome"]);
  assert.deepEqual(sometimes("session.closed"), ["reason"]);
});

test("an event type is one the table names, and nothing else", () => {
  for (const type of Object.keys(DRIVER_EVENT_FIELDS)) assert.equal(isDriverEventType(type), true, type);
  for (const value of ["", "other", "toString", "__proto__", "Session.Started", 5, undefined, null, {}])
    assert.equal(isDriverEventType(value), false, String(value));
});

// invariant: the usage rule, value by value. These are the readings the three
// drivers that checked usage before the rule existed already gave, so moving
// them onto the rule changed no event they emit.
const READINGS = [
  [12, 12],
  [0, 0],
  [-0, -0],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  [undefined, 0],
  [null, 0],
  ["12", 12],
  ["", 0],
  [" 7 ", 7],
  ["0x10", 16],
  ["1e2", 100],
  [true, 1],
  [false, 0],
  [[4], 4],
  [[], 0],
  [-1, undefined],
  [1.5, undefined],
  [Number.MAX_SAFE_INTEGER + 1, undefined],
  [Number.NaN, undefined],
  [Number.POSITIVE_INFINITY, undefined],
  ["many", undefined],
  [{}, undefined],
  [[1, 2], undefined]
];

const label = (value) => {
  if (Object.is(value, -0)) return "-0";
  return typeof value === "string" || typeof value === "object" ? JSON.stringify(value) : String(value);
};

for (const [reported, read] of READINGS)
  test(`the usage rule reads ${label(reported)} as ${label(read)}`, () => {
    assert.equal(Object.is(usageCount(reported), read), true, `read ${String(usageCount(reported))}`);
  });

test("the usage event carries the type and the two counts, in that order, and nothing else", () => {
  const event = usageUpdated({ inputTokens: "9", outputTokens: undefined });
  assert.deepEqual(Object.keys(event), ["type", "inputTokens", "outputTokens"]);
  assert.deepEqual(event, { type: "usage.updated", inputTokens: 9, outputTokens: 0 });
});

test("the usage event is refused when either count fails the rule", () => {
  assert.equal(usageUpdated({ inputTokens: -1, outputTokens: 1 }), undefined);
  assert.equal(usageUpdated({ inputTokens: 1, outputTokens: 1.5 }), undefined);
  assert.equal(usageUpdated({ inputTokens: "many", outputTokens: "many" }), undefined);
});
