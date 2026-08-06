---
schema: verchestra-qualification-report/v1
task: T71
revision: 9e663bd6b3885f6e30f46d56d39915bd55ce2633
gates: pnpm gate:quick, pnpm gate:full, pnpm gate:security
gateResults: pass, pass, pass
gateRevision: 9e663bd6b3885f6e30f46d56d39915bd55ce2633
criteriaEvidence: 10 of 10 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 5 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/187
---

# T71 Full, Fault, and Approved-Driver Self-Test Profiles Validation

## Scope

T71 gives the T69/T70 Self-Test trust domain its two remaining declared profiles. The `full` profile drives the complete delivery path — Execution Package, approval, context compilation, model routing, a read-only effect, independent verification, portable Handoff, and terminal Run Capsule — through the real production APIs inside one disposable trust domain, then proves process-independent, exactly-once convergence by hard-crashing a child process before and after each of eleven registered durable boundaries and resuming from the same disposable state. The `drivers` profile exercises the qualified Claude Code, Codex, and OpenCode/Qwen boundaries with deterministic local substitutes, binds the exact human-inspectable review surface, proves denied authority reaches zero provider boundaries, and proves no writer Tool is reachable. Both are packaged behind `vestra self-test --profile <id>`. The implementation merged through pull request #182 (issue #12) across the commit range `0793779..ec258a2`; this report is written by an independent verifier who did not author it.

## Deterministic gates

All three gates were run on the primary Windows worktree at the bound revision with the qualified toolchain (Node 24.14.0, pnpm 10.34.5).

| Command           | Result | Evidence |
| ----------------- | ------ | -------- |
| `pnpm gate:quick` | PASS   | `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit`, `test:agent-readiness` |
| `pnpm gate:full`  | PASS   | 3,330 cases green: 1,894 unit, 446 contract, 565 integration, 142 e2e, 283 fault — 0 failed, 0 skipped, 0 todo |
| `pnpm gate:security` | PASS | adds `build`, `test:architecture`, `test:qualification`, and `test:security` to the full surface — 0 skipped, 0 todo |

`gate:full` and `gate:security` are the substantive profiles T71 declares (TST-01 names `gate:quick` and `gate:security`); they run the integration, e2e, fault, architecture, and security scopes this task's evidence lives in.

## Revision binding

