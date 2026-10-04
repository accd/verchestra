import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, sep } from "node:path";

// invariant: a real directory below `root` whose path is exactly `length`
// characters, built from names of about 100 characters, which every
// filesystem the suites run on accepts. A case uses it to put a path at, just
// below, or just past a limit on purpose.
export async function directoryOfLength(root, length) {
  const need = length - root.length;
  assert.ok(need > sep.length, `${root} is already ${root.length} characters`);
  const count = Math.ceil(need / (100 + sep.length));
  const characters = need - count * sep.length;
  const segments = Array.from({ length: count }, (_, index) =>
    "d".repeat(Math.floor(characters / count) + (index < characters % count ? 1 : 0))
  );
  const path = join(root, ...segments);
  assert.equal(path.length, length);
  await mkdir(path, { recursive: true });
  return path;
}
