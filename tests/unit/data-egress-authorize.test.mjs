import assert from "node:assert/strict";
import { test } from "node:test";

import { DataEgressFirewall, TrustEnvelopeService } from "../../packages/application/src/egress/trust-egress.ts";

import { digest, firewallFixture, runId, source, workspaceId } from "../helpers/egress-fixture.mjs";

// Unit-level egress decisions: the first refusal each malformed request meets,
// and that a refusing or failing port never turns into an allow.

const request = (fragments, overrides = {}) => ({
  workspaceId,
  runId,
  mode: "online",
  fragments,
  purpose: "model-inference",
  destinationId: "destination:model-api",
  retention: "none",
  approvalRef: "approval:execution",
  capabilityRef: "grant:model-call",
  ...overrides
});

const envelope = (overrides = {}) => new TrustEnvelopeService({ digest }).source(source(overrides));

test("a run identity that is not a stable identifier is refused before any fragment is read", async () => {
  const fixture = firewallFixture();
  const verdict = await new DataEgressFirewall(fixture).authorize(request([envelope()], { runId: "run-1" }));
  assert.deepEqual(verdict, { allowed: false, code: "VES_EGRESS_INPUT_INVALID" });
  assert.equal(fixture.captured(), undefined);
});

for (const [label, mutate] of [
  ["an unknown classification", (fragment) => ({ ...fragment, classification: "top-secret" })],
  ["an unknown trust class", (fragment) => ({ ...fragment, trust: "self-asserted" })],
  ["a declassification reference without its record", (fragment) => ({ ...fragment, declassificationEvidenceId: "x" })]
]) {
  test(`a fragment with ${label} is refused as an invalid fragment`, async () => {
    const fixture = firewallFixture();
    const verdict = await new DataEgressFirewall(fixture).authorize(request([envelope(), mutate(envelope())]));
    assert.deepEqual(verdict, { allowed: false, code: "VES_EGRESS_FRAGMENT_INVALID" });
    assert.equal(fixture.captured(), undefined);
  });
}

test("an external destination is refused in offline mode before purpose or retention", async () => {
  const verdict = await new DataEgressFirewall(firewallFixture()).authorize(
    request([envelope()], { mode: "offline", purpose: "analytics", retention: "forever" })
  );
  assert.equal(verdict.code, "VES_EGRESS_NETWORK_MODE_DENIED");
});

test("a fragment from another Workspace is refused even when the destination matches", async () => {
  const verdict = await new DataEgressFirewall(firewallFixture()).authorize(
    request([envelope({ workspaceId: "workspace_018f0000-0000-7000-8000-000000000099" })])
  );
  assert.equal(verdict.code, "VES_EGRESS_WORKSPACE_DENIED");
});

test("an authority port that fails is an authority denial, never an allow", async () => {
  const fixture = firewallFixture({
    authority: {
      verify: async () => {
        throw new Error("authority store unavailable");
      }
    }
  });
  const verdict = await new DataEgressFirewall(fixture).authorize(request([envelope()]));
  assert.deepEqual(verdict, { allowed: false, code: "VES_EGRESS_AUTHORITY_DENIED" });
  assert.equal(fixture.captured(), undefined);
});

test("a local destination needs no external authority", async () => {
  let asked = false;
  const fixture = firewallFixture({
    authority: {
      verify: async () => {
        asked = true;
        return { approvalValid: false, capabilityValid: false };
      }
    }
  });
  const verdict = await new DataEgressFirewall(fixture).authorize(
    request([envelope()], {
      mode: "no-egress",
      destinationId: "destination:local-cache",
      purpose: "context-cache",
      retention: "workspace"
    })
  );
  assert.equal(verdict.allowed, true);
  assert.equal(asked, false);
  assert.deepEqual(verdict.fragmentIds, [source().fragmentId]);
});

test("an allowed request hands policy a manifest without content and binds its digest", async () => {
  const fixture = firewallFixture();
  const verdict = await new DataEgressFirewall(fixture).authorize(request([envelope()]));
  assert.equal(verdict.code, "VES_EGRESS_ALLOWED");
  const manifest = fixture.captured();
  assert.equal(manifest.destinationKind, "external");
  assert.equal(manifest.endpoint, "https://models.example.test/v1");
  assert.equal(JSON.stringify(manifest).includes("ordinary source content"), false);
  assert.equal("declassificationEvidenceId" in manifest.fragments[0], false);
  assert.match(verdict.egressDigest, /^sha256:[a-f0-9]{64}$/u);
});
