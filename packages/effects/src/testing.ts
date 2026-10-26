import type { EffectAdapter, EffectApplyResult, EffectIntent, PriorEffectState } from "@verchestra/application";

// invariant: ARQ-006 (#597). The scripted effect adapter that the self-test
// and the tests run the broker against lives here, never in the package's
// index.ts, so production code reaches a test double only by naming this
// module; the self-test composition is the one production module that does.
interface MockAdapterOptions {
  readonly apply?: EffectApplyResult;
  readonly inspect?: PriorEffectState;
  readonly applyError?: Error & { readonly outcomeUnknown?: boolean };
}

export class MockEffectAdapter implements EffectAdapter {
  readonly adapterId = "mock-effect-adapter";
  readonly #options: MockAdapterOptions;
  readonly appliedIntents: EffectIntent[] = [];
  readonly inspectedIntents: EffectIntent[] = [];
  applyCalls = 0;
  inspectCalls = 0;

  constructor(options: MockAdapterOptions = {}) {
    this.#options = options;
  }

  async apply(intent: EffectIntent, signal: AbortSignal): Promise<EffectApplyResult> {
    signal.throwIfAborted();
    this.applyCalls += 1;
    this.appliedIntents.push(intent);
    if (this.#options.applyError !== undefined) throw this.#options.applyError;
    return this.#options.apply ?? { outcome: "applied" };
  }

  async inspect(intent: EffectIntent): Promise<PriorEffectState> {
    this.inspectCalls += 1;
    this.inspectedIntents.push(intent);
    return this.#options.inspect ?? { state: "unknown" };
  }
}
