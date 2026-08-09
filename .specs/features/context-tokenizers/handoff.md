---
schema: verchestra-feature-handoff/v1
feature: context-tokenizers
issue: 218
status: in_progress
branch: main
baseRevision: 1f21582850ec48973794e3cb7f6c11f0531c97e5
lastCompletedTask: T1
nextTask: T2
lastGate: null
updatedAt: 2026-08-09T16:00:00Z
---

# Scope

Replace the injected, unimplemented token estimator in
`DeterministicContextCompiler` with a qualified default whose identity is
recorded in the context manifest digest (review item R6, issue #218).
**The decision is made** — Option B, recorded as **AD-015** in
`.specs/STATE.md` on 2026-08-09. Implementation must land before T76 (#17)
qualification starts.

# Completed Evidence

- **T1 (decision) — DONE.** Owner chose Option B on 2026-08-09 against
  measured evidence at `1f21582`: the estimator is a bare
  `(content: string) => number` closure with no port and no identity
  (`context-compiler.ts:140-151`), zero product wirings exist in
  `packages/`, and the two real heuristics in the repository diverge ~25% on
  ordinary prose (`self-test-full-scenario.ts:380` word-count versus
  `tests/helpers/context-compiler-fixture.mjs:67` chars/4). The divergence
  changes **which** fragments are included via the greedy accumulation at
  `context-compiler.ts:228-240` and can refuse a whole compile at line 222.
  `packages/agent-runtime` carries zero third-party runtime dependencies.
  Recorded as AD-015 (TOK-01 satisfied).

# Next Exact Action

**T2 — ship the pinned estimator module** in `packages/agent-runtime` with an
exported identity constant (`name` + `version`), calibrated to over-estimate
so error fails closed rather than dispatching an oversized context. Then:

- **T3** — add `tokenizer: { name, version }` to `ContextManifest`
  (`context-compiler.ts:51-74`) and to the `unsigned` literal
  (`context-compiler.ts:288-314`); it enters `manifestId` and the signature
  automatically because both derive from the whole object (line 315, 318).
  Satisfies TOK-02.
- **T4** — make `estimateTokens` an optional override defaulting to the
  qualified estimator, and wire it at the composition root so no product run
  depends on caller injection. Satisfies TOK-04. Keep the
  positive-safe-integer guard at `context-compiler.ts:375-385`.
- **T5** — adopt the same estimator for the second estimation surface,
  `ContextCapacityEstimatorPort`
  (`packages/agent-runtime/src/context/backend-serializers.ts:21-23`), so
  the repository ends with one estimator instead of three heuristics across
  two surfaces.
- **T6** — discrimination sensor: a test proving that swapping the pinned
  estimator for a differently-calibrated one changes `manifestId` **and** is
  attributable, because the manifest now records tokenizer identity.

# Blockers

None. The decision that blocked this feature is made.

# Decisions

- **AD-015 (owner, 2026-08-09):** Option B — one pinned, versioned,
  repository-owned deterministic estimator; no third-party tokenizer
  dependency (TOK-03 does not engage).
- Calibration is deliberately conservative (over-estimate), so estimation
  error omits context or refuses the compile rather than dispatching beyond
  a model's real capacity.
- Follows the AD-009 / CJ-02 precedent: implement the primitive internally
  rather than widen the dependency boundary of a package that currently has
  zero third-party runtime dependencies.
- Changing the estimator after 1.0 invalidates historical context manifests
  and requires a versioned migration, exactly like a canonicalization
  change.

# Files Intentionally Left Unchanged

- The dependency manifest and lockfile — Option B adds no dependency.
- `packages/application/src/execution/budget-meter.ts` — budget enforcement
  (T68b) prices provider-reported actual usage; this feature estimates
  context size before dispatch. Different concerns.

# Findings Recorded For Later

- `context-compiler.ts:76-86` and `backend-serializers.ts:46-55` each carry
  a private `canonicalJson()` that orders keys with ambient `localeCompare`,
  which the canonical-JSON contract prohibits on a trust path. Both sit on
  the digest path this feature touches. Routed to **#58** (its inventory
  already names "agent-runtime context"); not fixed here, because #58 owns
  one canonicalization contract for the whole repository.
