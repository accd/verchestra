import { createHash } from "node:crypto";

import {
  SyncError,
  type ContentDigestPort,
  type PersistedSyncState,
  type SyncStateStorePort
} from "@verchestra/application";

import { runtimeError } from "./runtime-store/runtime-sqlite.ts";
import type { RuntimeStore, StoredSyncState } from "./runtime-store/runtime-store.ts";

export class NodeContentDigest implements ContentDigestPort {
  sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
}

function boundTo(value: unknown, stateDigest: string): value is PersistedSyncState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "stateDigest") === stateDigest
  );
}

// invariant: the inverse of the encoding in save. The store bound the text to
// its digest when it saved it, so a text that no longer carries that digest
// was edited behind the store. `WorkspaceReconcileService` then checks the
// Workspace and that the digest is the digest of the content.
function decodeSyncState(stored: StoredSyncState): PersistedSyncState {
  let state: unknown;
  try {
    state = JSON.parse(stored.stateJson);
  } catch (error) {
    throw runtimeError("VES_RUNTIME_CORRUPT", "Stored sync state is not JSON", error, true);
  }
  if (!boundTo(state, stored.stateDigest))
    throw runtimeError("VES_RUNTIME_CORRUPT", "Stored sync state is not bound to its digest", undefined, true);
  return Object.freeze(state);
}

export class RuntimeSyncStateStore implements SyncStateStorePort {
  readonly #runtime: RuntimeStore;
  readonly #workspaceId: string;

  constructor(options: { readonly runtimeStore: RuntimeStore; readonly workspaceId: string }) {
    this.#runtime = options.runtimeStore;
    this.#workspaceId = options.workspaceId;
  }

  async load(workspaceId: string): Promise<PersistedSyncState | undefined> {
    if (workspaceId !== this.#workspaceId) {
      throw new SyncError("VES_SYNC_STATE_INVALID", "Workspace sync state belongs to another Workspace");
    }
    const stored = this.#runtime.getSyncState(workspaceId);
    return stored === undefined ? undefined : decodeSyncState(stored);
  }

  async save(state: PersistedSyncState): Promise<{ readonly changed: boolean }> {
    if (state.workspaceId !== this.#workspaceId) {
      throw Object.assign(new Error("Workspace sync state belongs to another Workspace"), {
        code: "VES_SYNC_STATE_INVALID"
      });
    }
    return this.#runtime.saveSyncState(state.workspaceId, JSON.stringify(state), state.stateDigest);
  }
}
