#!/usr/bin/env node
// Qualification-only fixture provisioner for deep doctor (T5, #207). Not wired
// into `vestra init` or any user-facing command — it exists so a T75 matrix leg
// can materialize the seven subsystem paths the layout contract declares,
// which nothing on a bare source checkout ever creates.
//
// Every path comes from `SUBSYSTEM_OBSERVATION_PATHS`
// (packages/domain/src/workspace-layout/subsystem-layout.ts) via generic
// iteration, never a hand-listed per-subsystem case. A hand-listed case would
// reintroduce exactly the drift AD-019 exists to end: a subsystem silently
// unprovisioned because whoever last edited this file forgot it.
// tests/architecture/doctor-workspace-root.test.mjs statically proves this
// file still iterates the contract rather than hardcoding a partial list.
//
// Content is placeholder except for two subsystems whose live probes need
// something genuine to observe, not an empty file:
// - sandbox (T12, DDL-06): a directory symlink/junction escaping the sandbox
//   root, so ProtectedPathBroker's out-of-root refusal is reachable at all —
//   LogicalPath.parse already rejects any naive "../" logical path.
// - sqlite-durable-state (T13, DDL-08): a real database opened through the
//   product's own RuntimeStore migration path, not hand-rolled schema SQL,
//   so inspectRuntimeDatabase's integrity check and its "runs"/"ves_migrations"
//   row counts observe the actual product schema rather than a fixture that
//   only coincidentally resembles it.

import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSYSTEM_OBSERVATION_PATHS, WORKSPACE_ROOT_DIRNAME } from "../packages/domain/src/index.ts";
import { RuntimeStore } from "../packages/platform-node/src/index.ts";

// A relative path whose final segment carries a dot names a file (e.g.
// "policy/active.bundle", "runtime.db"); every other declared path names a
// directory a real subsystem adapter would populate (e.g. "drivers",
// "sandbox"). This is a generic, structural rule over the contract's own
// path shapes — not a per-subsystem special case.
function isFilePath(relativePath) {
  const finalSegment = relativePath.split("/").at(-1) ?? "";
  return finalSegment.includes(".");
}

export async function provisionDoctorFixtures(controlRoot) {
  const metadataRoot = join(controlRoot, WORKSPACE_ROOT_DIRNAME);
  const provisioned = [];
  for (const [subsystem, relativePath] of Object.entries(SUBSYSTEM_OBSERVATION_PATHS)) {
    const target = join(metadataRoot, relativePath);
    if (subsystem === "sqlite-durable-state") {
      // Real content, provisioned below via RuntimeStore's own migration
      // path — not the empty-placeholder branch every other file takes.
    } else if (isFilePath(relativePath)) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "");
    } else {
      await mkdir(target, { recursive: true });
    }
    provisioned.push(target);
  }

  // The runtime.db fixture (T13, DDL-08): open and close a real RuntimeStore
  // so its own migrations run, producing a genuinely valid database an
  // integrity check can observe as "ok" — the exact schema the product
  // itself creates, not a duplicate maintained separately here.
  const runtimeDbPath = join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS["sqlite-durable-state"]);
  const runtimeStore = new RuntimeStore({ dbPath: runtimeDbPath, now: () => new Date().toISOString() });
  runtimeStore.open();
  runtimeStore.close();

  // The sandbox escape fixture (T12, DDL-06): a directory symlink/junction
  // inside the sandbox root pointing at its own parent (.verchestra), which
  // the loop above just populated with real files (runtime.db among them) —
  // self-contained, no dependency on anything outside what this run already
  // provisions. `openExisting({ rootId: "sandbox", logicalPath:
  // "escape/runtime.db" })` resolves through the link to a real file that is
  // unambiguously outside the sandbox root, exercising the genuine
  // VES_PATH_OUTSIDE_ROOT refusal path. Same cross-platform convention as
  // tests/security/protected-path.test.mjs: a junction on Windows (plain
  // symlinks there need elevated privilege or Developer Mode), a directory
  // symlink elsewhere.
  const sandboxRoot = join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS.sandbox);
  const escapeLink = join(sandboxRoot, "escape");
  await rm(escapeLink, { recursive: true, force: true });
  await symlink(metadataRoot, escapeLink, process.platform === "win32" ? "junction" : "dir");

  return provisioned;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const controlRoot = process.argv[2];
  if (!controlRoot) {
    console.error("usage: node scripts/provision-doctor-fixtures.mjs <controlRoot>");
    process.exitCode = 1;
  } else {
    const provisioned = await provisionDoctorFixtures(resolve(controlRoot));
    console.log(`provisioned ${provisioned.length} deep-doctor fixture path(s) under ${controlRoot}`);
  }
}
