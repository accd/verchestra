// why: the fixture of the child run requalification (ADR2-3). The Claude Code
// and Codex drivers run their provider child through one module, and the runs
// whose report that module changed are pinned whole here: each case names the
// labeled fake's mode, the exact event sequence through the close, the outcome
// the close answers, and how often the injected terminator was asked. Each
// driver's qualification suite runs its own cases against the production
// driver.
// invariant: every provider here is the repository's labeled fake executable,
// and every process it starts is killed by id when its case ends. No model is
// invoked.
import assert from "node:assert/strict";

import { brief } from "./driver-cancel-order-fixture.mjs";
import { reap } from "./process-tree-fixture.mjs";

export const STOP_REASON = "user-request";

// why: `build(onSpawn)` returns a driver whose fake runs in the case's mode,
// its request, and the fixture's call counts; `stopOn(event)` names the event
// at which the case cancels the session, when it does.
export function childRunSuite(test, label, cases) {
  for (const entry of cases) {
    test(`${label}: a provider that ${entry.name} is reported as pinned`, { timeout: 30_000 }, async (t) => {
      const { driver, request, calls } = entry.build((pid) => reap(t, () => [pid]));
      const events = [];
      let stopping;
      const reference = await driver.start(
        request,
        (event) => {
          events.push(event);
          if (entry.stopOn?.(event) === true)
            stopping ??= driver.cancel({ sessionId: events[0].sessionId }, STOP_REASON);
        },
        new AbortController().signal
      );
      await stopping;
      const closed = await driver.close(reference);
      assert.deepEqual(brief(events), entry.sequence);
      assert.equal(closed.outcome, entry.outcome);
      assert.equal(calls.terminate, entry.terminations, "the terminator was asked a different number of times");
    });
  }
}
