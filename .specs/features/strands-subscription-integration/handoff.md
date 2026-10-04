---
schema: verchestra-feature-handoff/v1
feature: strands-subscription-integration
issue: null
status: verification
branch: strands/t10-handoff
baseRevision: 8a1ab11d2584fa4f5c37fc0a86edd45366beff79
lastCompletedTask: T10
nextTask: "Owner: (1) run the agent, graph, and swarm pilots with real subscriptions on Windows, macOS, and Linux exactly as docs/qualification/coordinated-run-pilots.md describes, from a source checkout of main at or after this handoff, recording every run there as passed, suspended, failed, or not configured, never inferred; (2) at human review, confirm or overturn the approvals made by delegation (D1 and D1b, the lockfile set; D10, AD-080 item 5; D2-D7 and D9) and the requirements amended on 2026-10-04 (SSI-42, SSI-52, SSI-55, SSI-56, SSI-60, SSI-61, SSI-83, TM-004), and decide D11; (3) review setup-draft.md (D8) and edit, accept, or decline it. Then tick the pilot item of T9 in tasks.md, set the SSI-84 row, and move this handoff to complete."
lastGate: "Platform matrix at f58afa1 (tree equal to d2c9341, the delta-verified code): gate:full 37206571680, gate:build 37206573582, gate:security 37206575734, all five legs green, every stage 0 failed, 0 cancelled, 0 skipped, 0 todo. This branch (specs only), Node 24.14.0 darwin arm64: agent:check PASS; site:check PASS (135 pages, internal links and metadata valid); gate:quick PASS (unit 2987, agent-readiness 357, census 13; 0 failed, 0 skipped, 0 todo); no provider called"
updatedAt: 2026-10-04T14:40:00Z
---

# Scope

The owner's approved plan ("Integrate Strands into Verchestra with the current
subscriptions"): an optional coordination module on `@strands-agents/sdk`
1.19.0 that runs one governed task as a single agent, a Graph, or a Swarm of
Claude Code and Codex sessions, on subscriptions only, with suspension and
manual resume on quota exhaustion, and a Windows bridge transport.
Requirements SSI-01..85 in `spec.md`; tasks T1–T10 in `tasks.md`. The product
stays `0.0.0-qualification`; nothing here is a release or a promotion, and no
published release includes coordinated runs yet.

# Completed Evidence

Every task is on `main` except what waits for the owner (below). Pull requests,
in merge order:

| PR | Task | What landed |
| --- | --- | --- |
| #512 | T1, T2 | Specification, design, threat model, research, setup draft, decisions |
| #516 | T4 | Structured results, account checks, quota signals, Codex method allowlist |
| #519 | T3 | Task Request v2 schema, normalizer, coordination plan, plan-time binding |
| #521 | T7 commits 1–3 | Bridge transport seam, Windows named-pipe transport, Windows policy sources |
| #522 | T5 | Coordinated driver, native and Strands engines, node ledger, SDK pins (D1), metafile self-containment (D2), composition |
| #524 | T6 | Subscription preflight, extra-usage statement, suspension, resume, reconciliation |
| #525 | T8 | Plan and status of coordinated runs, one example per mode, documentation |
| #526 | T7 commit 4 | The governed task path on Windows (AD-080) |
| #527 | T9 | First independent verification (FAIL) and the pilot record |
| #528 | T9 R3 | Coordinated journeys on Linux and Windows, documentation, standards |
| #529 | T9 R2 | Node results mapped and screened, Codex read-scope copy (AD-081), providers |
| #530 | T9 R1 | v2 verifier billing, plan type, approved-package proof, Windows policy order, grant renewal (AD-082) |
| #531 | T9 | Second independent verification (FAIL) |
| #532 | T9 R4 | v1 verifier as before, Codex login secrets withheld, bounded pipe cases and helper end, AD-081 residual |
| #533 | T9 | Delta verification of R4 (PASS, no FAIL row) |
| this branch | T10 | Spec amendments, delegated approvals D1b and D10, status lines, this handoff |

