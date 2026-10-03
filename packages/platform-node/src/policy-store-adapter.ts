import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import { runtimeError } from "./runtime-store/runtime-sqlite.ts";
import type { RuntimeStore, StoredPolicyView } from "./runtime-store/runtime-store.ts";

interface ActivePolicyView {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly schema: unknown;
  readonly layers: Partial<Readonly<Record<string, Readonly<Record<string, string>>>>>;
  readonly policyViewDigest: string;
}

// invariant: a view is the one it was activated as only when the stored digest
// is both its own member and the digest of the rest of its content.
function addressedBy(value: unknown, viewDigest: string): value is ActivePolicyView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const material = Object.fromEntries(Object.entries(value).filter(([member]) => member !== "policyViewDigest"));
  const contentDigest = `sha256:${createHash("sha256").update(canonicalizeJsonV2(material)).digest("hex")}`;
  return Reflect.get(value, "policyViewDigest") === viewDigest && contentDigest === viewDigest;
}

function decodePolicyView(stored: StoredPolicyView): ActivePolicyView {
  let view: unknown;
  try {
    view = JSON.parse(stored.viewJson);
  } catch (error) {
    throw runtimeError("VES_RUNTIME_CORRUPT", "Stored Active Policy View is not JSON", error, true);
  }
  if (!addressedBy(view, stored.viewDigest))
    throw runtimeError("VES_RUNTIME_CORRUPT", "Active Policy View digest does not match its content", undefined, true);
  return Object.freeze(view);
}

export class RuntimePolicyViewStore {
  readonly #runtime: RuntimeStore;
  readonly #workspaceId: string;

  constructor(options: { readonly runtimeStore: RuntimeStore; readonly workspaceId: string }) {
    this.#runtime = options.runtimeStore;
    this.#workspaceId = options.workspaceId;
  }

  async load(): Promise<ActivePolicyView | undefined> {
    const stored = this.#runtime.getActivePolicyView(this.#workspaceId);
    return stored === undefined ? undefined : decodePolicyView(stored);
  }

  async save(
    candidate: ActivePolicyView,
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
