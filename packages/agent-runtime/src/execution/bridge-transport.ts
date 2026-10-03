import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import { McpToolBridgeError } from "./mcp-bridge-protocol.ts";

// invariant: one channel serves one run. The relay learns its endpoint only
// through VERCHESTRA_BRIDGE_SOCKET, and `close` stops accepting and removes
// everything the channel created.
export interface BridgeChannel {
  readonly endpoint: string;
  close(): Promise<void>;
}

// invariant: a transport decides only where the relay connects and which
// processes can reach that place. Authentication, framing, the single
// connection, the timeouts, and dispatch stay in the controller, so every
// transport is held to the same controls.
export interface BridgeTransport {
  listen(accept: (connection: Duplex) => void): Promise<BridgeChannel>;
}

// why: AD-039 scopes the macOS and Linux channel to a Unix socket in a fresh
// per-run 0700 directory owned by the invoking user, the socket itself 0600.
export class UnixSocketBridgeTransport implements BridgeTransport {
  readonly #socketRoot: string | undefined;

  // Parent for the per-run 0700 socket directory; defaults to the OS temp dir.
  constructor(socketRoot?: string) {
    this.#socketRoot = socketRoot;
  }

  async listen(accept: (connection: Duplex) => void): Promise<BridgeChannel> {
    const directory = await mkdtemp(join(this.#socketRoot ?? tmpdir(), "vmcp-"));
    await chmod(directory, 0o700);
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && metadata.uid !== process.getuid())
    ) {
      await rm(directory, { recursive: true, force: true });
      throw new McpToolBridgeError("VES_BRIDGE_CHANNEL_INSECURE", "Bridge socket directory is not private");
    }
    const socketPath = join(directory, "bridge.sock");
    const server = createServer((socket) => accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
    return Object.freeze({
      endpoint: socketPath,
      close: async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
