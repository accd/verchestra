import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRIVER_EVENT_FIELDS,
  isDriverEventType,
  quotaExhausted,
  resultStructured,
  usageCount,
  usageUpdated
} from "../../packages/domain/src/driver-event/driver-event.ts";

// why: the Driver event module is asserted here at its interface: the field
// table, the event types, and the usage rule. That each driver reads its
// provider's counts through the rule is pinned by the usage axis of
// tests/contract/driver-lifecycle-matrix.test.mjs.

test("the field table names the ten event types a session reports, in the order a session reports them", () => {
  assert.deepEqual(Object.keys(DRIVER_EVENT_FIELDS), [
    "session.started",
    "model.resolved",
    "content.delta",
    "tool.requested",
    "usage.updated",
    "result.structured",
    "quota.exhausted",
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
  assert.deepEqual(DRIVER_EVENT_FIELDS["result.structured"], { value: "value", bytes: "count" });
  assert.deepEqual(DRIVER_EVENT_FIELDS["quota.exhausted"], { scope: "text", resetsAt: "text?" });
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

// invariant: the structured-result rule (AD-073, SSI-48). A provider's
// structured output is emitted as its RFC 8785 canonical value, with the size
// of that canonical text in UTF-8 bytes, only when the size is within the bound
// the session was given. The expected sizes below are counted by hand.
test("a structured result carries its canonical value and its size in UTF-8 bytes", () => {
  const event = resultStructured({ summary: "é", outcome: "done" }, 64);
  // {"outcome":"done","summary":"é"} is 32 characters; "é" takes two bytes.
  assert.deepEqual(event, { type: "result.structured", value: { outcome: "done", summary: "é" }, bytes: 33 });
  assert.deepEqual(Object.keys(event), ["type", "value", "bytes"]);
  assert.deepEqual(Object.keys(event.value), ["outcome", "summary"], "members are in canonical order");
});

test("a structured result is a copy, so the provider's object cannot change it after the bound", () => {
  const reported = { outcome: "done", summary: "x" };
  const event = resultStructured(reported, 64);
  reported.summary = "y".repeat(1000);
  assert.deepEqual(event.value, { outcome: "done", summary: "x" });
});

test("a structured result exactly at its bound is emitted and one byte over is refused", () => {
  // {"summary":"aaaa"} is 18 bytes.
  assert.equal(resultStructured({ summary: "aaaa" }, 18).bytes, 18);
  assert.equal(resultStructured({ summary: "aaaaa" }, 18), "too-large");
  // why: a bound counts bytes, not characters: four "€" are twelve bytes, so
  // {"s":"€€€€"} is 20 bytes although it is 12 characters.
  assert.equal(resultStructured({ s: "€€€€" }, 19), "too-large");
  assert.equal(resultStructured({ s: "€€€€" }, 20).bytes, 20);
});

test("a structured result is refused when its bound is not a positive count", () => {
  for (const bound of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "64", undefined])
    assert.equal(resultStructured({}, bound), "too-large", String(bound));
});

test("a structured result that is not canonical JSON is refused as invalid", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  let deep = 0;
  for (let index = 0; index < 1000; index += 1) deep = [deep];
  for (const reported of [undefined, Number.POSITIVE_INFINITY, Number.NaN, () => 1, cyclic, deep, { s: "\ud800" }])
    assert.equal(resultStructured(reported, 1_048_576), "invalid");
});

// invariant: the quota rule (SSI-58, SSI-61). A scope is a short provider term,
// and a reset time is carried only when the provider reported one in Unix epoch
// seconds that a canonical UTC instant can spell; any other is dropped, never
// guessed.
test("a quota event carries its scope and the reset the provider reported", () => {
  assert.deepEqual(quotaExhausted("five_hour", 1_790_000_000), {
    type: "quota.exhausted",
    scope: "five_hour",
    resetsAt: "2026-09-21T14:13:20.000Z"
  });
  assert.deepEqual(quotaExhausted("seven_day", 0), {
    type: "quota.exhausted",
    scope: "seven_day",
    resetsAt: "1970-01-01T00:00:00.000Z"
  });
  assert.deepEqual(quotaExhausted("usage_limit_exceeded"), { type: "quota.exhausted", scope: "usage_limit_exceeded" });
  assert.deepEqual(Object.keys(quotaExhausted("five_hour")), ["type", "scope"]);
});

test("a reset time a canonical instant cannot spell is dropped and the quota event stays", () => {
  for (const reported of [-1, 1.5, "1790000000", null, Number.NaN, 253_402_300_800, Number.MAX_SAFE_INTEGER])
    assert.deepEqual(
      quotaExhausted("five_hour", reported),
      { type: "quota.exhausted", scope: "five_hour" },
      String(reported)
    );
  assert.equal(quotaExhausted("five_hour", 253_402_300_799).resetsAt, "9999-12-31T23:59:59.000Z");
});

test("a scope outside the provider-term grammar is reported as unknown", () => {
  for (const scope of ["", "Five_Hour", "five hour", "a".repeat(65), "five-hour\n", "rejected: buy credits"])
    assert.equal(quotaExhausted(scope).scope, "unknown", JSON.stringify(scope));
  assert.equal(quotaExhausted("a".repeat(64)).scope, "a".repeat(64));
});
