import type { LocalLeasePort } from "@verchestra/application";

import type { RuntimeStore } from "./runtime-store/runtime-store.ts";

export class RuntimeLocalLease implements LocalLeasePort {
  readonly #runtime: RuntimeStore;

  constructor(runtime: RuntimeStore) {
    this.#runtime = runtime;
  }

  acquire(input: {
    readonly leaseId: string;
    readonly workspaceId: string;
    readonly ownerId: string;
    readonly now: string;
    readonly expiresAt: string;
    readonly expectedFencingToken?: number;
  }): { readonly fencingToken: number } {
    return this.#runtime.acquireLease(input);
  }

  release(workspaceId: string, ownerId: string): boolean {
    return this.#runtime.releaseLease(workspaceId, ownerId);
  }
}
