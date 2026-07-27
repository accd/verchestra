# Context Tokenizers Decision Specification

## Problem Statement

`DeterministicContextCompiler` delegates token counting to an injected
function (`packages/agent-runtime/src/context/context-compiler.ts:140,146`),
and no real implementation ships in the repository — tests inject
heuristics. Two environments injecting different estimators make different
priority-budget omission decisions: the same Execution Package compiles
different contexts on different machines. That quietly breaks the
portability promise the product is built on.

## Decision Required Before

T76 (Verified release candidate). The tokenizer identity becomes part of
sealed context manifests; changing it after 1.0 invalidates historical
digests.

## Options

### Option A — Real per-model-family tokenizers (review recommendation)

- Ship actual tokenizer implementations per model family (for example a
  tiktoken-compatible BPE for OpenAI-family models).
- Record the tokenizer identity (name + version) in the context manifest,
  covered by its digest, so omission decisions are reproducible.
- Cost: new runtime dependency — **requires explicit human approval and a
  lockfile update** per root instructions; WASM/JS tokenizer packages also
  add supply-chain surface that must pass `pnpm gate:security`.

### Option B — One pinned deterministic estimator for all models

- Standardize a single repository-owned estimator (for example a fixed
  byte/char heuristic), pinned and versioned, used identically everywhere.
- Gains: zero dependencies, full determinism, simple supply chain.
- Costs: systematic over/under-estimation versus real model tokenizers;
  context budgets are less efficient, but they are *consistently* wrong
  rather than *divergently* wrong.

### Option C — Hybrid: pinned estimator default + optional real tokenizers

- Option B as the qualified default; Option A tokenizers as approved
  optional adapters recorded in the manifest.
- Costs: two qualified paths to test and keep honest.

## Evaluation Criteria

- Reproducibility: identical package → identical compiled context anywhere.
- Supply-chain cost of new dependencies versus estimation accuracy.
- Manifest/digest impact and historical evidence compatibility.

## Acceptance Criteria

1. **TOK-01** — WHEN the decision is made THEN it SHALL be recorded as an
   architecture decision in `.specs/STATE.md` before T76 starts.
2. **TOK-02** — WHEN any tokenizer ships THEN its identity and version
   SHALL be recorded in the context manifest and covered by the manifest
   digest.
3. **TOK-03** — IF a new dependency is chosen THEN it SHALL pass the
   dependency-approval rule, lockfile update, and security gate before
   merge.
4. **TOK-04** — WHEN the compiler runs without an injected estimator THEN
   it SHALL use the qualified default rather than failing or behaving
   environment-dependently.

## Success Criteria

- Compiled context is a pure function of the package and the recorded
  tokenizer identity — never of the machine it runs on.
