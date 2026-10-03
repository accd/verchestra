// invariant: requalification of the Codex driver for the provider child run
// (ADR2-3). The production CodexDriver now runs its provider through the
// module both drivers share, which fails the stream on a line that is not a
// JSON object. The provider is the DETERMINISTIC FAKE `codex app-server`
// (fake-codex-app-server.mjs). No model is invoked.
import { test } from "node:test";

import { CodexDriver } from "../../../packages/drivers/src/index.ts";
import { codexFixture } from "../../../tests/helpers/codex-driver-fixture.mjs";
import { childRunSuite } from "../../../tests/helpers/driver-child-run-fixture.mjs";

const STARTED = ["session.started", "model.resolved"];

function build(mode) {
  return (onSpawn) => {
    const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: mode } });
    const dependencies = fixture.dependencies();
    const driver = new CodexDriver({
      ...dependencies,
      onSpawn: (pid) => {
        dependencies.onSpawn(pid);
        onSpawn(pid);
      }
    });
    return { driver, request: fixture.request(), calls: fixture.calls };
  };
}

childRunSuite(test, "codex", [
  {
    name: "writes lines that parse as JSON and are not objects",
    build: build("not-an-object"),
    sequence: [...STARTED, "error:VES_CODEX_STREAM_INVALID", "session.closed:failed"],
    outcome: "failed",
    terminations: 1
  },
  {
    name: "writes a number, a boolean and an array, then completes its turn",
    build: build("primitive-lines"),
    sequence: [...STARTED, "usage.updated", "error:VES_CODEX_STREAM_INVALID", "session.closed:failed"],
    outcome: "failed",
    terminations: 1
  }
]);
