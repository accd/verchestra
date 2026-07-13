import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkClaimService } from "../../packages/application/src/index.ts";
import { coordinationFixture, runA } from "../helpers/coordination-fixture.mjs";

const request = (fixture, enforcement = "enforced") => ({
  mode: "team",
  enforcement,
  scope: fixture.scope,
  owner: { runId: runA, actorId: "actor:a" },
  ttlMs: 60_000
});

test("enforced connector outage fails closed and releases local lease", async () => {
  const fixture = coordinationFixture();
  fixture.remote.unavailable = true;
  await assert.rejects(new WorkClaimService(fixture).acquire(request(fixture)), {
    code: "VES_CLAIM_CONNECTOR_UNAVAILABLE"
  });
  assert.equal(fixture.local.active, undefined);
});

test("advisory connector outage retains only local protection", async () => {
  const fixture = coordinationFixture();
  fixture.remote.unavailable = true;
  const result = await new WorkClaimService(fixture).acquire(request(fixture, "advisory"));
  assert.equal(result.status, "advisory-unavailable");
  assert.equal(fixture.local.active.ownerId, runA);
});

test("invalid remote signature fails closed and releases local lease", async () => {
  const fixture = coordinationFixture();
  fixture.signatures.verify = async () => false;
  await assert.rejects(new WorkClaimService(fixture).acquire(request(fixture)), {
    code: "VES_CLAIM_SIGNATURE_INVALID"
  });
  assert.equal(fixture.local.active, undefined);
});

test("invalid advisory conflict signature also fails closed", async () => {
  const fixture = coordinationFixture();
  const service = new WorkClaimService(fixture);
  await service.acquire(request(fixture, "advisory"));
  fixture.local.active = undefined;
  fixture.signatures.verify = async () => false;
  await assert.rejects(
    service.acquire({
      ...request(fixture, "advisory"),
      owner: { runId: "run_018f0000-0000-7000-8000-000000000004", actorId: "actor:b" }
    }),
    { code: "VES_CLAIM_SIGNATURE_INVALID" }
  );
  assert.equal(fixture.local.active, undefined);
});

test("heartbeat outage does not silently extend claim", async () => {
  const fixture = coordinationFixture();
  const service = new WorkClaimService(fixture);
  const acquired = await service.acquire(request(fixture));
  fixture.remote.unavailable = true;
  await assert.rejects(service.heartbeat(acquired.claim, 60_000, acquired.lease), {
    code: "VES_CLAIM_CONNECTOR_UNAVAILABLE"
  });
  assert.equal(acquired.claim.expiresAt, "2026-07-13T12:01:00.000Z");
});

test("release outage preserves claim for explicit reconciliation", async () => {
  const fixture = coordinationFixture();
  const service = new WorkClaimService(fixture);
  const acquired = await service.acquire(request(fixture));
  fixture.remote.unavailable = true;
  await assert.rejects(service.release(acquired.claim, "done"), { code: "VES_CLAIM_RELEASE_UNCERTAIN" });
  assert.equal(fixture.remote.claims.length, 1);
});

test("local lease conflict prevents any remote request", async () => {
  const fixture = coordinationFixture();
  fixture.local.acquire({ ownerId: "other", expiresAt: "2026-07-13T13:00:00.000Z", now: "2026-07-13T12:00:00.000Z" });
  await assert.rejects(new WorkClaimService(fixture).acquire(request(fixture)), { code: "VES_LOCAL_LEASE_CONFLICT" });
  assert.equal(fixture.remote.claims.length, 0);
});
