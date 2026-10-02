---
schema: verchestra-feature-handoff/v1
feature: live-task-pilot
issue: 406
status: blocked
branch: docs/406-pilot-preregistration
baseRevision: c57c15f1a952573ef98f0d2eba8f557ac136fc1d
lastCompletedTask: T0
nextTask: "T1: the owner resolves every item under Blockers; only then T2 (prepare the clean machine) and the runs, in the order fixed in spec.md section 6."
lastGate: "Node 24.14.0 macOS arm64: agent:check PASS; gate:quick PASS (2330 + 305 + 13 tests, 0 failed, 0 skipped, 0 todo); no provider called, no cost incurred"
updatedAt: 2026-10-02T00:00:00Z
---

# Scope

Pre-registration for the supervised live pilot of the installed `vestra task`
path (#406). This change fixes, before any execution, the target repository
and revision, the candidate, the configuration identity, three tasks with exact
Task Request v1 files and acceptance probes, three scenarios plus a free
plan-time refusal, the limits and stop rules, the success definition, the
recording template, the clean-machine steps, the boundaries, and the review
checklist. Nothing was executed against a provider.

# Completed Evidence

T0: `spec.md` (PLT-01..PLT-10), `tasks.md`, this handoff, `validation.md` with
the empty results table, `requests/` (P1–P3, S1–S3, S3b),
`probes/` (P1–P3), and `task-gates.example.json`. Every request was validated
against `schemas/task-request/1.schema.json` and `normalizeTaskRequest`; the
target baseline and every probe and revert check were exercised in throwaway
clones of the pinned revision (see `validation.md`).

# Blockers

The owner must provide each of these before T2 starts:

1. **The candidate.** Publish `verchestra@0.0.0-qualification.4` to npm and
   state its source revision. At pre-registration it is not published (the
   registry lists `0.0.0-qualification` and `0.0.0-qualification.2`;
   `0.0.0-qualification.3` is being built from `c57c15f`). If the owner prefers
   another candidate, that is a change to `spec.md` §2 made before T2, in a
   reviewed change. Since the 2026-10-02 amendment the candidate must be built
   from a revision that carries the subscription path (ADP-A); a publication
   that predates it has only the API-key path and cannot run this pilot.
2. **Usage and time approval.** Approve, or replace, the proposed ceilings:
   3,000,000 tokens per task run (P1–P3), 1,000,000 for S1, 2,000,000 each for
   S2 and S3, the usage stop rule, the per-run duration ceilings, and the
   four-hour session limit (`spec.md` §6). Nothing is billed per token; the
   pilot draws on the owner's Claude and ChatGPT plans.
3. **Provider access.** A Claude subscription that can use `claude-sonnet-5`
   through Claude Code 2.1.282, and a ChatGPT plan that can use
   `gpt-5.2-codex` through Codex CLI 0.157.1. Model availability cannot be
   confirmed without a model call, so it was not checked. The owner mints the
   Claude Code token with `claude setup-token` and binds it as
   `claude-code-oauth-token`, binds a new `evidence-signing-passphrase`, and
   signs Codex in once into the pilot Workspace's identity directory
   (`docs/quick-start.md`, step 3; names only in any record). No API key is
   needed.
4. **The machine.** A macOS arm64 machine or fresh user account matching
   `spec.md` §3, where Node 24.14.0, Claude Code 2.1.282, and Codex CLI 0.157.1
   are the first `node`, `claude`, and `codex` on `PATH`.
5. **People.** The accountable human who accepts or rejects each task (GitHub
   handle recorded per run), and an independent reviewer who is not the
   operator and did not choose the tasks (`spec.md` §10).
6. **Sign-off on the pre-registration.** Approval of the target, the pinned
   revision, the tasks, their assertions, and the scenarios, given by reviewing
   and merging this change before the first run.
7. **The subscription profile's open decisions.** The owner accepts or rejects
   the gaps G1–G3 of the subscription profile (`.specs/STATE.md`, the
   subscription provider authentication decision; managed policy, the Keychain
   lookup, and startup requests) before T2. The pilot's first run is also the
   first live observation of that profile.

# Next Action

T1. When every blocker is resolved, record the resolution in `validation.md`
(Blocker resolution) in a reviewed change, set this handoff to `in_progress`,
and follow `spec.md` §8.

# Files Intentionally Left Unchanged

Everything outside `.specs/features/live-task-pilot/`. The quick-start keeps
its "Live pilot pending" limit until T9; no qualification report or status
surface changes, because the qualification state did not change.

# Known Risks Declared in Advance

- P3 verification depends on the verifier naming `lib/cli-input.js` as the file
  to revert (`spec.md` §4, P3).
- S1 has a timing window; one repeat is allowed (`spec.md` §5, S1).
- S3's denied-call count may not be visible through a public command; it would
  be recorded as `unavailable` (`spec.md` §5, S3).
- Claude Code reports usage at session end, so a run can overshoot its token
  ceiling before it is stopped (`spec.md` §6).
- The subscription profile has never run against Claude Code itself. If the
  live session advertises a tool or an MCP server the profile does not expect,
  or a hook runs, the first run fails closed with a `VES_CLAUDE_*` code and the
  pilot stops (`spec.md` §6).
