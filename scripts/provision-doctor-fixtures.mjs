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
// Content is placeholder only. It exists to make the seven current
// existsSync-based presence probes observe "present"; it says nothing about
// what a live probe (T12-T19) will require of the content's shape.

import { mkdir, writeFile } from "node:fs/promises";
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
