# Release custody tasks (#408)

## Execution plan

| Task | Deliverable | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| T1 | `docs/release-custody.md`: model, residual risks, procedures, rehearsal, checklist (CUST-01 to CUST-08) | agent | none | done |
| T2 | Tooling-denial rehearsal (section 8.1) reproduced on disposable keys | agent | T1 | done |
| T3 | Owner decisions O1 (custodian #2, ratifying reviewer), O3 (rotation), O6 (npm maintainers), O8 (bypass actor) | owner | T1 | blocked |
| T4 | Custodian #2 onboarded: collaborator `write`, CODEOWNERS pull request authored by custodian #2 (O4) | owner + custodian #2 | T3 | blocked |
| T5 | Workflow change: `environment:` on the signing jobs in `t76-publish-release.yml` and `t75-evidence-signing.yml`, shape guard updated; preserves or strengthens enforcement | agent (reviewed PR) | T3 | planned |
| T6 | Detached (per-custodian) TUF signing so a role threshold separates people (RR5) | agent + owner design review | T3 | planned |
| T7 | npm publication workflow for trusted publishing in a protected environment (3.3) | agent (reviewed PR) | T5 | planned |
| T8 | Secrets moved to protected environments, repository copies deleted (O2); online key provisioned under custody (O5); R2 scoping and locks (O7) | owner | T4, T5 | blocked |
| T9 | Approval rehearsal G1-G6 (section 8.2) executed and recorded | owner + custodian #2 | T4 | blocked |
| T10 | Ratification by owner and independent reviewer (O10); then a separate reviewed change to acceptance-matrix L8 | owner + reviewer | T8, T9 | blocked |

## Gate commands

| Level | Command |
| --- | --- |
| Readiness | `pnpm agent:check` |
| Quick | `pnpm gate:quick` |
| Focused (rehearsal positive controls) | `node --test tests/security/trust-key-separation.test.mjs tests/security/tuf-publication-security.test.mjs tests/e2e/tuf-update-client.test.mjs tests/build/t76-release-publication.test.mjs` |

## Completion rules

- T5 and T7 are workflow changes. Their pull request bodies must state whether
  they preserve, strengthen, or reduce enforcement (`docs/merge-governance.md`).
- No task may record a secret value, environment value, email, IP address, or
  token in any tracked file.
- Nothing is relabelled as independent custody until T10.
