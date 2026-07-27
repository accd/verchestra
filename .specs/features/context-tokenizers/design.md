# Context Tokenizers Decision Design Notes

## Current State (verified)

- `#estimate: (content: string) => number` is constructor-injected
  (`context-compiler.ts:140-151`) and drives `estimatedTokens`, omission
  reasons (`priority-budget`, `model-capacity`), and `mandatoryTokens`.
- Only tests and fixtures inject implementations
  (`tests/helpers/context-compiler-fixture.mjs`); no product default exists.
- The context manifest is already signed and digested, so adding
  `tokenizer: { name, version }` to it is a schema-generator change, not a
  redesign.

## Portability Failure Mode

```text
Machine A: inject lenient estimator → fragment X fits priority budget
Machine B: inject strict estimator → fragment X omitted (priority-budget)
→ same package, different compiled context, different agent behavior
→ both manifests verify: nothing in the digest records *why* they differ
```

Recording the tokenizer identity in the manifest (TOK-02) makes the
difference visible; standardizing the implementation (Option A or B) makes
it impossible.

## Dependency Note

Real tokenizers (Option A) typically arrive as WASM/JS packages. Root
instructions require explicit human approval plus lockfile update for any
dependency addition, and the security gate covers supply-chain review. This
is the main cost axis against Option B's "consistently approximate"
trade-off.

## Interaction with Other Features

- Independent of budget enforcement (T68b): that feature prices actual
  provider-reported usage; this one estimates context size before dispatch.
- The chosen default must be wired at the composition root so product runs
  never depend on caller injection (TOK-04).
