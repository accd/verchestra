import type { Readable } from "node:stream";

// Shared by the relay child (launched by Claude Code) and the controller (the
// Verchestra process). The relay holds no authority; these constants only
// describe the wire.

export const MCP_BRIDGE_SERVER_NAME = "verchestra" as const;
export const MCP_BRIDGE_SOCKET_ENV = "VERCHESTRA_BRIDGE_SOCKET" as const;
export const MCP_BRIDGE_TOKEN_ENV = "VERCHESTRA_BRIDGE_TOKEN" as const;
export const MCP_BRIDGE_CHANNEL_PROTOCOL = "verchestra-bridge/1" as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
// invariant: one line is one JSON message on both the MCP stdio transport and
// the controller channel. A 1 MiB write expands at most sixfold when every
// byte is JSON-escaped, so 8 MiB bounds a legal frame and stops a runaway one.
export const MAXIMUM_BRIDGE_FRAME_BYTES = 8 * 1024 * 1024;
export const BRIDGE_TOKEN = /^[a-f0-9]{64}$/u;

export const MCP_BRIDGE_TOOLS = Object.freeze([
  "read_file",
  "list_dir",
  "search",
  "write_file",
  "delete_file"
] as const);
export type McpBridgeTool = (typeof MCP_BRIDGE_TOOLS)[number];

// The names Claude Code gives the bridge tools; the driver adapter treats any
// other requested tool as a violation.
export const MCP_BRIDGE_QUALIFIED_TOOLS: readonly string[] = Object.freeze(
  MCP_BRIDGE_TOOLS.map((tool) => `mcp__${MCP_BRIDGE_SERVER_NAME}__${tool}`)
);

const path = { type: "string", minLength: 1, maxLength: 1024, description: "Repository-relative path." };

export const MCP_BRIDGE_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "read_file",
    description: "Read a UTF-8 file inside the approved read scope of the task worktree.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path,
        offset: { type: "integer", minimum: 0, description: "Byte offset to start from." },
        length: { type: "integer", minimum: 1, maximum: 262144, description: "Maximum bytes to return." }
      }
    }
  },
  {
    name: "list_dir",
    description: "List a directory inside the approved read scope of the task worktree.",
    inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path } }
  },
  {
    name: "search",
    description: "Find lines containing a literal string inside the approved read scope.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", minLength: 1, maxLength: 200 }, path }
    }
  },
  {
    name: "write_file",
    description: "Replace a file's full UTF-8 content. Verchestra checks scope and authority before writing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: { path, content: { type: "string", maxLength: 1048576 } }
    }
  },
  {
    name: "delete_file",
    description: "Delete a file. Verchestra checks scope and authority before deleting.",
    inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: { path } }
  }
]);

export interface BridgeToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError: boolean;
}

export function textResult(text: string, isError = false): BridgeToolResult {
  return Object.freeze({ content: Object.freeze([Object.freeze({ type: "text" as const, text })]), isError });
}

// Splits a byte stream into newline-terminated UTF-8 lines, refusing any line
// longer than the frame bound instead of buffering it.
export function readBoundedLines(
  stream: Readable,
  onLine: (line: string) => void,
  onOverflow: () => void,
  maximumBytes = MAXIMUM_BRIDGE_FRAME_BYTES
): void {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let overflowed = false;
  stream.on("data", (chunk: Buffer | string) => {
    if (overflowed) return;
    let data = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    let newline = data.indexOf(0x0a);
    while (newline >= 0) {
      const line = Buffer.concat([...pending, data.subarray(0, newline)]);
      pending = [];
      pendingBytes = 0;
      if (line.byteLength > maximumBytes) {
        overflowed = true;
        onOverflow();
        return;
      }
      const text = line.toString("utf8").replace(/\r$/u, "");
      if (text.length > 0) onLine(text);
      data = data.subarray(newline + 1);
      newline = data.indexOf(0x0a);
    }
    pendingBytes += data.byteLength;
    if (pendingBytes > maximumBytes) {
      overflowed = true;
      onOverflow();
      return;
    }
    if (data.byteLength > 0) pending.push(data);
  });
}

export function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
