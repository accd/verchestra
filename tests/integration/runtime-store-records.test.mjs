import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { cleanup, event, now, opened, rawDigest, run, runId, transition } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

// why: recorded from origin/main before the record was declared. The Run
// Capsule seals the terminal event as the store returns it, so a declared
// record that changed one value or type would change a sealed digest.
const TERMINAL_EVENT_DIGEST = "sha256:8162b43832cd01c0e57693734e88d5a7376c6f45aea9d3dc25a97bf1e9f6b992";

test("a journal event is the declared record of its row, with the bytes a Capsule sealed before", async () => {
  const { store } = await opened();
  store.createRun(run());
  store.applyTransition(runId, transition(), event());
  const events = store.listEvents(runId);
  assert.deepStrictEqual(events, [
    {
      eventId: "event_018f0b6d-7b1a-7abc-8def-2123456789ab",
      runId,
      sequence: 1,
      expectedStateVersion: 0,
      previousState: "CREATED",
      nextState: "READY",
      eventType: "READY_WITHOUT_INTAKE_ACCEPTED",
      payloadDigest: rawDigest,
      actorKind: "system",
      actorId: "controller:local",
      occurredAt: now
    }
  ]);
  const digest = `sha256:${createHash("sha256").update(canonicalizeJsonV2(events[0])).digest("hex")}`;
  assert.equal(digest, TERMINAL_EVENT_DIGEST);
  assert.deepStrictEqual(store.listEvents("run_018f0b6d-7b1a-7abc-8def-9123456789ab"), []);
});

test("a Run Capsule seal reads back as the declared record it was recorded from", async () => {
  const { store } = await opened();
  store.createRun({ ...run("FAILED", 3), terminalCapsuleRequired: true });
  const seal = {
    runId,
    stateVersion: 3,
    status: "FAILED",
    capsuleId: "c".repeat(64),
    payloadDigest: "d".repeat(64),
    sealedAt: now
  };
  assert.equal(store.getRunCapsuleSeal(runId), undefined);
  assert.equal(store.recordRunCapsuleSeal(seal), "recorded");
  assert.deepStrictEqual({ ...store.getRunCapsuleSeal(runId) }, seal);
});
