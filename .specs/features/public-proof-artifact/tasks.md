# Public Proof Artifact Tasks

1. **T1 — Deterministic generator.** `scripts/generate-proof-artifact.mjs`
   with the committed TEST-ONLY Ed25519 key, pinned clock and fixture input,
   fail-closed self-verification, and the `proof:generate` script.
2. **T2 — Committed artifact.** `docs/proof/execution-package.json`
   (RFC 8785 canonical bytes) and `docs/proof/execution-package.md`
   (generator-written page with fixture-vs-live labeling).
3. **T3 — Publication.** Site source + sidebar + LLM-manifest registration
   and the README link from "What works today".
4. **T4 — Protection.** `tests/unit/proof-artifact.test.mjs` (byte-identical
   drift with specific-cause failures, verification, provenance pins,
   secret/path scan) and the built-output assertions in
   `check-built-site.mjs`; discrimination sensor evidence.
