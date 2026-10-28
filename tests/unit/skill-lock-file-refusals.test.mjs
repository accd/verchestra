// invariant: door 1 of .specs/features/probe-host-composition/plan.md. The
// skill lock is read and replaced only as a bounded regular file in a real
// `.verchestra` directory: anything else in either place is refused with
// VES_SKILL_LOCK_INVALID, never followed. A staged candidate is committed
// only over the lock its plan replaces, keeping that generation, and a
// rollback leaves no staged file behind.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { SkillLockFile } from "../../apps/vestra-cli/src/extension/skill-lock-file.ts";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";
import { linkDirectory } from "../helpers/windows-links.mjs";

const REFUSED = { code: "VES_SKILL_LOCK_INVALID" };
const PLACEHOLDER = '{\n  "schemaVersion": 1,\n  "skills": []\n}\n';
const CANDIDATE = Object.freeze({ schemaVersion: 1, generation: 2, skills: [], lockDigest: "sha256:candidate" });

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function workspace(t) {
  const root = await temporaryDirectory(t, "vsr-");
  const directory = join(root, ".verchestra");
  return { root, directory, path: join(directory, "skills.lock.json"), file: new SkillLockFile(root) };
}

// why: the registry, not this file, judges a lock; what the file answers for
// anything that is not the placeholder is the lock as read, by its own digest.
function lockOf(generation, lockDigest) {
  return `${JSON.stringify({ schemaVersion: 1, generation, skills: [], lockDigest }, null, 2)}\n`;
}

test("the skill lock is read only as a bounded JSON file in a real directory", async (t) => {
  const { root, directory, path, file } = await workspace(t);
  // No .verchestra directory, and a file in its place, are both refused.
  await assert.rejects(file.read(), REFUSED);
  await writeFile(directory, "not a directory\n");
  await assert.rejects(file.read(), REFUSED);
  await rm(directory);
  // A link in the directory's place is refused, not followed.
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "skills.lock.json"), PLACEHOLDER);
  await linkDirectory(elsewhere, directory);
  await assert.rejects(file.read(), REFUSED);
  await rm(directory, { recursive: true, force: true });
  assert.equal(await readFile(join(elsewhere, "skills.lock.json"), "utf8"), PLACEHOLDER);

  await mkdir(directory);
  // why: no lock at all is the state the first `add` starts from, as is
  // `init`'s placeholder; each names the bytes an update replaces.
  assert.deepEqual(await file.read(), { kind: "bootstrap", digest: sha256("") });
  await writeFile(path, PLACEHOLDER);
  assert.deepEqual(await file.read(), { kind: "bootstrap", digest: sha256(PLACEHOLDER) });
  await writeFile(path, lockOf(4, "sha256:on-disk"));
  const onDisk = await file.read();
  assert.equal(onDisk.kind, "lock");
  assert.equal(onDisk.digest, "sha256:on-disk");
  assert.equal(onDisk.lock.generation, 4);

  await writeFile(path, "{ not json\n");
  await assert.rejects(file.read(), REFUSED);
  await rm(path);
  await mkdir(path);
  await assert.rejects(file.read(), REFUSED, "a directory in the lock's place");
  await rm(path, { recursive: true });
  if (process.platform !== "win32") {
    // why: a file link needs Developer Mode on Windows; the directory link
    // above covers a link on every platform.
    await symlink(join(elsewhere, "skills.lock.json"), path);
    await assert.rejects(file.read(), REFUSED, "a link in the lock's place");
  }
});

test("a staged lock is committed only over the lock its plan replaces", async (t) => {
  const { directory, path, file } = await workspace(t);
  await mkdir(directory);
  const current = lockOf(1, "sha256:generation-1");
  await writeFile(path, current);
  const staged = async () => (await readdir(directory)).filter((name) => name.endsWith(".tmp"));

  const unstaged = file.transaction();
  await assert.rejects(unstaged.commit({ currentLockDigest: "sha256:generation-1" }), REFUSED, "nothing staged");

  const changed = file.transaction();
  await changed.stage(CANDIDATE);
  assert.equal((await staged()).length, 1);
  await assert.rejects(changed.commit({ currentLockDigest: "sha256:another-lock" }), REFUSED, "the lock changed");
  assert.equal(await readFile(path, "utf8"), current);
  await changed.rollback();
  assert.deepEqual(await staged(), []);
  // A second rollback has nothing left to remove.
  await changed.rollback();

  // A kept generation that is not a regular file is never overwritten.
  await mkdir(join(directory, "skills.lock.1.json"));
  const blocked = file.transaction();
  await blocked.stage(CANDIDATE);
  await assert.rejects(blocked.commit({ currentLockDigest: "sha256:generation-1" }), REFUSED);
  assert.equal(await readFile(path, "utf8"), current);
  await blocked.rollback();
  await rm(join(directory, "skills.lock.1.json"), { recursive: true });

  // A generation that is no integer cannot be kept, so nothing replaces it.
  const odd = lockOf(1.5, "sha256:odd-generation");
  await writeFile(path, odd);
  const unkept = file.transaction();
  await unkept.stage(CANDIDATE);
  await assert.rejects(unkept.commit({ currentLockDigest: "sha256:odd-generation" }), REFUSED);
  assert.equal(await readFile(path, "utf8"), odd);
  await unkept.rollback();

  // The plan's own lock is replaced, and the generation it held is kept.
  await writeFile(path, current);
  const committed = file.transaction();
  await committed.stage(CANDIDATE);
  await committed.commit({ currentLockDigest: "sha256:generation-1" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), CANDIDATE);
  assert.equal(await readFile(join(directory, "skills.lock.1.json"), "utf8"), current);
  assert.deepEqual(await staged(), []);
});
