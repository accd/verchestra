# Verchestra product and repository audit — August 2026

Audited against `main` as of 2026-08-01. Every claim below names its evidence;
where something is unverified, the audit says so instead of implying it.

## Executive summary

Verchestra's strongest asset is that its central promise - evidence, not
assertions - is now enforced against the repository itself: the qualification
counter derives from reports on disk, every active status surface is tested
against that resolver, and the public site cannot silently omit or lag the
evidence it advertises. Its largest current risk is unchanged in kind:
single-maintainer review. Every control that requires an independent human is
honestly declared unenforceable rather than silently bypassed, but declaration
is not independence, and T77 cannot close without real second reviewers.

## Verified current state

- Qualification: `T68d complete; T69 next`, derived, with reports
  `t01`–`t68d` on disk (`corepack pnpm agent:context`).
- The T68 hardening insertion (T68a–T68d) is fully evidenced: reports bind to
  `main`-reachable revisions with externally dispatched gate runs
  ([quick/security at `46d22d8`](https://github.com/accd/verchestra/actions/runs/30670820650),
  [at `73144b0`](https://github.com/accd/verchestra/actions/runs/30672257071)).
- Merge governance and the live ruleset agree: one standing Repository admin
  bypass, scoped by `docs/merge-governance.md`, verifiable via
  `gh api repos/accd/verchestra/rulesets/19738785 --jq '.bypass_actors'`.
- Public surfaces (README, homepage, `llms.txt`, instructions) carry one typed
  capability matrix with defined maturities and a structural drift test
  (`apps/site/tests/unit/product-contract.test.mjs`).

## Findings

| Priority | Finding | Evidence | State |
| --- | --- | --- | --- |
| P0 | Required `CodeQL` check never reports on fork PRs, so outside contributions cannot merge | #131; #130 showed three checks where in-repo branches get six | Workflow ready in #140; **blocked on the owner disabling default setup** - with both active, uploads fail: "CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled" (run 30668340527) |
| P0 | Single-maintainer review: independence unobtainable by configuration | `.github/CODEOWNERS` one owner; one collaborator; no self-approval | Declared in `docs/merge-governance.md` (merged #141); bypass scoped and logged; **real independent reviewers remain required before T77** |
| P1 | Trust-relevant digests still use ~30 hand-rolled canonicalizers with ambient `localeCompare` | #58; inventory in `docs/canonical-json-compatibility.md`; T1-T2 done, T3 decision taken (`canonicalize@3.0.0` into `packages/domain`) | Open; recommended to land before T73 (campaign digests) and mandatory before T76 |
| P1 | "Independent verification" is same-runtime today | #35; `IndependentVerificationCoordinator` runs in-process | Open; public copy now avoids the structural-independence claim; smallest slice: separate process, read-only grant, no writer tools, recorded verifier identity, explicit `not configured` result |
| P1 | Language policy contradiction: `AGENTS.md` says English-only; `a7c62bc` merged a Spanish README | `README.es-ES.md` on main via #142 (owner merge) | **Owner decision de facto made; policy text not yet amended.** Recommended model: English canonical, scoped introductory translations that declare and link the canonical source, never consumed as agent/site context, no duplicated dynamic status |
| P2 | `test:release` passes vacuously - `tests/public-regression/` and `tests/system/` do not exist | `scripts/test-scope.mjs` exits 0 on missing roots | Known hole T73 fills; until then "gate:release passed" is weaker than it reads |
| P2 | Site quality flakiness sources bounded but not eliminated | #110 open; #139 merged the diagnosis spec; `numberOfRuns: 1` in `lighthouserc.cjs` | Diagnosis spec exists; fix outstanding, 0.95 threshold untouched |

## Issue hygiene (recommended, owner executes)

- **Close with evidence:** #114 (all four acceptance criteria implemented and
  tested at `scripts/agent-readiness.mjs:154+`, fixtures in
  `tests/agent-readiness/context.test.mjs`; the evidence-correction half merged
  via #117/#118).
- **Keep open:** #110 (fix outstanding), #58 (T3+ outstanding), #35, #36,
  #126 (close only if the bypass model is accepted as its resolution), #131
  (until the cutover completes and a fork PR shows a reporting `CodeQL` check).
- **Chain:** #10–#18 stay open as the roadmap; T69 is next.

## CodeQL cutover runbook (condensed)

1. Pre-capture: `gh api repos/accd/verchestra/code-scanning/default-setup`
   (currently `configured`, languages `actions, javascript-typescript` - the
   workflow in #140 matches exactly).
2. Owner: Settings → Code security → CodeQL analysis → **Advanced** (or disable
   default setup). Rollback = re-enable default setup; the workflow file can be
   reverted independently.
3. Re-run #140's workflow; expect `Analyze (actions)`, `Analyze
   (javascript-typescript)`, and aggregate `CodeQL` all green *from the
   workflow*, no duplicate default-setup checks.
4. Merge #140; confirm a `main` scan lands.
5. Verify on the next fork PR that `CodeQL` reports. Keep separate: analysis
   ran / SARIF uploaded / check reported / check passed / result visible in the
   security tab - #140's aggregate proves only the check semantics; fork SARIF
   upload remains unverified until observed (#130 is the natural observation).

## What this audit did not do

No issue was closed, no setting changed, no ruleset touched. The audit records;
the owner decides.
