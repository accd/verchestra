# Census gate enforcement tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | `test:census` stage in `gate:quick` (CGE-01) | `tests/agent-readiness/gate-selection.test.mjs`; `pnpm gate:quick` | Complete locally |
| T2 | Census-driven `gate:security` routing (CGE-02) | `tests/agent-readiness/gate-selection.test.mjs` | Complete locally |
| T3 | Proven-local-canonicalizer rule, allowlist, and direct byte-equality proof (CGE-03..05) | `tests/security/canonical-json-census.test.mjs`; `tests/agent-readiness/release-decision.test.mjs`; `pnpm gate:security` | Complete locally |
| T4 | Owner break-glass steps for a required `Security gate` check (CGE-06) | `spec.md` #395 section | Recorded; owner action pending |

## Measured cost

`test:census` adds about 0.5 s of wall time to `gate:quick`. Five local runs of
`pnpm run test:census` took 0.46 to 0.59 s, including the pnpm spawn. The test
itself reported 134 to 235 ms. It is a static scan of `packages/`, `apps/`, and
`scripts/`, with no network access, no build, and no clock or locale input.
