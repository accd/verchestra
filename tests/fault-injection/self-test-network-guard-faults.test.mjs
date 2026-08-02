// T70 T3: an outbound connection attempt during a scenario fails the run
// (.specs/features/self-test-profiles/spec.md PRF-01).
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { assertNoNetworkAttempts } from "../../packages/application/src/index.ts";
import { offlineGuard } from "../../packages/self-test/src/index.ts";

test("net.connect is blocked and recorded, then restored", () => {
  const guard = offlineGuard();
  try {
    assert.throws(() => new net.Socket().connect(9, "127.0.0.1"), /offline guard blocked net\.connect/u);
    assert.equal(guard.attempts().length, 1);
    assert.equal(guard.attempts()[0].api, "net.connect");
  } finally {
    guard.restore();
  }
  assert.throws(() => assertNoNetworkAttempts(guard.attempts()), { code: "VES_SELFTEST_NETWORK_ATTEMPT" });
});

test("http.request is blocked and recorded", () => {
  const guard = offlineGuard();
  try {
    assert.throws(() => http.request("http://example.invalid/path"), /offline guard blocked http\.request/u);
    assert.equal(guard.attempts().length, 1);
    assert.match(guard.attempts()[0].target, /example\.invalid/u);
  } finally {
    guard.restore();
  }
});

test("fetch is blocked and recorded", async () => {
  const guard = offlineGuard();
  try {
    await assert.rejects(fetch("https://example.invalid/resource"), /offline guard blocked fetch/u);
    assert.equal(guard.attempts().length, 1);
    assert.equal(guard.attempts()[0].api, "fetch");
  } finally {
    guard.restore();
  }
});

test("restore returns real network functions even after a thrown scenario", () => {
  const originalConnect = net.Socket.prototype.connect;
  const guard = offlineGuard();
  assert.notEqual(net.Socket.prototype.connect, originalConnect);
  try {
    throw new Error("scenario blew up");
  } catch {
    // Simulates a scenario throwing mid-run; the caller's finally still runs.
  } finally {
    guard.restore();
  }
  assert.equal(net.Socket.prototype.connect, originalConnect);
});

test("a clean run with zero attempts passes assertNoNetworkAttempts", () => {
  const guard = offlineGuard();
  guard.restore();
  assert.doesNotThrow(() => assertNoNetworkAttempts(guard.attempts()));
});

test("assertNoNetworkAttempts names every attempted api and target", () => {
  assert.throws(
    () =>
      assertNoNetworkAttempts([
        { api: "net.connect", target: "10.0.0.1:443" },
        { api: "fetch", target: "https://example.invalid/x" }
      ]),
    (error) => {
      assert.equal(error.code, "VES_SELFTEST_NETWORK_ATTEMPT");
      assert.match(error.message, /net\.connect 10\.0\.0\.1:443/u);
      assert.match(error.message, /fetch https:\/\/example\.invalid\/x/u);
      return true;
    }
  );
});
