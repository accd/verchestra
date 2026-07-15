import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recoveryHarness,
  recoveryNow,
  recoveryWorkspace,
  restoreCoordinator,
  restorePorts
} from "../helpers/recovery-bundle-fixture.mjs";

for (const phase of ["stage", "validate", "activate"]) {
  test(`${phase} failure leaves active state unchanged`, async () => {
    const { builder, bundle, trust, recipients } = await recoveryHarness();
    const { state, ports } = restorePorts({
      staging: {
        [phase]: async () => {
          throw new Error(`injected ${phase}`);
        }
      }
    });
    await assert.rejects(
      restoreCoordinator(builder, ports).restore(bundle, trust, recipients[0], {
        workspaceId: recoveryWorkspace,
        now: recoveryNow
      }),
      new RegExp(`injected ${phase}`, "u")
    );
    assert.equal(state.active, "original");
  });
}

for (const field of ["policy", "source", "approvals", "claims"]) {
  test(`failed ${field} reevaluation leaves active state unchanged`, async () => {
    const { builder, bundle, trust, recipients } = await recoveryHarness();
    const authority = { policy: "passed", source: "passed", approvals: "passed", claims: "passed", [field]: "stale" };
    const { state, ports } = restorePorts({ authority: { reevaluate: async () => authority } });
    await assert.rejects(
      restoreCoordinator(builder, ports).restore(bundle, trust, recipients[0], {
        workspaceId: recoveryWorkspace,
        now: recoveryNow
      }),
      { code: "VES_RECOVERY_AUTHORITY_STALE" }
    );
    assert.equal(state.active, "original");
  });
}

test("unknown effect outcome requires reconciliation and leaves active state unchanged", async () => {
  const { builder, bundle, trust, recipients } = await recoveryHarness();
  const { state, ports } = restorePorts({ effects: { reconcile: async () => "unknown" } });
  await assert.rejects(
    restoreCoordinator(builder, ports).restore(bundle, trust, recipients[0], {
      workspaceId: recoveryWorkspace,
      now: recoveryNow
    }),
    { code: "VES_RECOVERY_RECONCILIATION_REQUIRED" }
  );
  assert.equal(state.active, "original");
});

test("missing object in encrypted closure leaves active state unchanged", async () => {
  const fixture = await recoveryHarness();
  const tampered = structuredClone(fixture.bundle);
  tampered.payload.manifest.objects.push({ ...tampered.payload.manifest.objects[0], objectId: "missing" });
  const { state, ports } = restorePorts();
  await assert.rejects(
    restoreCoordinator(fixture.builder, ports).restore(tampered, fixture.trust, fixture.recipients[0], {
      workspaceId: recoveryWorkspace,
      now: recoveryNow
    })
  );
  assert.equal(state.active, "original");
});
