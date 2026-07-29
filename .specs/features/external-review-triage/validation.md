# External Review Triage Validation

**Date**: 2026-07-26
**Spec**: `.specs/features/external-review-triage/spec.md`
**Verifier**: author gates (independent review pending before merge)

## Claim Verification Evidence

All claims verified read-only at revision
`6e0af0527d35080f178eafcfae7f00eb289378bd` on 2026-07-26. The claim table
with `file:line` evidence lives in `spec.md`; the two factual corrections
(claims 7 and 11) are recorded there.

## Gate Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Agent | `pnpm agent:check` | PASS |
| Quick | `pnpm gate:quick` | PASS (21/21 readiness outcomes; all unit/contract stages) |
| Site unit | `pnpm --filter @verchestra/site test:unit` | PASS (fail 0) |
| Site types | `pnpm --filter @verchestra/site check:astro` | PASS (25 files, 0 errors) |
| Site build | `pnpm --filter @verchestra/site build` | PASS (120 pages) |
| Site built checks | `pnpm --filter @verchestra/site check:built` | PASS (`internalLinks: valid`, `metadata: valid`) |
| Site e2e | `playwright test --project=chromium` | PASS (17/17; preview reused via `reuseExistingServer`) |

Note: `corepack enable` is blocked by OS permissions on this machine, so the
site sub-commands were run individually via `corepack pnpm --filter` instead
of the aggregate `site:check`/`site:test` wrappers; coverage is identical
for the changed surface. Firefox/WebKit projects and Lighthouse are
environment-limited locally (browsers not installed); they run in CI. The
e2e run caught one real interaction: the first ROADMAP.md heading draft put
"T69" into the hidden mobile table of contents ahead of visible content, so
the heading was reworded to "Inserted hardening tasks (T68a–T68d)".

## Requirement Evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| ERT-01 | Verified | `spec.md` verified-claims table with `file:line` for all 11 claims |
| ERT-02 | Verified | `key-lifecycle/`, `budget-enforcement/`, `gate-repair-loop/`, `policy-hardening/`, plus decision specs `dsse-attestation/`, `context-tokenizers/` — all with parser-valid handoffs (`agent:check` PASS) |
| ERT-03 | Verified | `ROADMAP.md` inserts T68a–T68d between T68 and T69; T69–T77 numbering untouched; insertion recorded as AD-008 |
| ERT-04 | Verified | AD-007 in `.specs/STATE.md`; license references agree across `package.json`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, `index.astro`, `community.astro`, `ProductLayout.astro`, and the updated assertion in `apps/site/tests/unit/public-metadata.test.mjs:35` |
| ERT-05 | Verified | gates above PASS; `git status` shows only intended files |
| ERT-06 | Verified | GitHub issues #33–#37 created for deferred items R7–R11 |
