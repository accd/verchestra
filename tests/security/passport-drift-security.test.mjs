import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryPassportStore, ModelPassportRegistry } from "../../packages/agent-runtime/src/index.ts";
import { candidate, digest, passportId, registryFixture } from "../helpers/passport-fixture.mjs";

function registry(overrides = {}) {
  const fixture = registryFixture(overrides);
  const store = new InMemoryPassportStore();
  return { service: new ModelPassportRegistry({ ...fixture, store }), store, fixture };
}

for (const [name, observation] of [
  [
    "resolved model",
    { resolvedModelId: "claude-sonnet-4-7", providerRevision: "2026-07-01", evidenceDigest: digest.sha256("campaign") }
  ],
  [
    "provider revision",
    { resolvedModelId: "claude-opus-4-8", providerRevision: "2026-08-01", evidenceDigest: digest.sha256("campaign") }
  ],
  [
    "evaluation evidence",
    { resolvedModelId: "claude-opus-4-8", providerRevision: "2026-07-01", evidenceDigest: digest.sha256("other") }
  ]
]) {
  test(`${name} drift creates a signed quarantine revision`, async () => {
    const { service } = registry();
    await service.qualify(candidate());
    const record = await service.observe(passportId, observation);
    assert.equal(record.status, "quarantined");
    assert.equal(record.revision, 2);
    assert.equal(record.drift.kind, name.replace(" ", "-"));
  });
}

test("unchanged observation returns current qualification without revision", async () => {
  const { service } = registry();
  const first = await service.qualify(candidate());
  const current = await service.observe(passportId, {
    resolvedModelId: "claude-opus-4-8",
    providerRevision: "2026-07-01",
    evidenceDigest: digest.sha256("campaign")
  });
  assert.equal(current, first);
});

test("same endpoint identity cannot impersonate another provider", async () => {
  const { service } = registry();
  await service.qualify(candidate());
  await assert.rejects(
    service.qualify(
      candidate({
        passportId: "passport_018f0000-0000-7000-8000-000000001399",
        endpointIdentity: { ...candidate().endpointIdentity, providerId: "openai" }
      })
    ),
    (error) => error.code === "VES_PASSPORT_ENDPOINT_CONFLICT"
  );
});

test("same Passport identity cannot move to another endpoint", async () => {
  const { service } = registry();
  await service.qualify(candidate());
  await assert.rejects(
    service.qualify(
      candidate({
        endpointIdentity: {
          ...candidate().endpointIdentity,
          endpointId: "endpoint_018f0000-0000-7000-8000-000000001399"
        }
      })
    ),
    (error) => error.code === "VES_PASSPORT_IDENTITY_CONFLICT"
  );
});

test("same Passport identity cannot impersonate another resolved model", async () => {
  const { service } = registry();
  await service.qualify(candidate());
  await assert.rejects(
    service.qualify(candidate({ resolvedModelId: "claude-sonnet-4-7" })),
    (error) => error.code === "VES_PASSPORT_IDENTITY_CONFLICT"
  );
});

test("expired Passport is excluded from current eligibility without rewriting history", async () => {
  const { service } = registry({ now: () => "2026-09-01T00:00:00.000Z" });
  await service.qualify(candidate({ issuedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-08-01T00:00:00.000Z" }), {
    allowExpiredEvidence: true
  });
  assert.equal(await service.current(passportId), undefined);
  assert.equal((await service.history(passportId))[0].status, "qualified");
});

test("tampered stored revision is never returned or indexed", async () => {
  const { service, store } = registry();
  const record = await service.qualify(candidate());
  store.unsafeReplace(passportId, { ...record, resolvedModelId: "attacker-model" });
  await assert.rejects(service.current(passportId), (error) => error.code === "VES_PASSPORT_TAMPERED");
});

test("alias change never changes resolved endpoint-model identity", async () => {
  const { service } = registry();
  const first = await service.qualify(candidate());
  const second = await service.qualify(candidate({ requestedModelId: "marketing-opus" }));
  assert.equal(first.endpointModelIdentityDigest, second.endpointModelIdentityDigest);
  assert.equal(second.resolvedModelId, first.resolvedModelId);
});
