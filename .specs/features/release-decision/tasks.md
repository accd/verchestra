# Release Decision Tasks

Issue: #18 (T77). Bound revision `3d363f782bad40e5c5be8252e6626216b4f60248`.

## Task breakdown

| Task | Outcome | State |
| --- | --- | --- |
| T1 | Enforce `RELEASE-DECISION-CONTRACT.md` in `scripts/agent-readiness.mjs`, surfaced by `pnpm agent:check` | Done |
| T2 | One behavior test per fail-closed dimension, plus the repository-level cases that need real Git history | Done |
| T3 | Compute every machine-derivable value for the 1.0 decision and record the command that reproduces it | Done — `prepared-decision.md` sections 1 and 2 |
| T4 | Write the exact signing procedure using the existing evidence-key custody pattern | Done — `prepared-decision.md` section 4 |
| T5 | Rank the reasons the recorded verdict is `reject`, each citing a tracked file and naming what would lift it | Done — `prepared-decision.md` section 5 |
| T6 | State what each reviewer is being asked to review | Done — `prepared-decision.md` section 6 |
| T7 | Ratify the canonical decision body definition, then verify the signature in the validator | **Not started.** Requires the owner's ratification; see section 5. |
| T8 | Provision the decision signing key, obtain both reviews, sign, and open the decision pull request | **Not started.** Human acts. |

## Test coverage matrix

`tests/agent-readiness/release-decision.test.mjs`, 45 cases. Every row is a
fixture that violates exactly one dimension; the same fixture without that
violation is asserted to be accepted by the first case in the file.

| Contract condition | Case |
| --- | --- |
| Missing or malformed frontmatter | an empty file; a heading-only placeholder; a malformed frontmatter line |
| `schema` exact | a wrong schema |
| Version identity | a version the filename does not name; the decision filename pattern |
| At most one file per version | a version may have at most one decision file |
| `decision` in `{promote, reject}` | a verdict outside promote and reject; a missing verdict |
| `candidateRevision` is a real commit | not a full commit id; a well-formed revision this repository does not contain |
| `candidateRevision` reachable from the trusted target | a candidate revision reachable only through a side ref (real Git history) |
| `gateRevision` = `candidateRevision` | gate evidence from another revision |
| `candidateReleaseDigest` shape | a release digest that is not `sha256:<64 hex>` |
| `requirementsRegister` = the register at that revision | not a sha256; not the register at the candidate revision; the register digest and count come from Git, not from the decision (real Git history); a candidate revision with no register at all |
| `requirementsClosed` closed form and real count | counts relabelled to read as complete; requirements that are not all evidenced; a denominator the register does not declare |
| No gate other than `gate:release` | a gate other than the release gate; a broader gate set that merely includes the release gate; no gate at all |
| `gateResults` all `pass` | a failing gate; a gate with no recorded result |
| `skipped`, `todo`, `survivingMutants` = 0 | a skipped case; a todo case; a surviving mutant |
| No missing qualification report in the chain | a qualification report the chain does not have; a chain entry that is not a task id; no chain at all |
| Three distinct accountable identities | operational reviewer who is the deciding human; security reviewer who is the deciding human; one person holding both reviewer roles; a missing security reviewer; the contract template copied verbatim |
| `decidedAt` RFC 3339 UTC | a decision instant that is not RFC 3339 UTC |
| `signature` and `publicKeyRef` present | a missing signature; an unfilled signature placeholder; a missing public key reference |
| `reviewedIn` a pull request URL | no reviewed pull request; a reviewedIn that is not a pull request URL |
| Absence is not a failure | no decision file is not a failure, because no decision has been made |

## Requirement traceability

| Requirement | Evidence |
| --- | --- |
| RD-01 | `scripts/agent-readiness.mjs` `validateReleaseDecision` and its helpers; every row of the coverage matrix above |
| RD-02 | `readReleaseDecisions` returns early on a directory with no decision file; case "no decision file is not a failure"; `pnpm agent:check` PASS in this worktree with no decision file present |
| RD-03 | Enforcement is `checkReleaseDecisions` in `scripts/agent-readiness.mjs`, called from `checkRepository` beside `checkQualificationChain`, reporting through the same `docs/qualification: ` prefix. No new script, no new gate, no new package command. |
| RD-04 | `tests/agent-readiness/release-decision.test.mjs`, 45 cases, all fixtures synthetic |
| RD-05 | `prepared-decision.md` sections 1 and 2 |
| RD-06 | `prepared-decision.md` section 4, executed end to end per section 4.4 |

## Execution evidence

- `node --test tests/agent-readiness/release-decision.test.mjs` — 45 tests, 45 pass, 0 fail, 0 skipped, 0 todo.
- `pnpm test:agent-readiness` — 240 tests, 240 pass, 0 fail, 0 skipped, 0 todo.
- `node scripts/agent-check.mjs` — `agent:check PASS`.
- `node scripts/requirements-trace.mjs` — `registered: 93`, `referenced: 93`, `declared gaps: 0`, `traceability CONSISTENT`, `T77 closure MET`, exit 0.
- `node scripts/complexity.mjs check` — PASS, nothing above the target of 10 unaccounted; no baseline entry was added or raised.
- Discrimination sensor: twelve mutations, twelve killed, zero survivors. Recorded in `docs/qualification/t77-validation.md`.

## 5. Open gaps, stated rather than implied

**The signature is checked for presence, not verified.**
`RELEASE-DECISION-CONTRACT.md`'s fail-closed table names "An unresolvable
`publicKeyRef`, or a signature that does not verify". The validator added here
checks that both fields are present and not a template placeholder. It does not
resolve the key reference and does not verify the signature, because verifying it
requires ratifying a canonical decision body — which bytes are signed — and that
is the owner's decision, not this feature's. `prepared-decision.md` section 4.1
proposes a definition. T7 above closes the gap once that proposal is ratified.

This gap is recorded here, in the specification, and in the code, rather than
being left for a reader to discover, because a validator with a silently
unenforced dimension reads as enforcement while enforcing nothing.
