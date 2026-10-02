import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { runVerifierDriverSession } from "../../apps/vestra-cli/src/self-test-full-scenario.ts";

// invariant: the full profile records a verifier session only when the driver
// session runner reports it completed (ADP-4, C4-3). The verifier is the
// repository's labeled fake driver, so nothing here contacts a provider.

const incompleteCodex = fileURLToPath(new URL("../helpers/self-test-fakes/incomplete-codex.mjs", import.meta.url));
const toolRequestingClaude = fileURLToPath(
  new URL("../helpers/self-test-fakes/tool-requesting-claude.mjs", import.meta.url)
);
const BINDING = Object.freeze({ implementerDriverId: "claude-code", verifierDriverId: "codex" });
const unused = () => [process.execPath, incompleteCodex];

test("the full profile's verifier session is recorded as completed, read-only, and closed", async () => {
  const evidence = await runVerifierDriverSession(BINDING);
  assert.deepEqual(evidence, {
    closed: true,
    driverId: "codex",
    grantedToolCount: 0,
    outcome: "completed",
    requestedToolCount: 0
  });
  assert.ok(Object.isFrozen(evidence));
});

test("the verifier session runs on the driver the binding names", async () => {
  const evidence = await runVerifierDriverSession({ implementerDriverId: "codex", verifierDriverId: "claude-code" });
  assert.equal(evidence.driverId, "claude-code");
  assert.equal(evidence.outcome, "completed");
});

test("a verifier driver that does not complete its session is refused, never recorded", async () => {
  await assert.rejects(
    runVerifierDriverSession(BINDING, { claude: unused(), codex: [process.execPath, incompleteCodex] }),
    /did not complete its isolated session/u
  );
});

// invariant: the verifier is granted no tool, so a session that asks for one is
// refused even though it then completes.
test("a verifier driver that requests a tool despite its zero-tool grant is refused", async () => {
  await assert.rejects(
    runVerifierDriverSession(
      { implementerDriverId: "codex", verifierDriverId: "claude-code" },
      { claude: [process.execPath, toolRequestingClaude], codex: unused() }
    ),
    (error) => {
      assert.equal(error.code, "VES_VERIFIER_GRANT_INVALID");
      return true;
    }
  );
});

test("a binding to a driver the full profile does not compose is refused", async () => {
  await assert.rejects(
    runVerifierDriverSession({ implementerDriverId: "claude-code", verifierDriverId: "opencode" }),
    /no composed verifier driver for opencode/u
  );
});
