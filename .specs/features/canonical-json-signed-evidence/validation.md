# Validation — signed-evidence canonical JSON

Status: author-verified after reviewer correction; awaiting reviewer re-validation and required human review.

## Author evidence

- `node --test tests/unit/execution-package.test.mjs tests/security/execution-package-security.test.mjs tests/security/evidence-tamper.test.mjs tests/security/canonical-json-census.test.mjs tests/security/canonical-json-locale-allowlist.test.mjs` — 117 pass, 0 fail, 0 skip, 0 todo after the reviewer correction.
- `corepack pnpm gate:quick` — PASS; 2,067 unit tests and 153 readiness tests, with 0 fail, skip, or todo.
- `corepack pnpm gate:security` — PASS; all selected build, unit, contract, E2E, architecture, qualification, and security stages completed with 0 fail, skip, or todo.
- `corepack pnpm site:check` and `corepack pnpm site:build` — PASS. `site:test` is not claimed: its Playwright web-server parent exited after the Astro preview daemon started, before browser assertions ran.

The quick and security gates above were rerun after the V2 receiver-boundary correction.

## Reviewer correction for PR #305

The reviewer reproduced acceptance of a trusted-signer V2 payload whose
`requiredCapabilities` array was `['alpha', 'Zulu']` instead of canonical
code-unit order. The receiver now compares the complete normalized V2 payload
against the signed payload and returns `VES_EXECUTION_PACKAGE_INVALID` on a
mismatch. Schema V1 skips this comparison so its historical compatibility
semantics remain unchanged. The security regression
`trusted signer cannot seal non-canonical V2 set ordering` seals the forged
payload with the trusted test signer and proves the rejection.

The census entry for `packages/evidence/src/execution-package/execution-package.ts`
was updated from four to six canonicalizer signals to account for this
receiver comparison. No signing material or machine-local path was added.

## Independent rejection of candidate `b116e84`

The independent verifier rejected CJE-01 and CJE-05. The candidate routed every
set through the V1 locale comparator, but the predecessor used native
code-unit `sort()` for `uniqueStrings`, task component references, verification
commands, done criteria, and pending-task `blockedBy`. With mixed-case values,
that changed V1 payload bytes and identities. The original focused suite passed
because its fixture values did not discriminate those comparators.

The correction restores native `sort()` at the legacy default-sort sites for
both schema versions, retains V1 `localeCompare` only at its historical sites,
and adds a mixed-case regression test.

## Independent validation of corrected candidate `a06c242`

- **CJE-01 — PASS.** The V1 fixture remains pinned to
  `ebbf7e4c4f28af4efc95a2515cb7d4a19edd48749da9c829f67a8a5074db668a` and
  verifies under the V1 predicate. An independent runtime comparison loaded the
  predecessor at `b0e0c831` and the candidate with the same signer: their
  mixed-case V1 sealed artifacts were byte-identical, including every historical
  native-sort set and `blockedBy`.
- **CJE-02 and CJE-03 — PASS.** New packages emit schema V2 and the declared
  V2 predicate. The V2 paths use code-unit comparison or native `sort()` for
  all set-like lists; V1 alone retains the historical locale comparator sites.
- **CJE-04 — PASS.** The schema-to-canonicalization and predicate maps are
  closed. The focused security evidence rejects V1-to-V2 reinterpretation and
  an unsupported stored schema version before persistence or verification.
- **CJE-05 — PASS.** The focused suite completed 116/116 with 0 fail, skip, or
  todo, and `corepack pnpm agent:check` passed. In an isolated disposable
  checkout, changing the restored native `sort()` in `uniqueStrings` back to
  `localeCompare` made the V1 mixed-case regression test fail; no mutation was
  retained in the candidate worktree.

The independent review also found no private signing material or machine-local
path added by this candidate. Required human review remains the next action;
independent validation does not authorize a merge.
