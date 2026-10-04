// invariant: AD-079, the writer grant of a resumed run. A grant ends at the
// earlier of the approval's expiry and the run's longest duration plus the
// lease margin. A resume renews it only when renewal is armed (a suspended run
// that passed its revalidation), only a grant that exists and was never
// revoked, only when its remaining life is shorter than the run's remaining
// duration, and only when the new grant would outlive it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { grantExpiry, renewsGrant } from "../../apps/vestra-cli/src/task/task-run.ts";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const LIFETIME = Object.freeze({ now: NOW, approvalExpiresAt: at(7 * 24 * HOUR), maximumDurationMs: 10 * MINUTE });

function facts(change = {}) {
  return {
    ...LIFETIME,
    armed: true,
    grant: { expiresAt: at(-MINUTE) },
    remainingDurationMs: 8 * MINUTE,
    ...change
  };
}

test("a grant ends at the run's longest duration plus the margin, or at the approval's expiry if that is earlier", () => {
  assert.equal(grantExpiry(LIFETIME), NOW + 10 * MINUTE + HOUR);
  assert.equal(grantExpiry({ ...LIFETIME, approvalExpiresAt: at(30 * MINUTE) }), NOW + 30 * MINUTE);
});

test("a resume of a suspended run renews a grant that expired", () => {
  assert.equal(renewsGrant(facts()), true);
});

test("a resume that is not of a suspended run never renews, even an expired grant", () => {
  assert.equal(renewsGrant(facts({ armed: false })), false);
});

test("a revoked grant is never renewed, expired or not", () => {
  for (const expiresAt of [at(-MINUTE), at(2 * MINUTE)])
    assert.equal(renewsGrant(facts({ grant: { expiresAt, revokedAt: at(-2 * MINUTE) } })), false, expiresAt);
});

test("a grant the authority does not hold is not renewed", () => {
  assert.equal(renewsGrant(facts({ grant: undefined })), false);
});

test("a grant that would lapse before the run's remaining duration is spent is renewed; one that lasts is reused", () => {
  assert.equal(renewsGrant(facts({ grant: { expiresAt: at(5 * MINUTE) } })), true, "five minutes left of eight");
  assert.equal(renewsGrant(facts({ grant: { expiresAt: at(8 * MINUTE) } })), false, "exactly the remaining duration");
  assert.equal(renewsGrant(facts({ grant: { expiresAt: at(50 * MINUTE) } })), false, "longer than the run needs");
});

test("a grant is not renewed when the approval's expiry caps the new grant at the old one's end", () => {
  const capped = { approvalExpiresAt: at(5 * MINUTE), grant: { expiresAt: at(5 * MINUTE) } };
  assert.equal(renewsGrant(facts(capped)), false);
  assert.equal(renewsGrant(facts({ ...capped, approvalExpiresAt: at(6 * MINUTE) })), true);
});
