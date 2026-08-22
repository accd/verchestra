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
// Content is placeholder only beyond the sandbox escape fixture below, which
// is required content: T12's live sandbox probe needs a real directory
// symlink/junction escaping the sandbox root to genuinely exercise
// ProtectedPathBroker's out-of-root refusal on a provisioned machine, not
// only in an isolated unit test — LogicalPath.parse already rejects any
// naive "../" logical path, so a symlink escape is the only way that
// refusal is ever reachable at all.

import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSYSTEM_OBSERVATION_PATHS, WORKSPACE_ROOT_DIRNAME } from "../packages/domain/src/index.ts";

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
  for (const [, relativePath] of Object.entries(SUBSYSTEM_OBSERVATION_PATHS)) {
    const target = join(metadataRoot, relativePath);
    if (isFilePath(relativePath)) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "");
    } else {
      await mkdir(target, { recursive: true });
    }
    provisioned.push(target);
  }

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
