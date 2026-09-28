# Census gate enforcement validation

Issue: #395. Base: `origin/main` at `20071a78eb5b96b9de63e5e9c863b6997643c767`.

## Requirement evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| CGE-01 | `scripts/gate-stages.mjs:5-13`: `gate:quick` ends with `test:census`. `package.json:38`: `test:census` is `node --test tests/security/canonical-json-census.test.mjs`. `tests/agent-readiness/gate-selection.test.mjs:355` asserts both and asserts that `gate:security`/`gate:release` still run `test:security`. `tests/agent-readiness/gate-selection.test.mjs:165,178` pin the stage union and the seven-stage quick profile. | Verified |
| CGE-02 | `scripts/gate-selection.mjs:64-81` holds the census surface pattern, the fail-closed `loadCensusPaths` (`:69`), and `selectCensusGate` (`:77`), which applies them to every changed path. Tests in `tests/agent-readiness/gate-selection.test.mjs`: `:365` checks that every inventoried path selects `gate:security`, including `scripts/agent-readiness.mjs` and `scripts/t76-publish-release.mjs`. `:379` checks that routing follows the injected inventory and that a non-inventoried script stays on `gate:quick`. `:393` covers the census, policy, and script surface. `:397` checks that a malformed, non-JSON, or missing inventory throws. | Verified |
| CGE-03 | The `docs/canonical-json-compatibility.md` "Proven local canonicalizers" section (line 84 onward) states both conditions and names the enforcing test. | Verified |
| CGE-04 | `scripts/canonical-json-census.mjs:45-53` holds the closed `PROVEN_LOCAL_CANONICALIZERS` allowlist, the definition detector, and the import-only V2 detector. `validateLocalCanonicalizers` (`:171`) returns `unprovenPaths`, `unnamedProofPaths`, and `staleAllowlistPaths`. Tests in `tests/security/canonical-json-census.test.mjs`: `:228` asserts the live repository has none of the three, pins the allowlist to `scripts/agent-readiness.mjs`, and checks that its reason names the proof and that the proof compares against `canonicalizeJsonV2`. `:250` asserts that a comment mention is not an import and that a local copy without the import is rejected. `:268` asserts an unnamed proof and a stale entry are rejected. | Verified |
| CGE-05 | `scripts/agent-readiness.mjs` exports `canonicalJson`; the census signal counts are unchanged. `tests/agent-readiness/release-decision.test.mjs:132-151` asserts `canonicalJson(value) === canonicalizeJsonV2(value)` over the decision-claims shape, code-unit member ordering (astral, BMP-high, accented, empty, and numeric-like keys), escapes and control characters, the number forms, and nesting. The census reason for `scripts/agent-readiness.mjs` in `docs/canonical-json-census.json:955` names this test. | Verified |
| CGE-06 | `git diff --stat` touches no `.github/` path. The owner steps are in `spec.md`, "#395: required-check decision". | Verified; owner action pending |

## Discrimination

- Removing `scripts/agent-readiness.mjs` from the allowlist makes
  `validateLocalCanonicalizers` return
  `unprovenPaths: ["scripts/agent-readiness.mjs"]`.
- Replacing its census reason with one that does not name the proof makes it
  return `unnamedProofPaths: ["scripts/agent-readiness.mjs"]`.
- Both were executed against the live inventory.
- The byte-equality test includes `Z`/`a` and `￿`/astral key pairs. A
  locale-ordered or code-point-ordered encoder would order those pairs
  differently.

## Measured cost of CGE-01

`pnpm run test:census` took 0.46, 0.48, 0.55, 0.59, and 0.48 s of wall time over
five runs, including the pnpm spawn. The test reported 134 to 235 ms.

## Gates

See `handoff.md` `lastGate` and the report accompanying the branch.
