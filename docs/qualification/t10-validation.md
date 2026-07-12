# T10 Validation — Repository and Stable Quality Gates

**Gate:** `corepack pnpm@10.34.5 gate:build`  
**Result:** PASS — 10 architecture cases plus 248 retained qualification cases; 0 failed, 0 skipped.  
**Additional evidence:** `gate:quick`, `gate:full`, `gate:security`, and `gate:release` all executed fully and passed. Offline frozen install passed for all 17 workspace projects.
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Done-when / requirement | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Approved package layout | `repository-boundaries.test.mjs:23` — exact directory list equals `EXPECTED_PACKAGES` | Complete approved modular-monolith graph | Yes |
| Deterministic private ESM packages | `repository-boundaries.test.mjs:29–31` — exact `private`, `version`, and `type` values | Non-publishable exact-version ESM workspace packages | Yes |
| Domain inward rule | `repository-boundaries.test.mjs:36–37` — contracts allowed; application rejected with `VES_ARCH_INWARD_RULE` | Domain depends only on contracts/internal language types | Yes |
| Application inward rule | `repository-boundaries.test.mjs:41–45` — domain allowed; drivers rejected with `VES_ARCH_CONCRETE_ADAPTER_IMPORT` | Application imports no concrete adapter | Yes |
| Adapter isolation | `repository-boundaries.test.mjs:49–53` — application allowed; sibling adapter rejected | Adapters implement inward ports without coupling | Yes |
| CLI composition root | `repository-boundaries.test.mjs:57–58` — application and driver edges allowed | CLI alone composes concrete adapters | Yes |
| Domain purity | `repository-boundaries.test.mjs:62–65` — exact Node import and environment-access findings | Domain reads no environment/global platform state | Yes |
| Third-party quarantine | `repository-boundaries.test.mjs:69–72` — application rejected; distribution accepted | Qualified libraries remain in owning adapters | Yes |
| Actual source scan | `repository-boundaries.test.mjs:76` — full scan equals `[]` | Current tree has zero boundary violations | Yes |
| Five stable gates | `repository-boundaries.test.mjs:84–85` — every smoke entry exits `0` and identifies its gate; full executions separately passed | quick/full/build/security/release entrypoints executable | Yes |
| Offline deterministic install | command evidence: `pnpm install --frozen-lockfile --offline --ignore-scripts` | Clean install succeeds from exact lock/cache | Yes |

## Check B — Non-shallow

The suite compares the entire package graph, every manifest's critical fields, exact allow/deny results and stable architecture codes, concrete forbidden source patterns, the live product source scan, and subprocess exit/output for every gate. The deterministic install and every gate were also executed outside smoke mode.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Package graph/manifests | T10 layout and deterministic-build criteria | Yes |
| Inward dependency and source inspection | AD-013 and T10 forbidden-edge criterion | Yes |
| Gate smoke/full execution | VES-VFY-001…002 and T10 five-gate criterion | Yes |
| Offline frozen install | T10 offline lock/cache criterion | Yes |

## Check D — Guidelines

Tests follow design sections 1–2 and 11, T10, the generated Gate Check Commands, and exact-pinned tool versions. TypeScript 6.0.3 is selected instead of 7.0.2 because `typescript-eslint` 8.63.0 declares support only below TypeScript 6.1; no peer incompatibility is accepted in the gate foundation.

## Adequacy verdict

PASS — every T10 criterion has concrete evidence, all 10 architecture cases are requirement-bound, all five real gates pass, and the offline frozen install succeeds without network resolution.
