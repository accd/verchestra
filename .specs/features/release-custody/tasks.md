# Release custody tasks (#408)

## Execution plan

| Task | Deliverable | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| T1 | `docs/release-custody.md`: model, residual risks, procedures, rehearsal, checklist (CUST-01 to CUST-08) | agent | none | done |
| T2 | Tooling-denial rehearsal (section 8.1) reproduced on disposable keys | agent | T1 | done |
| T3 | Owner decisions O1 (custodian #2, ratifying reviewer), O6 (npm maintainers), O8 (bypass actor). O3 (rotation) was decided on 2026-09-30: rotate all three reachable keys. O1 was decided on 2026-10-02: the owner names no custodian #2, because no second accountable human is available. O6 and O8 remain open | owner | T1 | O1 decided (none named) |
| T4 | Custodian #2 onboarded: collaborator `write`, CODEOWNERS pull request authored by custodian #2 (O4) | owner + custodian #2 | T3 | not planned (no custodian #2) |
| T5 | Workflow change: `environment:` on the signing jobs in `t76-publish-release.yml`, `t76-refresh-timestamp.yml`, and `t75-evidence-signing.yml`, reading renamed environment secrets; shape guards and the cross-workflow `signing-environments` guard; strengthens enforcement (CUST-09) | agent (reviewed PR) | owner authorization | done (awaiting merge) |
| T6 | Detached (per-custodian) TUF signing so a role threshold separates people (RR5) | agent + owner design review | T3 | planned |
| T7 | npm publication workflow for trusted publishing in a protected environment (3.3) | agent (reviewed PR) | T5 | planned |
| T8 | Secrets moved to protected environments (O2 steps 1-3, done 2026-09-30 with the owner as interim reviewer); online key provisioned under custody (O5, done); repository copies deleted (O2 step 4, owner, after merge and the `.3` re-sign); reviewer switched to custodian #2 with self-review prevented (after T4); R2 scoping and locks (O7) | owner | T4, T5 | blocked |
| T9 | Approval rehearsal G1-G6 (section 8.2) executed and recorded | owner + custodian #2 | T4 | not planned (no custodian #2) |
| T10 | Ratification by owner and independent reviewer (O10); then a separate reviewed change to acceptance-matrix L8 | owner + reviewer | T8, T9 | not planned (no custodian #2) |
| T11 | Rotation of the three reachable keys (O3) with retired anchors under `docs/qualification/trust/retired/`: the T76 tooling refuses a retired anchor for any role and requires each anchor's purpose; the T75 attestation enforces the reference window; separation test covers retired anchors and key reuse (CUST-10, CUST-11) | agent (owner-authorized) | T5 | done (awaiting merge) |

## Gate commands

| Level | Command |
| --- | --- |
| Readiness | `pnpm agent:check` |
| Quick | `pnpm gate:quick` |
| Focused (rehearsal positive controls) | `node --test tests/security/trust-key-separation.test.mjs tests/security/tuf-publication-security.test.mjs tests/e2e/tuf-update-client.test.mjs tests/build/t76-release-publication.test.mjs` |
| Focused (T5, T11) | `node --test tests/agent-readiness/signing-environments.test.mjs tests/agent-readiness/t76-publish-workflow.test.mjs tests/agent-readiness/t76-refresh-workflow.test.mjs tests/agent-readiness/t75-evidence-signing-workflow.test.mjs tests/security/t75-evidence-attestation.test.mjs tests/build/t76-timestamp-refresh.test.mjs` |

## Completion rules

- T5 and T7 are workflow changes. Their pull request bodies must state whether
  they preserve, strengthen, or reduce enforcement (`docs/merge-governance.md`).
- No task may record a secret value, environment value, email, IP address, or
  token in any tracked file.
- Nothing is relabelled as independent custody until T10.
