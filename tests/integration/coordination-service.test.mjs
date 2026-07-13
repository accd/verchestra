import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { WorkClaimService, normalizeChangeScope } from "../../packages/application/src/index.ts";
import { RuntimeLocalLease } from "../../packages/platform-node/src/index.ts";
import { coordinationFixture, projectId, runA, runB, workspaceId } from "../helpers/coordination-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";
afterEach(cleanup);

const owner = (runId) => ({ runId, actorId: `actor:${runId}` });
const service = (fixture) => new WorkClaimService(fixture);

test("personal mode acquires only the mandatory local lease", async () => {
  const fixture = coordinationFixture();
  const result = await service(fixture).acquire({
    mode: "personal",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  assert.equal(result.status, "acquired-local");
  assert.equal(result.claim, undefined);
  assert.equal(result.lease.fencingToken, 1);
  assert.equal(fixture.remote.claims.length, 0);
});

test("personal lease heartbeat preserves fencing and release removes ownership", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  const result = await claims.acquire({
    mode: "personal",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  fixture.clock.advanceBy(30_000);
  const renewed = claims.heartbeatLocal(result.lease, 60_000);
  assert.equal(renewed.fencingToken, result.lease.fencingToken);
  assert.equal(renewed.expiresAt, "2026-07-13T12:01:30.000Z");
  assert.equal(claims.releaseLocal(renewed), true);
  assert.equal(fixture.local.active, undefined);
});

test("team mode acquires local lease and signed remote claim", async () => {
  const fixture = coordinationFixture();
  const result = await service(fixture).acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  assert.equal(result.status, "acquired");
  assert.equal(result.claim.fencingToken, 1);
  assert.match(result.claim.signature, /^signed:/u);
});

test("conflicting enforced partial overlap blocks and releases local lease", async () => {
  const fixture = coordinationFixture();
  const first = await service(fixture).acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  fixture.local.active = undefined;
  const child = normalizeChangeScope({ workspaceId, targets: [{ projectId, path: "src/api" }] }, fixture.digest);
  await assert.rejects(
    service(fixture).acquire({
      mode: "team",
      enforcement: "enforced",
      scope: child,
      owner: owner(runB),
      ttlMs: 60_000
    }),
    { code: "VES_CLAIM_CONFLICT" }
  );
  assert.equal(fixture.local.active, undefined);
  assert.equal(first.claim.owner.runId, runA);
});

test("advisory conflict continues locally with explicit degraded status", async () => {
  const fixture = coordinationFixture();
  await service(fixture).acquire({
    mode: "team",
    enforcement: "advisory",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  fixture.local.active = undefined;
  const result = await service(fixture).acquire({
    mode: "team",
    enforcement: "advisory",
    scope: fixture.scope,
    owner: owner(runB),
    ttlMs: 60_000
  });
  assert.equal(result.status, "advisory-conflict");
  assert.equal(result.conflictingClaim.owner.runId, runA);
});

test("heartbeat preserves fencing and extends signed expiry", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  const acquired = await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  fixture.clock.advanceBy(30_000);
  const renewed = await claims.heartbeat(acquired.claim, 60_000, acquired.lease);
  assert.equal(renewed.fencingToken, acquired.claim.fencingToken);
  assert.equal(renewed.expiresAt, "2026-07-13T12:01:30.000Z");
});

test("expired claim permits takeover with a higher fencing token", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 1_000
  });
  fixture.local.active = undefined;
  fixture.clock.advanceBy(1_001);
  const takeover = await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runB),
    ttlMs: 1_000
  });
  assert.equal(takeover.claim.fencingToken, 2);
});

test("expired local lease cannot be resurrected by stale heartbeat", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  const acquired = await claims.acquire({
    mode: "personal",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 1_000
  });
  fixture.clock.advanceBy(1_001);
  assert.throws(() => claims.heartbeatLocal(acquired.lease, 1_000), { code: "VES_LOCAL_LEASE_CONFLICT" });
});

test("stale fencing reference cannot heartbeat or release successor claim", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  const first = await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 1_000
  });
  fixture.local.active = undefined;
  fixture.clock.advanceBy(1_001);
  await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runB),
    ttlMs: 1_000
  });
  await assert.rejects(claims.heartbeat(first.claim, 1_000, first.lease), { code: "VES_LOCAL_LEASE_CONFLICT" });
  assert.equal(await claims.release(first.claim, "stale"), false);
});

test("release removes remote claim and local lease", async () => {
  const fixture = coordinationFixture();
  const claims = service(fixture);
  const acquired = await claims.acquire({
    mode: "team",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  assert.equal(await claims.release(acquired.claim, "handoff"), true);
  assert.equal(fixture.remote.claims.length, 0);
  assert.equal(fixture.local.active, undefined);
});

test("personal mode enforces single writer through real SQLite restart", async () => {
  const fixture = coordinationFixture();
  const runtime = await opened();
  const first = new WorkClaimService({ ...fixture, local: new RuntimeLocalLease(runtime.store) });
  await first.acquire({
    mode: "personal",
    enforcement: "enforced",
    scope: fixture.scope,
    owner: owner(runA),
    ttlMs: 60_000
  });
  runtime.store.close();
  const { RuntimeStore } = await import("../../packages/platform-node/src/index.ts");
  const reopened = new RuntimeStore({ dbPath: runtime.dbPath, now: () => "2026-07-13T12:00:00.000Z" });
  reopened.open();
  const second = new WorkClaimService({ ...fixture, local: new RuntimeLocalLease(reopened) });
  await assert.rejects(
    second.acquire({
      mode: "personal",
      enforcement: "enforced",
      scope: fixture.scope,
      owner: owner(runB),
      ttlMs: 60_000
    }),
    {
      code: "VES_LOCAL_LEASE_CONFLICT"
    }
  );
  reopened.close();
});
