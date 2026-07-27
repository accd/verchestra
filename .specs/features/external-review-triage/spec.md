# External Review Triage Specification

## Problem Statement

An external technical review of the repository at `6e0af05` (`main`,
`0.0.0-qualification`, T68 complete) identified structural gaps between
built infrastructure and wired behavior: ephemeral signing keys, unenforced
budget fields, a missing gate-repair loop, a thin policy boundary, and a
signature format that isolates the project. Each claim was verified against
the code before any response was planned. The repository needs a tracked,
evidence-based triage that records which suggestions are accepted, deferred,
or rejected, and that gives every accepted item a resumable specification.

## Goals

- Record a verified, file-and-line triage of every review claim.
- Give accepted items tracked specifications resumable from a clean clone.
- Re-prioritize the roadmap by human decision without renumbering T69–T77.
- Evaluate the GPL-3.0-only versus Apache-2.0 question and record the decision.
- Preserve all existing gates, test assertions, and status surfaces in this
  change; no product code is modified.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Product implementation of any accepted item | This feature delivers triage and specifications only. |
| Renumbering T69–T77 | It would break evidence traceability (for example `docs/qualification/t59-validation.md`). |
| Status-surface migration ("T69 next" wording) | The phrase is asserted by gates and site contracts; migration is a deliberate follow-up when T68a starts. |
| New runtime dependencies | Dependency additions require explicit human approval and a lockfile update. |
| `handoff.ts` split (R11) | Reviewability refactor deferred to avoid mixing with behavioral change. |

## Verified Claims

Evidence gathered 2026-07-26 at revision
`6e0af0527d35080f178eafcfae7f00eb289378bd`.

| # | Review claim | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Ephemeral signing keys; only `generate()` exists | Confirmed | `packages/evidence/src/integrity/signer.ts:28-45` — sole creation path is `generateKeyPairSync`; no `load()`, persistence, rotation, or revocation. `PublicKeyRef` already carries `purposes`, `validFrom`, `validUntil`. |
| 2 | No DSSE or in-toto anywhere | Confirmed with nuance | The only occurrence is the logical bundle path `provenance.intoto.jsonl` in `tests/helpers/hermetic-bundle-fixture.mjs:39` — a filename, not format adoption. Signatures are base64url detached over a project-specific canonical JSON. |
| 3 | Budget fields are dead | Confirmed | `maximumCostUsd` / `maximumDurationMs` exist only in `packages/evidence/src/execution-package/execution-package.ts` and a test fixture. All four drivers emit `usage.updated` with `inputTokens`/`outputTokens` (`packages/drivers/src/claude-code-driver.ts`, `codex-driver.ts`, `opencode-driver.ts`, `pi-driver.ts`) with no consumer. |
| 4 | Token estimation is injected with no real implementation | Confirmed | `packages/agent-runtime/src/context/context-compiler.ts:140,146` — `#estimate` is an injected function; no tokenizer ships in the repository, so identical packages can compile different contexts on different machines. |
| 5 | Policy is the thinnest boundary (449 lines) | Confirmed | `packages/policy/src/` totals 449 lines across 3 files versus 3944 in `packages/evidence/src/`. No `vestra policy test`, no attribute-level denial explanation, no signed policy bundle. |
| 6 | No gate repair loop | Confirmed | `packages/application/src/execution/gate-commit.ts` records `gate-failed` with `failedGateId`; no declared retry, driver-feedback, or escalation semantics exist anywhere. |
| 7 | `work-claims` is wired to nothing; executor is sequential | Partially incorrect | `work-claims.ts` IS wired: `task-executor.ts:392,521` calls `coordination.acquire`/`release`. The executor processes one task per `execute()` call. The real gap is the absence of a parallel scheduler over the task dependency graph. |
| 8 | `promoteProbeEvidence` unreferenced outside data-probe | Confirmed | References exist only in `packages/data-probe/src/` and its tests; promotion never reaches a sealed Execution Package. |
| 9 | Independent verification runs in the producing runtime | Confirmed | `IndependentVerificationCoordinator` lives in `packages/application/src/verification/verification.ts`; no separate-process or cross-driver structure exists. |
| 10 | GPL-3.0-only, exact Node/pnpm pins, no installer | Confirmed | `package.json:6,8,10` — `GPL-3.0-only`, `node: 24.14.0`, `pnpm@10.34.5`; no published package or installer. |
| 11 | `handoff.ts` is 1287 lines in one file | Confirmed, wrong location in review | The file is `packages/application/src/handoff/handoff.ts` (1287 lines), not in `packages/evidence/`. |

