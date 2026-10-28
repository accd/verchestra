// invariant: the skill lock `vestra extension add` writes is tracked
// Workspace content, so the repository it names carries no credential and no
// machine-local path (.specs/features/probe-host-composition/validation.md,
// "Extension kind and origin"): userinfo is removed from the origin, and an
// origin that is a local path is refused as `git-origin` not configured.
import assert from "node:assert/strict";
import { test } from "node:test";

import { publicRepository } from "../../apps/vestra-cli/src/extension/extension-add.ts";

test("the recorded repository is the origin without its userinfo", () => {
  for (const [origin, recorded] of [
    ["https://fixture-user:fixture-token@example.invalid/acme/orders.git", "https://example.invalid/acme/orders.git"],
    ["https://example.invalid/acme/orders.git\n", "https://example.invalid/acme/orders.git"],
    ["ssh://git@example.invalid:2222/acme/orders.git", "ssh://example.invalid:2222/acme/orders.git"],
    ["git@example.invalid:acme/orders.git", "example.invalid:acme/orders.git"]
  ])
    assert.equal(publicRepository(origin), recorded, origin);
});

test("an origin that is a local path is refused", () => {
  for (const origin of [
    "file:///srv/git/orders.git",
    "/srv/git/orders.git",
    "../orders",
    "orders",
    "C:\\repositories\\orders",
    ""
  ])
    assert.throws(
      () => publicRepository(origin),
      (error) => {
        assert.equal(error.envelope.code, "VES_EXTENSION_NOT_CONFIGURED", origin);
        assert.deepEqual(error.envelope.safeDetails, { requirement: "git-origin" }, origin);
        return true;
      }
    );
});
