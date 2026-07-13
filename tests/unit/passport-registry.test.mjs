import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryPassportStore,
  ModelPassportError,
  ModelPassportRegistry
} from "../../packages/agent-runtime/src/index.ts";
import { candidate, digest, machineId, passportId, registryFixture } from "../helpers/passport-fixture.mjs";

function registry(overrides = {}) {
  const fixture = registryFixture(overrides);
  const store = new InMemoryPassportStore();
  return { service: new ModelPassportRegistry({ ...fixture, store }), store, fixture };
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [value, ...tail])
  );
}

const invalid = [
  ["passport identity", { passportId: "passport-bad" }],
  ["endpoint identity", { endpointIdentity: { ...candidate().endpointIdentity, endpointId: "endpoint-bad" } }],
  ["provider", { endpointIdentity: { ...candidate().endpointIdentity, providerId: "Bad Provider" } }],
  ["driver", { endpointIdentity: { ...candidate().endpointIdentity, driverId: "bad driver" } }],
  ["transport", { endpointIdentity: { ...candidate().endpointIdentity, transport: "unknown" } }],
  ["location digest", { endpointIdentity: { ...candidate().endpointIdentity, locationDigest: "raw-url" } }],
  ["resolved model", { resolvedModelId: "" }],
  ["capabilities", { observedCapabilities: [] }],
  [
    "duplicate capability",
    { observedCapabilities: [candidate().observedCapabilities[0], candidate().observedCapabilities[0]] }
  ],
  ["capacity", { contextCapacity: { ...candidate().contextCapacity, maximumInputTokens: 0 } }],
  ["evidence", { driverContractEvidence: ["not-a-digest"] }],
  ["risk tier", { eligibleRiskTiers: ["critical"] }],
  ["confidence", { confidence: 1.1 }],
  ["status", { status: "unqualified" }],
  ["expiry", { expiresAt: "2026-01-01T00:00:00.000Z" }]
];

for (const [name, override] of invalid) {
  test(`qualification rejects invalid ${name}`, async () => {
    await assert.rejects(
      registry().service.qualify(candidate(override)),
      (error) => error instanceof ModelPassportError && error.code === "VES_PASSPORT_INPUT_INVALID"
    );
  });
}

test("first qualification creates signed immutable revision one", async () => {
  const { service } = registry();
  const record = await service.qualify(candidate());
  assert.equal(record.revision, 1);
  assert.equal(record.status, "qualified");
  assert.match(record.signature, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
});

test("identical qualification is idempotent", async () => {
  const { service } = registry();
  const first = await service.qualify(candidate());
  const second = await service.qualify(candidate());
  assert.equal(second, first);
  assert.equal((await service.history(passportId)).length, 1);
});

for (const [name, override] of [
  ["requested alias", { requestedModelId: "claude-opus" }],
  ["provider revision", { providerRevision: "2026-07-02" }],
  ["evaluation evidence", { evaluationCampaignRef: digest.sha256("campaign-2") }],
  ["expiry", { expiresAt: "2026-09-13T12:00:00.000Z" }]
]) {
  test(`${name} change creates a signed history revision without changing identity`, async () => {
    const { service } = registry();
    await service.qualify(candidate());
    const changed = await service.qualify(candidate(override));
    assert.equal(changed.passportId, passportId);
    assert.equal(changed.revision, 2);
    assert.equal((await service.history(passportId)).length, 2);
  });
}

test("history is ordered and immutable", async () => {
  const { service } = registry();
  await service.qualify(candidate());
  await service.qualify(candidate({ requestedModelId: "claude-opus" }));
  const history = await service.history(passportId);
  assert.deepEqual(
    history.map((entry) => entry.revision),
    [1, 2]
  );
  assert.equal(Object.isFrozen(history), true);
});

test("machine profile index contains only verified current eligible refs", async () => {
  const { service } = registry();
  await service.qualify(candidate());
  const index = await service.indexMachine(machineId, [passportId]);
  assert.deepEqual(index.passports, [{ passportId, revision: 1 }]);
  assert.equal(await service.machineIndex(machineId), index);
});

for (const [index, riskOrder] of permutations(["low", "medium", "high"]).entries()) {
  test(`property: evidence/capability/risk ordering is one qualification ${index + 1}`, async () => {
    const { service } = registry();
    const first = await service.qualify(candidate());
    const reordered = await service.qualify(
      candidate({
        observedCapabilities: [...candidate().observedCapabilities].reverse(),
        driverContractEvidence: [...candidate().driverContractEvidence].reverse(),
        eligibleRiskTiers: riskOrder
      })
    );
    assert.equal(reordered, first);
    assert.equal((await service.history(passportId)).length, 1);
  });
}
