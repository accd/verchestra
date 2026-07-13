import {
  BootstrapError,
  type MachineProfile,
  type MachineProfileSaveReceipt,
  type MachineProfileStorePort,
  type SecretBindingInspectorPort,
  type SecretBindingRequest
} from "@verchestra/application";

import { SecretBroker } from "./secret-broker.ts";
import { RuntimeStore } from "./runtime-store/runtime-store.ts";

export class RuntimeMachineProfileStore implements MachineProfileStorePort {
  readonly #runtime: RuntimeStore;
  readonly #workspaceId: string;

  constructor(options: { readonly runtimeStore: RuntimeStore; readonly workspaceId: string }) {
    this.#runtime = options.runtimeStore;
    this.#workspaceId = options.workspaceId;
  }

  async save(profile: MachineProfile): Promise<MachineProfileSaveReceipt> {
    if (profile.workspaceId !== this.#workspaceId) {
      throw new BootstrapError("VES_BOOTSTRAP_PROFILE_FAILED", "Machine Profile belongs to another Workspace");
    }
    try {
      return this.#runtime.saveMachineProfile(profile.workspaceId, JSON.stringify(profile));
    } catch (error) {
      throw new BootstrapError(
        "VES_BOOTSTRAP_PROFILE_FAILED",
        "Runtime Machine Profile persistence failed",
        {},
        {
          cause: error
        }
      );
    }
  }
}

export class SecretBrokerBindingInspector implements SecretBindingInspectorPort {
  readonly expectedStore: string;
  readonly #broker: SecretBroker;

  constructor(options: { readonly broker: SecretBroker; readonly expectedStore: string }) {
    if (
      options.expectedStore.trim().length === 0 ||
      options.expectedStore.length > 512 ||
      /[\u0000-\u001f]/u.test(options.expectedStore)
    ) {
      throw new BootstrapError("VES_BOOTSTRAP_INPUT_INVALID", "Expected secret-store description is invalid");
    }
    this.#broker = options.broker;
    this.expectedStore = options.expectedStore;
  }

  async isBound(binding: SecretBindingRequest): Promise<boolean> {
    try {
      await this.#broker.bind(binding);
      return true;
    } catch (error) {
      if ((error as { readonly code?: unknown }).code === "VES_SECRET_MISSING") return false;
      throw error;
    }
  }
}
