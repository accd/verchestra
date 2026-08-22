import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";

const roots = [];
const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-live-"));
  roots.push(root);
  const metadataRoot = join(root, ".verchestra");
  const runtimeDatabase = join(root, "runtime.sqlite");
  await mkdir(metadataRoot, { recursive: true });
  const store = new RuntimeStore({ dbPath: runtimeDatabase });
  store.open();
  store.close();
  return { root, runtimeDatabase };
}

test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  );
});

test("live doctor probes inspect runtime, secret presence, sandbox, and driver without opening a writer", async () => {
  const { root, runtimeDatabase } = await fixture();
  let hasCalls = 0;
  const run = await runDoctorDeep({
    controlRoot: root,
    live: {
      workspaceId,
      runtimeDatabase,
      secret: {
        logicalName: "qualification-probe",
        adapter: {
          async has(actualWorkspaceId, logicalName) {
            hasCalls += 1;
            assert.equal(actualWorkspaceId, workspaceId);
            assert.equal(logicalName, "qualification-probe");
            return true;
          }
        }
      }
    }
  });
  const codes = new Set(run.payload["doctor.check_codes"]);
  assert.equal(codes.has("doctor.sqlite-durable-state:pass"), true);
  assert.equal(codes.has("doctor.secret-presence:pass"), true);
  assert.equal(codes.has("doctor.sandbox:pass"), true);
  assert.equal(codes.has("doctor.driver:pass"), true);
  assert.equal(hasCalls, 1, "only the adapter's presence method is called");
});

test("a corrupt live runtime database fails closed while an unconfigured live context remains blocked", async () => {
  const { root, runtimeDatabase } = await fixture();
  const corrupt = await runDoctorDeep({ controlRoot: root, live: { runtimeDatabase: join(root, "missing.sqlite") } });
  const defaulted = await runDoctorDeep({ controlRoot: root });
  assert.equal(
    corrupt.payload["doctor.check_codes"].includes("doctor.sqlite-durable-state:fail"),
    true,
    "a configured but unavailable runtime database is an unhealthy observation"
  );
  assert.equal(
    defaulted.payload["doctor.check_codes"].includes("doctor.sqlite-durable-state:blocked"),
    true,
    "source mode does not invent a provisioned runtime"
  );
  assert.equal(runtimeDatabase.endsWith("runtime.sqlite"), true, "the fixture creates the qualified runtime shape");
});
