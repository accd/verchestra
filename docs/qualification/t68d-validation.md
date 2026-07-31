---
schema: verchestra-qualification-report/v1
task: T68d
revision: 73144b0d439b16308e1d2ddb827b1764ff70a21e
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: 73144b0d439b16308e1d2ddb827b1764ff70a21e
criteriaEvidence: 5 of 5 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 5 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/145
---

# T68d Policy Hardening Validation

## Scope

T68d thickens the boundary that decides whether an agent may act on the world.
It adds a declarative policy-test runner that evaluates
principal/action/resource/context cases against the production
`CedarPolicyAdapter` and fails on any mismatch; structured explanations that
trace a decision to its determining policy, layer, and source statement with
secret-shaped values redacted before they can enter evidence; and versioned,
signed policy bundles whose digests are recomputed from the sources on every
verification, referenced from the sealed Execution Package by content digest.

31 cases across two suites, against a declared minimum of 15.

| Suite | Cases |
| --- | --- |
| `tests/unit/policy-hardening.test.mjs` | 20 |
| `tests/unit/execution-package-repair-policy.test.mjs` | 11 |

## Deterministic gates

Both gates ran on a clean checkout detached at the implementation revision,
dispatched through `full-validation.yml`; each run's artifact records the
revision and the profile.

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — [run 30672257071](https://github.com/accd/verchestra/actions/runs/30672257071) |
| `pnpm gate:security` | PASS — [run 30672258537](https://github.com/accd/verchestra/actions/runs/30672258537) |

| Profile | Stages |
| --- | --- |
| `gate:quick` | `format:check`, `lint`, `typecheck`, `test:unit`, `test:agent-readiness` |
| `gate:security` | `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:architecture`, `test:qualification`, `test:security`, `test:fault` |

## Adequacy matrix

Anchored in `.specs/features/policy-hardening/spec.md`.

| Criterion | Requirement | Assertion |
| --- | --- | --- |
| POL-01 | Declarative cases evaluate against the workspace policy set and fail on mismatch, in `gate:quick` | `policy-hardening.test.mjs` - a passing corpus, a per-case mismatch report carrying the actual decision and code, an expected-code mismatch failing even when the decision matches, and malformed cases rejected. The runner executes inside `test:unit`, which `gate:quick` runs. Deviation stated plainly: there is no `vestra policy test` CLI verb, because the installed manifest exposes only `init` and adding commands is composition-root work (#64); the criterion's substance - declarative cases gating on mismatch - is enforced, its CLI spelling is not |
| POL-02 | Denials carry the determining policy, failing attribute, and expected-versus-actual, codes unchanged | `policy-hardening.test.mjs` - explanations name the determining policy id, layer, and source statement; the id is asserted to be the real compiled `${layer}.${id}`, not a placeholder; codes pass through unchanged |
| POL-03 | The sealed package references the active bundle by content digest; bundles versioned and signed | `execution-package-repair-policy.test.mjs` - `policyBundleDigest` seals verbatim, is covered by the payload digest, and coexists with `onGateFailure`; `policy-hardening.test.mjs` - deterministic, order-independent bundle digests under the trust-root signer |
| POL-04 | Digest mismatch, unknown version, or invalid signature fail closed with distinct errors | `policy-hardening.test.mjs` - modified source, swapped digest, forged signature, unknown field, a digest that does not reproduce even with a valid signature, and a source that does not match its recorded digest all fail |
| POL-05 | Explanations pass the redaction boundary; secrets never leave | `policy-hardening.test.mjs` - secret-shaped values are replaced before an explanation can enter evidence, and the redaction count is reported rather than silent |

## Discrimination sensor

| Mutation | Criterion | Result |
| --- | --- | --- |
| A case with the wrong decision passes anyway | POL-01 | KILLED |
| Explanation redaction returns the original value | POL-05 | KILLED |
| Per-policy source digests stop being recomputed on verify | POL-04 | KILLED |
| The package accepts a `policyBundleDigest` that is not a digest | POL-03 | KILLED |
| The explanation entry carries a placeholder instead of the real policy id | POL-02 | KILLED |

Two of these began as survivors, and the suite was strengthened until they
died rather than the mutations being dropped. Removing the per-policy digest
recomputation was invisible because every tampering test also broke the
bundle-level digest; the new case re-signs a tampered source whose recorded
digest is stale, which only the recomputation can catch. And nothing asserted
the explanation's policy id was real, so a placeholder survived; the assertion
now requires the compiled `${layer}.${id}` present in the decision.

## Non-shallow checks

- The runner evaluates through the production `CedarPolicyAdapter`, not a
  reimplementation, so a case that passes here is evidence about the engine
  that runs in the product.
- A bundle whose recorded digests do not reproduce is tampered whatever its
  signature says; signature validity is necessary, never sufficient.
- A determining policy the view cannot name is surfaced as such instead of
  hidden, because the decision and the view disagreeing is itself a finding.
- Explanations are redacted before they exist as strings anywhere evidence can
  reach, not at display time.

## Verdict

T68d is complete for its declared scope, with the POL-01 CLI-spelling deviation
stated above rather than papered over. Five of five acceptance criteria have
file-and-assertion evidence, both declared gates pass on the implementation
revision through external runs, and every sensor mutation was killed - two of
them only after the suite was strengthened, which is the sensor doing its job.

What this report does not assert: independent verification, or recorded human
acceptance - `docs/qualification/REPORT-CONTRACT.md` deliberately has no field
for either, and `docs/merge-governance.md` states why independence is not
obtainable by configuration in a single-collaborator repository.