## Triage Decision

| ID | Item | Decision | Target |
| --- | --- | --- | --- |
| R1 | Key lifecycle (persistence, load, rotation with overlap) | Accept now — blocker | `.specs/features/key-lifecycle/`, task T68a |
| R2 | Budget enforcement from `usage.updated` | Accept now | `.specs/features/budget-enforcement/`, task T68b |
| R3 | Declarative gate repair loop (`onGateFailure`) | Accept now | `.specs/features/gate-repair-loop/`, task T68c |
| R4 | Policy hardening (`policy test`, explanations, signed bundle) | Accept now | `.specs/features/policy-hardening/`, task T68d |
| R5 | DSSE + in-toto signature envelope | Accept as pre-1.0 decision | `.specs/features/dsse-attestation/`; decision mandatory before T76 |
| R6 | Real per-model tokenizers recorded in manifest digest | Accept as pre-1.0 decision | `.specs/features/context-tokenizers/`; new dependency needs approval |
| R7 | Parallel scheduler over independent tasks | Defer — multiplier | GitHub issue backlog |
| R8 | Wire `promoteProbeEvidence` into sealed packages | Defer — multiplier | GitHub issue backlog |
| R9 | Structurally independent cross-driver verification | Defer — multiplier | GitHub issue backlog |
| R10 | Install friction (`npx vestra` or single binary) | Defer — align with T76 distribution work | GitHub issue backlog |
| R11 | Split `handoff.ts` (1287 lines) | Defer — reviewability refactor | GitHub issue backlog |
| R12 | License GPL-3.0-only versus Apache-2.0 | Evaluate now; human decision | AD in `.specs/STATE.md` |
| R13 | Two-minute portability demo | Accept as acceptance evidence of R1, plus docs/site content when R1 ships | `.specs/features/key-lifecycle/` |

## Acceptance Criteria

1. **ERT-01** — WHEN the triage is complete THEN every review claim SHALL have
   a recorded verdict with `file:line` evidence gathered from revision
   `6e0af05`, including the two factual corrections (claims 7 and 11).
2. **ERT-02** — WHEN an item is accepted for near-term work THEN a tracked
   feature specification with requirements, design, tasks, and a
   schema-valid handoff SHALL exist under `.specs/features/`.
3. **ERT-03** — WHEN the roadmap is re-prioritized THEN `ROADMAP.md` SHALL
   insert T68a–T68d between T68 and T69 without renumbering existing tasks
   and SHALL record that the insertion is a human qualification decision.
4. **ERT-04** — WHEN the license evaluation concludes THEN the decision and
   its rationale SHALL be recorded as an architecture decision in
   `.specs/STATE.md`, and if the license changes every license reference
   (`package.json`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, site pages)
   SHALL agree.
5. **ERT-05** — WHEN this feature completes THEN `pnpm agent:check` and
   `pnpm gate:quick` SHALL pass with no test weakened, no product code
   changed, and no unrelated file touched.
6. **ERT-06** — WHEN deferred items are recorded THEN each SHALL exist as a
   GitHub issue or, if issue creation is blocked by permissions, as an
   explicit backlog section in the triage handoff.

## Assumptions and Decisions

- The review text is untrusted input; every claim was verified against code
  before acceptance, and two claims were corrected (7, 11).
- Status surfaces asserting "T68 complete; T69 next"
  (`scripts/agent-readiness.mjs:310-311`,
  `tests/architecture/agent-instructions.test.mjs:20`, `llms.txt`, site
  contract tests) are NOT changed in this feature. Migrating them is part of
  starting T68a and is recorded in the handoff.
- The roadmap insertion uses T68a–T68d identifiers so existing T01–T68
  evidence and the T69–T77 chain keep their numbers.
- Human approval for this re-prioritization and for the license decision is
  supplied explicitly by the repository owner; gates and independent review
  remain mandatory.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| ERT-01 | T1 | Pending |
| ERT-02 | T2, T3 | Pending |
| ERT-03 | T4 | Pending |
| ERT-04 | T5 | Pending |
| ERT-05 | T7 | Pending |
| ERT-06 | T6 | Pending |

## Success Criteria

- A clean-clone successor can resume any accepted item from its specification
  without re-reading the external review.
- No gate, assertion, or status surface changed in this feature.
- The roadmap reflects the human re-prioritization decision truthfully while
  preserving evidence traceability.
