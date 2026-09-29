import type { TaskWorkspaceIo } from "./task-workspace.ts";

export interface TaskConfirmationInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  removeAllListeners(): unknown;
  resume(): unknown;
  pause(): unknown;
}

// invariant: everything a task command reads from its process arrives here,
// named, so the composition never consults ambient process state directly.
export interface TaskCommandIo extends TaskWorkspaceIo {
  readonly stdin: TaskConfirmationInput;
  readonly stderr: (value: string) => void;
  readonly keychainPath?: string;
  readonly pid: number;
}