Verification history (`validation.md`), each verifier a session that wrote
none of what it verified: the first pass at `c3223c6` failed (6 FAIL, 10
PARTIAL); remediations R3, R2, and R1 fixed its findings; the second pass at
`93b38c5` failed (SSI-49 and SSI-83 FAIL, and a hung Windows security leg);
remediation R4 fixed those; the delta verification at `d2c9341` has no FAIL
row: 81 PASS, SSI-60, SSI-61, and SSI-83 PARTIAL only until T10's amendments,
SSI-84 PENDING. T10 applied those amendments, so the traceability table in
`spec.md` reads 84 PASS and SSI-84 PENDING; SSI-83 rests on D10, an approval
by delegation. Both full passes killed the planned discrimination list in
full, and every survivor of a pass was killed by the next, except the delta
verification's D6 (a test gap, below).

Remediation R5 (#534) landed: it withholds the Codex login's `account_id`
and the ID token's identifiers from node results and adds the test that kills
D6, the delta verification's two minor findings (8 of 8 mutants killed; full
and security matrices green on all five targets). Its author is not a
verifier; an independent check of R5 is part of the next verification pass,
and no row of this handoff depends on it.

# Accepted Residual Risks

- AD-081 and TM-004: a Codex node starts in a read-only copy of its read
  scope, but Codex's read-only sandbox permits any read outside it, by an
  absolute path, a relative path through `..`, or a path built from `HOME` or
  `CODEX_HOME`, the run's worktree and the Codex login's `auth.json` included.
  What it can carry into the Run record is limited by the result screen.
- The screen matches exact values: a secret a model encodes, splits, or
  transforms passes (R4). Since R5 the login's `account_id` and the ID
  token's identifier claims are withheld; a `name` claim is not.
- The server-side extra-usage setting cannot be read locally; the owner's
  statement stands for it (TM-002). A v1 verifier on a subscription can still
  spend Codex credits at verification (D11, pending).
- A Codex node's copy is not removed when the command is interrupted; a resume
  clears it, a cancel does not (AD-081, second pass finding 7).
- The Windows `gate:security` leg failed intermittently on unchanged code
  before R4; a recurrence now fails a named case within its bound, and one
  green run since does not by itself show the cause gone.
- The Codex structured-protocol evidence at the 0.159.3 floor is local only;
  the fleet pins Codex 0.115.0 until the owner moves the pin (R3).

# Next Exact Action

The `nextTask` above, all of it the owner's:

1. Pilots (SSI-84): follow `docs/qualification/coordinated-run-pilots.md`
   ("What the owner does, per platform") on each platform, from a source
   checkout of `main` at or after this handoff, not at the earlier revision the
   record's stand-in table is bound to. Never exhaust an allowance. A
   platform or account the owner cannot run is recorded `not configured`.
2. Human review: confirm or overturn each approval by delegation in
   `spec.md` ("Assumptions & Open Questions"), each row marked "amended
   2026-10-04" in `spec.md`, `design.md`, and `threat-model.md`, and decide
   D11.
3. D8: review `setup-draft.md`; write its configuration only if accepted, in a
   separate commit.

# Blockers

None for an implementer. Every open item needs the owner: the pilots need
the owner's subscriptions on each platform, and the delegated approvals and
D8 need the owner's own decision.

# Decisions

Recorded in `.specs/STATE.md` as AD-068 to AD-076 and AD-078 to AD-082, all
proposed and ratified by the human review of this feature. Owner decisions are
in `spec.md`: D1–D7 and D9 accepted by delegation on 2026-10-03, D1b and D10 on
2026-10-04, none of them seen by the owner; D8 and D11 pending the owner.

# Files Intentionally Left Unchanged

The verifiers' and remediators' sections of `validation.md` (T10 appends only
a short note at its end). `docs/qualification/` reports, which are immutable
evidence for their recorded revision (`docs/AGENTS.md`): the "Candidate
pending independent verification" status lines of
`claude-code-driver-structured-results.md` and
`codex-driver-structured-results.md` describe T4's revision, and the
verification is recorded in `validation.md`; `coordinated-run-pilots.md` waits
for the owner's runs. `README.md` and `docs/quick-start.md`, whose status
claims are current. Product code, tests, schemas, and the lockfile. The
`setup-draft.md` configuration (D8). `.specs/features/architecture-deepening/`.
