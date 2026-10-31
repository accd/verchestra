// invariant: on a Windows host without symbolic-link rights the bridge
// fixture still builds its directory link, as a junction, and a file link it
// cannot build fails with one message that names the fix, not a bare EPERM.
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { cleanupBridges, linkDirectory, linkFile, openController, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const EPERM = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });

test("a directory link falls back to a junction on EPERM", async () => {
  const calls = [];
  await linkDirectory("C:\\outside", "C:\\worktree\\src\\linkdir", async (target, path, type) => {
    calls.push([target, path, type]);
    if (type === "dir") throw EPERM();
  });
  assert.deepEqual(calls, [
    ["C:\\outside", "C:\\worktree\\src\\linkdir", "dir"],
    ["C:\\outside", "C:\\worktree\\src\\linkdir", "junction"]
  ]);
  const other = Object.assign(new Error("exists"), { code: "EEXIST" });
  await assert.rejects(
    linkDirectory("a", "b", async () => {
      throw other;
    }),
    (error) => error === other
  );
});

test("a file link EPERM names Windows Developer Mode", async () => {
  await assert.rejects(
    linkFile("C:\\outside\\victim.txt", "C:\\worktree\\src\\linkfile.txt", async () => {
      throw EPERM();
    }),
    (error) => {
      assert.match(error.message, /Windows Developer Mode/u);
      assert.equal(error.cause.code, "EPERM");
      return true;
    }
  );
  let linked = 0;
  await linkFile("target", "path", async () => {
    linked += 1;
  });
  assert.equal(linked, 1);
});

// invariant: cleanup lets a relay exit on its own instead of signalling it. A
// signal that lands while the relay writes its V8 profile on the way out
// leaves a truncated profile that fails a whole coverage scope.
test("cleanup ends a live relay by closing its input, never by a signal", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const worktree = await realpath(await temporaryDirectory(t, "verchestra-relay-"));
  await mkdir(join(worktree, "src"));
  const { controller } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  await cleanupBridges();
  assert.equal(relay.child.signalCode, null);
  assert.equal(relay.child.exitCode, 0);
});

test("cleanup waits out a relay that is already exiting instead of signalling it", async () => {
  // A relay with no channel is refused and exits on its own.
  const relay = startRelay({});
  await cleanupBridges();
  assert.equal(relay.child.signalCode, null);
  assert.equal(relay.child.exitCode, 1);
});
