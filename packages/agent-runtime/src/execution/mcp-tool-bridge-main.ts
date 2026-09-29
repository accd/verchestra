import { runMcpToolBridgeRelay } from "./mcp-tool-bridge.ts";

// Entry point Claude Code launches through --mcp-config. It prints nothing on
// stdout except MCP messages; a missing or refused channel exits non-zero so
// Claude reports the server as failed and the driver fails closed.
try {
  await runMcpToolBridgeRelay({ input: process.stdin, output: process.stdout, environment: process.env });
  process.exitCode = 0;
} catch (error) {
  const code = (error as { code?: unknown }).code;
  process.stderr.write(`verchestra bridge: ${typeof code === "string" ? code : "VES_BRIDGE_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  // why: an open stdin keeps the event loop alive after the channel ends; the
  // relay must exit so Claude Code observes the server stop.
  process.stdin.destroy();
}
