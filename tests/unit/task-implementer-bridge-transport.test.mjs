// invariant: agent-runtime may not import platform-node, so the composition
// root is what hands the mediated bridge its Windows channel (SSI-70); on
// every other platform the bridge keeps its Unix socket.
import assert from "node:assert/strict";
import { test } from "node:test";

import { implementerBridgeTransport } from "../../apps/vestra-cli/src/task/task-implementer.ts";
import { WindowsNamedPipeBridgeTransport } from "../../packages/platform-node/src/windows-pipe-transport.ts";

test("the task composition hands the bridge the named-pipe transport on Windows and nothing elsewhere", () => {
  const windows = implementerBridgeTransport("win32");
  assert.ok(windows instanceof WindowsNamedPipeBridgeTransport);
  for (const platform of ["darwin", "linux", "freebsd"]) assert.equal(implementerBridgeTransport(platform), undefined);
});
