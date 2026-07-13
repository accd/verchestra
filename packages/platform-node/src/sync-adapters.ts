import { createHash } from "node:crypto";

import {
  SyncError,
  type ContentDigestPort,
  type PersistedSyncState,
  type SyncStateStorePort
} from "@verchestra/application";

import { RuntimeStore } from "./runtime-store/runtime-store.ts";

export class NodeContentDigest implements ContentDigestPort {
  sha256(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
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
    return this.#runtime.getSyncState(workspaceId) as PersistedSyncState | undefined;
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