This report binds `9e663bd`, the current `main` tip, which is the merged T71 work at `ec258a2` (PR #182) plus one documentation-only commit (AD-012). `git diff ec258a2 9e663bd` touches exactly one file, `.specs/STATE.md` (+17, −0), and changes no code, test, schema, or gate script, so the qualified T71 behavior at `9e663bd` is byte-identical to `ec258a2`. The three gates above were run locally at `9e663bd`. Independent Linux corroboration exists at the pure T71 tip `ec258a2`: the `CI` Quality gate and `CodeQL` both pass on the `push` to `main` at that revision, and the final PR head `b4796af` passed `CI` before merge. The ubuntu-only CI matrix is the reason a local Windows `gate:full` was also run: it exercised the integration, e2e, and fault scopes on a platform CI never runs, and found no T71 defect.

## Adequacy matrix

Anchored in `.specs/features/self-test-full-driver-profiles/spec.md`. The T71 evidence is 137 new cases across seven suites (34 unit rules, 2 file-record-store, 6 full-scenario integration, 5 driver-scenario integration, 23 full crash-matrix, 26 durable-crash-runner, 41 driver-authority security), above the declared minimum of 30, plus the extended CLI e2e and scenario-rule suites.

| Criterion | Requirement | Assertion |
| --------- | ----------- | --------- |
| FULL-01 | Complete delivery path exercises the production APIs | `self-test-full-scenario.test.mjs` — "the full scenario exercises every successful production boundary" and "the complete delivery path uses its production APIs" drive package, approval, context, routing, effect, verification, Handoff, and Capsule; `self-test-t71-rules.test.mjs` — `assertFullWorkflowFacts`/`fullWorkflowChecks` reject every one of fourteen invalid observed facts |
| FULL-02 | Closed durable-boundary catalog rejects missing, duplicate, unknown, or failed facts | `self-test-t71-rules.test.mjs` — `assertDurableBoundaryFacts` rejects a missing phase, unknown id, duplicate, malformed fact, and zero or duplicated multiplicity; the eleven-id catalog is asserted exact and closed |
| FULL-03 | Hard-crash convergence, exactly one logical result per boundary | `self-test-full-crash-matrix.test.mjs` — 22 before/after production crashes converge after hard exit 86 and resume exit 0; `self-test-durable-crash-runner.test.mjs` — 26 crash-runner cases; `self-test-t71-rules.test.mjs` — resume, crash-exit, convergence, and matrix-root-isolation rules |
| FULL-04 | Portable evidence carries no provider-local, secret, or machine-local value | `self-test-full-scenario.test.mjs` — "portable full-scenario evidence excludes provider-local state"; `assertReportPayload`/`assertNoProhibitedContent` reject prohibited content classes and unknown fields |
| DRV-01 | Review surface binds destination, cost, capabilities, Tools, egress, and the rest | `self-test-t71-rules.test.mjs` — "every displayed review field is bound exactly" and "every actually used review field is bound exactly" mutate all ten fields; `self-test-driver-scenario.test.mjs` — "each displayed review exactly binds destination, cost, capabilities, Tools, and egress" |
| DRV-02 | Denied authority fails closed before any provider boundary, count stays zero | `self-test-t71-rules.test.mjs` — "a denied invocation that reaches a provider fails closed" (`VES_SELFTEST_PROVIDER_CALL_REACHED`); `self-test-driver-authority.test.mjs` — "unknown authority fields are rejected before provider entry"; `self-test-driver-scenario.test.mjs` — "the scenario includes a denied path with zero provider calls" |
| DRV-03 | Approved deterministic Claude, Codex, and OpenCode/Qwen boundaries, no network | `self-test-driver-scenario.test.mjs` — "the approved Driver scenario exercises all three qualified boundaries" and "the Driver scenario reports the closed check catalog"; `assertDriverCardinality` requires three distinct approved providers plus one denial under the offline guard |
| DRV-04 | No writer Tool is reachable | `self-test-t71-rules.test.mjs` — "a writer Tool in the review fails closed", "a reachable writer Tool fails closed even if the review is read-only", "writer reachability must be an explicit false fact"; `self-test-driver-authority.test.mjs` — "a writer-shaped Tool is denied before the provider boundary" |
| CLI-01 | `vestra self-test --profile full` and `--profile drivers` run and keep stable exit/report contracts | `self-test-cli-e2e.test.mjs` — "self-test --profile drivers reaches every approved boundary" and "self-test --profile full includes hard-crash recovery"; the real binary returns PASS with exactly ten full and seven Driver checks |
| TST-01 | Adequate evidence, gates pass, independent verification remains required | 137 new system, fault-injection, and security cases pass with 0 skipped and 0 todo; `gate:quick`, `gate:full`, and `gate:security` pass; this report is written by a verifier who is not the implementation author |

## Discrimination sensor

Five mutations, applied in place by a verifier who did not author the implementation, each disabling one property's real enforcement in `packages/application/src/self-test/self-test.ts` by neutralizing its guard condition. Each mutation was confirmed applied (a single literal occurrence replaced) before running `tests/unit/self-test-t71-rules.test.mjs`, and reverted with `git checkout` after; the file was verified unmodified after the campaign.

| #  | Requirement | Mutation | Result |
| -- | ----------- | -------- | ------ |
| M1 | FULL-02/03 | exact-once multiplicity guard (`logicalResultCount !== 1`) disabled | KILLED (2 failing) |
| M2 | FULL-03 | hard-crash exit guard (`crashExitCode !== DURABLE_CRASH_EXIT_CODE`) disabled | KILLED (1) |
| M3 | DRV-02 | denied-authority zero-call guard (`providerBoundaryEntries !== 0`) disabled | KILLED (1) |
| M4 | DRV-04 | writer-Tool reachability guard (`writerToolReachable !== false`) disabled | KILLED (2) |
| M5 | FULL-01 | effect-idempotency guard (`effectApplyCalls !== 1`) disabled | KILLED (2) |

The unmutated suite is 34 of 34 passing. Five of five mutations are killed with none surviving.

## Non-shallow checks

- The `full` profile composes the real production package builder and store, Approval Service with signed artifacts, context resolver and compiler, capability router, idempotent Effect Broker, Independent Verification Coordinator, Portable Handoff Coordinator, and Run Capsule builder and store against a disposable root — not stubs. Crash recovery hard-exits a real child process (code 86) at each durable boundary and resumes a clean process against the same on-disk state.
- Crash multiplicity, identity, digest, and status are read from the authoritative durable store after resume, not from a self-authored journal; a boundary journal records observations but never decides the verdict. Each of the 22 matrix cells receives a distinct normalized disposable root, and root reuse or collision with the happy path fails closed.
- Driver denial occurs before adapter construction or resolution and proves an exact zero provider-boundary count; the approved path binds the approved, displayed, and actually used review byte-for-byte, so a substituted destination, cost, capability, Tool, classification, purpose, retention, or egress value invalidates authority.
- The report surface did not grow: T69's seven-field `self_test.*` allowlist and the sealed support-bundle contract are untouched, and no JSON schema was added ahead of T72. The `full` and `drivers` profiles reuse the four sealed profile ids; crash recovery is a mode inside `full`, never a fifth id (AD-010).
- Every scenario stays offline under the existing guard and leaves guarded roots byte-identical.

## Verdict

T71 is complete. Ten of ten acceptance criteria have file-and-assertion evidence, 137 new cases pass across the unit, integration, fault-injection, and security scopes against a declared minimum of 30, all three declared gates pass on the bound revision with independent Linux corroboration at the pure T71 tip, and five of five behavior mutations are killed with none surviving.

What this does not claim: `doctor --deep` and the signed diagnostic report schema do not exist yet (T72), the public regression and holdout campaigns are unbuilt (T73–T74), and there is no platform matrix, release candidate, installer, or 1.0 decision. The public CLI now exposes `init` and all four Self-Test profiles. Independent verification is recorded at the pull request this report names; the implementation author and this report's author are different.
