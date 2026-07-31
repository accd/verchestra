# Milestone 2 sync audit — tracker vs. repository

Audit of [milestone 2, "1.0.0 — Verified release"](https://github.com/accd/verchestra/milestone/2)
against the state of `upstream/main`, the open pull requests, and the `main`
branch ruleset.

- Audited on: 2026-07-31
- Audit base: `upstream/main` at `07ead18`
- Working branch during the audit: `fix/lighthouse-performance-budget` at `2238ef3`
- Tracker snapshot: 21 issues — GitHub reported 3 closed / 18 open

This file records only the tracker-vs-repository comparison. Issue bodies,
acceptance criteria, feature specifications, and per-change evidence are not
duplicated here; they are referenced by issue number or repository path.

## Status matrix

| # | Issue | GitHub | Repository reality | Verdict |
|---|---|---|---|---|
| 19 | Website: launch portal | CLOSED | `apps/site/` built, deployed, gated by Site quality | In sync |
| 119 | Manual validation attests closed profile | CLOSED | `.github/workflows/full-validation.yml` carries the closed `gate` enum with fail-closed validation (PR #120); driver probes added (PR #133) | In sync |
| 51 | T68a: key lifecycle | CLOSED | Implementation merged; `docs/qualification/t68a-key-lifecycle.md` exists but the counter cannot see it; `.specs/features/key-lifecycle/handoff.md` is still `status: verification` with human acceptance as the next action | Closed early |
| 114 | Evidence revisions reachable from main | OPEN | Complete. `scripts/agent-readiness.mjs:171-243` enforces `merge-base --is-ancestor`; all four acceptance bullets covered by `tests/agent-readiness/context.test.mjs:219-276`; T68a evidence correction merged in PR #118 | Should be closed |
| 110 | Lighthouse performance budget | OPEN | Complete on `fix/lighthouse-performance-budget`. `apps/site/lighthouserc.cjs` uses `numberOfRuns: 3` with `aggregationMethod: "median"`, 0.95 preserved; CI score-reporting step added to `.github/workflows/ci.yml`; Verifier PASS in `.specs/features/lighthouse-performance-budget/validation.md`. PR #139 is green but unmergeable | Done, merge-blocked |
| 52 | T68b: budget enforcement | OPEN | Implementation merged (`packages/application/src/execution/budget-meter.ts` plus four test files, PRs #121 and #127). Only `docs/qualification/t68b-validation.md` is missing | Implementation done, report blocked |
| 53 | T68c: gate repair loop | OPEN | Implementation merged (`packages/application/src/execution/gate-repair.ts`, `tests/integration/gate-repair-loop.test.mjs`, PR #122). Same missing report | Implementation done, report blocked |
| 54 | T68d: policy hardening | OPEN | Implementation merged (`packages/policy/src/policy-bundle.ts`, `tests/unit/execution-package-repair-policy.test.mjs`, PR #123). Same missing report | Implementation done, report blocked |
| 132 | T68a report invisible to the counter | OPEN | Reproduced live: `corepack pnpm agent:context` reports `T68 complete; T68a next`. Two competing pull requests carry the fix (#136, #137) | Root blocker, fix unmerged |
| 126 | Branch protection unexecutable | OPEN | Confirmed. The `Protect main` ruleset sets `require_code_owner_review`, `required_approving_review_count: 1`, and `require_last_push_approval`; `.github/CODEOWNERS` names one owner for `*` | Open, real |
| 131 | CodeQL never reports on fork pull requests | OPEN | Confirmed empirically — see below | Open, real |
| 58 | Canonical JSON contract | OPEN | Partial. T1–T2 delivered the inventory and `docs/canonical-json-compatibility.md`; no production bytes changed. 49 files still sort with `localeCompare`, including the call sites the issue names | Correctly open |
| 10–18 | T69 → T77 | OPEN (9) | No implementation traces in `main` — no self-test, doctor, holdout, or campaign code | Correctly open |

**Drift: 5 of 21 issues disagree with the repository** — #51, #114, #110, and the
#52/#53/#54 cluster.

## Findings behind the matrix

### 1. #132 mechanically blocks #52, #53, and #54

The milestone attributes the three open T68b–T68d issues to missing qualification
reports. Those reports cannot be written while #132 is open.

`resolveQualification` in `scripts/agent-readiness.mjs:104` walks the chain and
then rejects any report found past the first gap:

```js
const outOfOrder = chain.slice(index + 1).filter((task) => validatedTasks.has(task));
// → "validation reports exist after the first gap: T68b"
```

`t68a-key-lifecycle.md` does not match the discovery pattern
`/^t(\d+[a-z]?)-validation\.md$/`, so T68a *is* the gap. Adding
`t68b-validation.md` today fails the qualification gate rather than advancing it.
#52, #53, and #54 are therefore one blocked item behind #132, not three
independent pieces of pending work.

### 2. #131 confirmed, and broader than the issue states

`CodeQL` is a required status check on `main`, but there is no `codeql.yml` under
`.github/workflows/` — it is GitHub default setup, which does not run on fork
pull requests. Observed on the live pull requests:

| PR | From a fork? | CodeQL check |
|---|---|---|
| #137 | no | SUCCESS |
| #139, #138, #136, #135 | yes | absent entirely |

An absent required check never resolves, so every fork pull request stays
`BLOCKED` regardless of how green it is. PR #139 (the #110 fix, with Quality gate
and Site quality both SUCCESS) is in exactly that state.

### 3. The deadlock is circular; #126 is the root

The owner-branch path does not escape either. PR #137 sits on an owner-owned
branch and does receive CodeQL, yet is still `BLOCKED` on `REVIEW_REQUIRED`
because `CODEOWNERS` names a single owner and GitHub does not permit
self-approval.

    #132 blocks the chain → #132's fix needs a merge → merging needs #126
    → #126 is itself a change that needs a merge

Nothing in the milestone advances until a human changes the ruleset or
`CODEOWNERS` outside the pull-request path. #126 is the blocking parent of the
whole milestone rather than one item within it.

### 4. Duplicate work on #132

Two open pull requests solve the same issue, both renaming the report to
`t68a-validation.md` and both touching `scripts/agent-readiness.mjs`, `llms.txt`,
and the site status surfaces:

- **PR #137** — owner branch `fix/qualification-counter-sees-t68a`; all checks
  green including CodeQL. The mergeable one.
- **PR #136** — fork branch; no checks reported at all. Also touches
  `docs/AGENTS.md`, `apps/site/AGENTS.md`, and `tests/agent-eval/corpus.json`.
  Cannot satisfy CodeQL while #131 stands.

One should be closed after porting its unique content into the other.

### 5. The milestone description contradicts its own bookkeeping

The description states both "#114 — the validator hardening merged in #117" and
"#119 — merged in #120". One was closed and the other was not. #114's four
acceptance bullets all have test evidence in `main`; its only unmet clause is the
trailing "obtain independent human acceptance before closing #51" — and #51 was
closed regardless on 2026-07-30. #114 is held open by a condition its dependent
issue already bypassed.

### 6. Artifact gap on the current working branch

`.specs/features/lighthouse-performance-budget/` contains `spec.md`, `tasks.md`,
and `validation.md` but no `handoff.md`. The root `AGENTS.md` requires a handoff
for non-trivial work, and `agent:context` builds its active-feature list from
handoffs — so the Lighthouse feature does not appear there despite being the
current branch.

## Recommended sequence

1. **#126** — human changes the ruleset (self-approval exemption, or a second
   code owner). Nothing else moves first.
2. **#131** — add an explicit advanced-setup `codeql.yml` triggered on
   `pull_request` so fork pull requests produce the check, or remove `CodeQL`
   from the required contexts.
3. **#132** — merge PR #137; close PR #136 after porting anything unique.
4. **#52 / #53 / #54** — write the three qualification reports once the chain
   accepts them.
5. **#114** — close it; the work is in `main` with tests.
6. **#110** — merge PR #139 and add the missing `handoff.md`.
7. **#51** — human decision on whether the early closure stands.
8. **#58** — needs the owner decision its handoff is blocked on
   (`canonicalize@3.0.0` versus an internal RFC 8785 encoder) before T3 starts.

Steps 1 and 2 are governance and CI-configuration changes that require the
repository owner. Steps 3 onward are ordinary repository work that is currently
unmergeable.

## Suggested skills for the next session

- **`tlc-spec-driven`** — for steps 4 and 6. Writing the T68b/T68c/T68d
  qualification reports and the missing Lighthouse `handoff.md` is exactly the
  spec/tasks/handoff/validation artifact work this skill governs, and the
  repository's own `.specs/AGENTS.md` contract matches its output shape.
- **`code-review`** — before merging PR #137, and to compare it against PR #136
  on the duplicate-work question in finding 4.
- **`codenavi`** — if the next session takes on #58. The canonical JSON migration
  spans 49 files across `packages/`, and its handoff is blocked on an
  architectural decision rather than a mechanical edit.
- **`grilling`** — optional, for pressure-testing the #126 and #131 remediation
  choices before touching branch protection or required status checks. Both are
  hard to reverse and affect every future pull request.

Do not reach for `security-review` or `run` for this work; none of the open steps
change runtime behaviour of the CLI.

## Verification notes

Every row in the matrix was checked against a command, not against the milestone
description. Reproduce with:

```bash
corepack pnpm agent:context
```

```bash
gh issue list --repo accd/verchestra --milestone "1.0.0 — Verified release" --state all --limit 200
```

```bash
gh api repos/accd/verchestra/rulesets/19738785 --jq '.rules[] | select(.type=="pull_request" or .type=="required_status_checks")'
```

The `agent:context` run reported `qualification: T68 complete; T68a next` on a
clean worktree, which is the direct reproduction of #132.
