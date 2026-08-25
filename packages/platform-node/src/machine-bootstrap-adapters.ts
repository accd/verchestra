import {
  BootstrapError,
  type MachineProfile,
  type MachineProfileSaveReceipt,
  type MachineProfileStorePort,
  type SecretBindingInspectorPort,
  type SecretBindingRequest
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";

import { SecretBroker } from "./secret-broker.ts";
import { RuntimeStore } from "./runtime-store/runtime-store.ts";

export class RuntimeMachineProfileStore implements MachineProfileStorePort {
  readonly #runtime: RuntimeStore;
  readonly #workspaceId: string;

  constructor(options: { readonly runtimeStore: RuntimeStore; readonly workspaceId: string }) {
    this.#runtime = options.runtimeStore;
    this.#workspaceId = options.workspaceId;
  }

  // The stored `profile_json` text is what `RuntimeStore.saveMachineProfile`
  // hashes into `profile_digest`, and that digest is what surfaces as
  // `BootstrapResult.profileDigest`. Encoding with the qualified contract
  // (canonicalizeJsonV2, RFC 8785 JCS) makes that identity a function of the
  // profile's content, so two machines that discovered the same Drivers report
  // the same digest (issue #58, AD-018).
  //
  // Persistence note (checked, not assumed): a row written by an older build
  // is not invalidated. `machine_profiles` is a single latest-wins row per
  // Workspace; nothing re-derives its digest on read (`getMachineProfile` and
  // `listMachineProfiles` only parse the JSON and read members by name), and
  // the upsert overwrites whenever the digest differs. The one observable
  // cross-version effect is that the first bootstrap after this change reports
  // `profileChanged: true` and a different `profileDigest` string for an
  // unchanged machine, after which it is stable again.
  async save(profile: MachineProfile): Promise<MachineProfileSaveReceipt> {
    if (profile.workspaceId !== this.#workspaceId) {
      throw new BootstrapError("VES_BOOTSTRAP_PROFILE_FAILED", "Machine Profile belongs to another Workspace");
    }
    try {
      return this.#runtime.saveMachineProfile(profile.workspaceId, canonicalizeJsonV2(profile));
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
