import type { PolicyValidation, PolicyView } from "./cedar-policy.ts";

export interface ActivatedPolicyView extends PolicyView {
  readonly policyViewDigest: string;
}

export interface PolicyViewStorePort {
  load(): Promise<ActivatedPolicyView | undefined>;
  save(
    candidate: ActivatedPolicyView,
    expectedGeneration: number
  ): Promise<{
    readonly activated: boolean;
    readonly conflict: boolean;
  }>;
}

export interface PolicyViewValidatorPort {
  validateView(view: PolicyView): PolicyValidation;
}

export interface PolicyActivationResult {
  readonly status: "activated" | "unchanged" | "rejected";
  readonly code: string;
  readonly policyViewDigest: string;
  readonly activeGeneration: number;
}

export class PolicyActivationService {
  readonly #validator: PolicyViewValidatorPort;
  readonly #store: PolicyViewStorePort;

  constructor(options: { readonly validator: PolicyViewValidatorPort; readonly store: PolicyViewStorePort }) {
    this.#validator = options.validator;
    this.#store = options.store;
  }

  async activate(candidate: PolicyView): Promise<PolicyActivationResult> {
    const active = await this.#store.load();
    const activeGeneration = active?.generation ?? 0;
    if (candidate.generation < activeGeneration) {
      return Object.freeze({
        status: "rejected",
        code: "VES_POLICY_GENERATION_DOWNGRADE",
        policyViewDigest: active?.policyViewDigest ?? "",
        activeGeneration
      });
    }
    const validation = this.#validator.validateView(candidate);
    if (!validation.valid) {
      return Object.freeze({
        status: "rejected",
        code: validation.code,
        policyViewDigest: active?.policyViewDigest ?? validation.policyViewDigest,
        activeGeneration
      });
    }
    if (active !== undefined && candidate.generation === active.generation) {
      return Object.freeze({
        status: active.policyViewDigest === validation.policyViewDigest ? "unchanged" : "rejected",
        code:
          active.policyViewDigest === validation.policyViewDigest
            ? "VES_POLICY_VIEW_UNCHANGED"
            : "VES_POLICY_GENERATION_CONFLICT",
        policyViewDigest: active.policyViewDigest,
        activeGeneration
      });
    }
    const activated: ActivatedPolicyView = Object.freeze({
      ...candidate,
      policyViewDigest: validation.policyViewDigest
    });
    const receipt = await this.#store.save(activated, activeGeneration);
    if (!receipt.activated || receipt.conflict) {
      return Object.freeze({
        status: "rejected",
        code: "VES_POLICY_ACTIVATION_CONFLICT",
        policyViewDigest: validation.policyViewDigest,
        activeGeneration
      });
    }
    return Object.freeze({
      status: "activated",
      code: "VES_POLICY_VIEW_ACTIVATED",
      policyViewDigest: validation.policyViewDigest,
      activeGeneration: candidate.generation
    });
  }
}
