import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-09 (#207, T15): the live secret-presence probe, end to end through the
// real composition root, adopted from an independently landed competing
// #207 implementation on `main` and rerouted through this repository's own
// @verchestra/platform-node/readonly subpath (secretPresence, T10) —
// see .specs/STATE.md AD-028's superseded note.

const roots = [];
const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-live-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  return root;
}

test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  );
});

test("a configured live secret adapter reporting present makes secret-presence pass, calling only .has", async () => {
  const root = await fixture();
  let hasCalls = 0;
  const run = await runDoctorDeep({
    controlRoot: root,
    live: {
      workspaceId,
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
  assert.equal(codes.has("doctor.secret-presence:pass"), true);
  assert.equal(hasCalls, 1, "only the adapter's presence method is called");
});

test("a configured live secret adapter reporting absent makes secret-presence blocked, not fail", async () => {
  const root = await fixture();
  const run = await runDoctorDeep({
    controlRoot: root,
    live: {
      workspaceId,
      secret: {
        logicalName: "qualification-probe",
        adapter: {
          async has() {
            return false;
          }
        }
      }
    }
  });

  const codes = new Set(run.payload["doctor.check_codes"]);
  assert.equal(codes.has("doctor.secret-presence:blocked"), true);
});

test("no live secret context leaves secret-presence blocked, never inventing a pass", async () => {
  const root = await fixture();

  const run = await runDoctorDeep({ controlRoot: root });

  const codes = new Set(run.payload["doctor.check_codes"]);
  assert.equal(codes.has("doctor.secret-presence:blocked"), true);
});

test("the adapter's has() call never reaches the sealed report", async () => {
  const root = await fixture();
  const run = await runDoctorDeep({
    controlRoot: root,
    live: {
      workspaceId,
      secret: {
        logicalName: "qualification-probe-with-a-distinctive-name",
        adapter: {
          async has() {
            return true;
          }
        }
      }
    }
  });

  const serialized = `${JSON.stringify(run.payload)}\n${JSON.stringify(run.artifact)}`;
  assert.equal(serialized.includes("qualification-probe-with-a-distinctive-name"), false);
});
