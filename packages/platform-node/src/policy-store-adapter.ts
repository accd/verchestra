import { RuntimeStore } from "./runtime-store/runtime-store.ts";

interface StoredPolicyView {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly schema: unknown;
  readonly layers: Partial<Readonly<Record<string, Readonly<Record<string, string>>>>>;
  readonly policyViewDigest: string;
}

export class RuntimePolicyViewStore {
  readonly #runtime: RuntimeStore;
  readonly #workspaceId: string;

  constructor(options: { readonly runtimeStore: RuntimeStore; readonly workspaceId: string }) {
    this.#runtime = options.runtimeStore;
    this.#workspaceId = options.workspaceId;
  }

  async load(): Promise<StoredPolicyView | undefined> {
    return this.#runtime.getActivePolicyView(this.#workspaceId) as StoredPolicyView | undefined;
  }

  async save(
    candidate: StoredPolicyView,
    expectedGeneration: number
  ): Promise<{ readonly activated: boolean; readonly conflict: boolean }> {
    return this.#runtime.saveActivePolicyView(
      this.#workspaceId,
      JSON.stringify(candidate),
      candidate.policyViewDigest,
      expectedGeneration
    );
  }
}
