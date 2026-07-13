# T38 Governed Skill Lifecycle Validation

## Scope

- Task: T38 — Implement Skill registry, ownership graph, TLC, and Grill routing
- Requirements: VES-SKL-001…003/005…006, VES-SPC-001…003
- Commit target: `feat(skills): add governed lifecycle registry`
- Focused evidence: 44 cases (21 unit, 11 contract, 12 security)
- Spec deviations: none

T38 introduces signed immutable Skill locks, strict compatibility/license/source verification, executable-content classification, a closed lifecycle ownership graph, mandatory TLC ownership, exact Grill pre-Specify routing, reviewed update plans, and transactional activation with rollback. Installing a Skill grants zero execution authority.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/governed-skill-registry.test.mjs tests/contract/skill-update-lifecycle.test.mjs tests/security/skill-executable-content-security.test.mjs` | PASS — 44 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,439 unit, 10 architecture, 248 qualification, 242 security, and 49 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| TLC immutable lock | Commit/digest/signature/license/schema/version/harness mutations | Yes |
| Mandatory ownership | All five TLC phases plus five independent overlap mutations | Yes |
| Grill ordering/output | Enabled/disabled routes and exact Context/ADR contract | Yes |
| Ownership graph | Duplicate/unknown owner and dependency-cycle cases | Yes |
| Executable classification | JS, PowerShell, Python, shell, Wasm, executable bit, shebang, package scripts | Yes |
| No implicit authority | Undeclared executable rejection and approved Plugin with `executionAuthority:false` | Yes |
| Update plan | Current/candidate digests, contiguous generation, qualification, visible diff | Yes |
| Tamper/compatibility | Lock/source signatures, digest, license, schema, harness/TLC versions | Yes |
| Transactionality | Successful stage/commit, commit-failure rollback, stale candidate | Yes |
| Minimum floor | 44 focused cases versus required 35 | Yes |

## Non-shallow checks

- TLC owns Specify, Design, Tasks, Execute, and Verify; Grill owns none and runs only at `pre-specify`.
- Matt-sourced or any other overlapping lifecycle Skill is rejected by the same generic ownership rule.
- Executable behavior is detected from content reality, not trusted declarations.
- Approved Tool/Plugin classification permits packaging but still grants the Skill itself no execution capability.
- Lock digest and both lock/source signatures are verified before resolution or activation.
- Candidate generation must be contiguous, qualification must pass, and a human-visible diff is mandatory.
- Commit failure invokes rollback and emits only a stable sanitized error; the previous lock remains authoritative.

## Verdict

PASS. Tests preceded implementation, all overlap/hidden-script/tamper/incompatibility/ordering/rollback criteria are covered, the test floor is exceeded, and the security gate passes.
