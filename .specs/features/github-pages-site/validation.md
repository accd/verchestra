# GitHub Pages Website Validation

**Date**: 2026-07-25  
**Spec**: `.specs/features/github-pages-site/spec.md`  
**Diff range**: `4121c14..54d259a`
**Verified SHA**: `54d259a71c9f10d07efd819b779fd11c52f41b4b`
**Verifier**: `/root/site_verdict`, independent sub-agent (author != verifier)

---

## Verdict

**PASS** — the repository implementation satisfies WEB-01 through WEB-12 and is ready for the protected-main publication workflow.

The live GitHub Pages URL and required-check results remain operational post-merge acceptance checks; they cannot exist at this unmerged feature-branch SHA. The workflow makes deployment conditional on a push to `main` and on both quality jobs succeeding.

## Task Completion

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | PASS | `db39d2a` — Astro/Starlight foundation and root commands |
| T2 | PASS | `0d7e2cf` — canonical loader and qualification compiler |
| T3 | PASS | `4f57e55` — product experience |
| T4 | PASS | `aa861f7` — documentation portal |
| T5 | PASS | `e6d5a5b` — metadata and raster identity |
| T6 | PASS | `115abca` — browser, Axe, Lighthouse, and content qualification |
| T7 | PASS | `2f4109c` — verified Pages artifact workflow |
| T8 | PASS | `7e36096` — public handoff and clean-clone documentation |
| Portability fixes | PASS | `44c3218`, `7d0b635`, `54d259a` — line endings, bounded Windows Lighthouse cleanup retry, and platform-neutral content-watcher tests |

## Spec-Anchored Requirement Evidence

| Requirement | Spec-defined outcome | File-and-assertion evidence | Result |
| --- | --- | --- | --- |
| WEB-01 | Every route, asset, canonical URL, and internal link works below `/verchestra/`. | `apps/site/scripts/check-built-site.mjs:8,34-42,64,85,95` asserts the base, canonical URLs, and link containment; `apps/site/tests/e2e/site.spec.ts:33,75-96` asserts base-safe links, deep routes, and 404 recovery. | PASS |
| WEB-02 | First viewport shows the approved headline, definition, qualification version, T68/T69 state, and no installation claim. | `apps/site/tests/unit/product-contract.test.mjs:13-24` asserts the exact headline, definition, version, completed/next task, and `installable: false`; `apps/site/tests/e2e/site.spec.ts:23-32` asserts the rendered contract. | PASS |
| WEB-03 | Documentation is searchable and keyboard-accessible with visible focus. | `apps/site/tests/e2e/site.spec.ts:57-72` asserts skip-link focus, keyboard activation of search, and a searchable SAP ASE result; `apps/site/tests/unit/documentation-contract.test.mjs:54-61` asserts searchable metadata for every declared guide. | PASS |
| WEB-04 | Canonical root documents are projected, not manually copied. | `apps/site/tests/unit/documentation-contract.test.mjs:63-67` rejects canonical-document copies in site content; `apps/site/tests/unit/repository-content.test.mjs:46-55,58-72` asserts path containment, allowlisting, and canonical-link projection. | PASS |
| WEB-05 | Claude Code, Codex, OpenCode/Qwen and all databases are accurate, with SAP ASE/Sybase first. | `apps/site/tests/unit/product-contract.test.mjs:34-45` asserts the exact driver/database sets and ordering; `apps/site/tests/unit/documentation-contract.test.mjs:68-73` asserts SAP ASE precedes PostgreSQL in the matrix; `apps/site/tests/e2e/site.spec.ts:31-32` asserts the public rendering. | PASS |
| WEB-06 | The public surface explains request/discovery through evidence and human review, including portable handoff. | `apps/site/tests/unit/product-contract.test.mjs:27-32` asserts the complete exact delivery sequence; `apps/site/src/content/docs/docs/workflows/cross-environment-handoff.md:6-18` and `feature-delivery.md:6-15` describe the portable execution contract and review flow. | PASS |
| WEB-07 | Implemented evidence, current qualification, and future roadmap work are distinct and truthful. | `apps/site/tests/unit/repository-content.test.mjs:18-28` asserts version `0.0.0-qualification`, T68 complete, T69 next, and 68 reports; `apps/site/scripts/check-built-site.mjs:114-118` asserts those rendered claims and rejects install/production-ready claims. | PASS |
| WEB-08 | Templates meet responsive, keyboard, reduced-motion, touch-target, and WCAG expectations. | `apps/site/tests/e2e/site.spec.ts:15-19` asserts no serious/critical Axe violations for each template; `36-55`, `57-72`, `98-132` assert mobile navigation, theme persistence, keyboard use, reduced motion, Mermaid text equivalence, and 44×44 targets. | PASS |
| WEB-09 | Controlled Lighthouse reaches Performance >=95 and 100 for Accessibility, Best Practices, and SEO while meeting budgets. | Recorded qualification: Lighthouse `100/100/100/100`; `apps/site/lighthouserc.cjs` defines the controlled assertions; `apps/site/scripts/check-built-site.mjs:136-137` enforces compressed JavaScript below 75 KB and landing transfer below 500 KB. | PASS |
| WEB-10 | No analytics, tracking, forms, authentication, secrets, or runtime API calls enter the static site. | `apps/site/tests/e2e/site.spec.ts:135-143` asserts zero external font/analytics/runtime requests; `apps/site/scripts/check-built-site.mjs:68,94,117-118` rejects machine paths, private keys/tokens, install claims, and production-ready claims in output. | PASS |
| WEB-11 | Deployment uses only the exact verified artifact from protected `main`, after both checks. | `apps/site/tests/unit/pages-workflow.test.mjs:7-14` asserts both gates, exact `apps/site/dist`, main-only upload, and deploy dependencies; `17-31` asserts immutable action SHAs, least privilege, concurrency, and the protected Pages environment. | PASS |
| WEB-12 | A clean clone supports documented development, checks, tests, and production builds through pnpm. | Independent clean-clone evidence at implementation SHA `7d0b635`: frozen install, `pnpm gate:quick`, `pnpm site:test`, and `pnpm site:build` all passed. Commit `54d259a` changes only test fixture paths; its targeted 7-test suite passes with native `node:path` resolution. Root `package.json:39-44`, `README.md:73-96`, and `CONTRIBUTING.md:15-32` expose and document the commands. | PASS |

**Spec-anchored status**: 12/12 requirements matched specified outcomes; no spec-precision gap found.

## Gate Evidence

| Check | Result |
| --- | --- |
| Clean-clone `pnpm install --frozen-lockfile` | PASS |
| Clean-clone `pnpm gate:quick` | PASS |
| Clean-clone `pnpm site:test` | PASS |
| Clean-clone `pnpm site:build` | PASS |
| Site unit suite, independently rerun | 19 passed, 0 failed, 0 skipped |
| Platform-neutral repository-content suite at `54d259a` | 7 passed, 0 failed, 0 skipped |
| Playwright qualification | 45 passed across Chromium, Firefox, and WebKit |
| Lighthouse | 100 Performance, 100 Accessibility, 100 Best Practices, 100 SEO |
| Static output | 119 pages; built-output integrity check passed |

No test reduction or weakened assertion was identified in the feature diff.

## Linux CI Portability Repair

Commit `54d259a` changes only
`apps/site/tests/unit/repository-content.test.mjs`. It replaces hard-coded Windows
fixture roots and backslash-separated paths with `node:path` `resolve()` calls and
portable path fragments.

The repair preserves the original assertions:

- an input escaping the fixture root still throws `outside repository`;
- `ROADMAP.md` and `docs/qualification/t68-validation.md` remain allowlisted; and
- generated Astro content and unrelated package source remain excluded.

Independent targeted command:

```text
node --test apps/site/tests/unit/repository-content.test.mjs
```

Result at `54d259a`: **7 passed, 0 failed, 0 skipped**. The diff introduces no
implementation behavior change and removes the Linux CI false failure caused by
Windows-only test path literals.

## Discrimination Sensor

The mutation ran only in detached scratch worktree
`verchestra-site-verifier-e39d04a45bc345c383efa425e070a21d`; the real working tree was not modified.

| Mutation | Target | Expected failure | Result |
| --- | --- | --- | --- |
| Change `nextTask: highestVerifiedTask + 1` to `+ 2` | `apps/site/src/lib/repository-content.ts:175` | Exact public status test must reject T70 as the successor to T68. | KILLED: targeted suite exited 1; 6 passed and 1 failed with actual `nextTask: 70` versus expected `69`. |

**Sensor depth**: lightweight, highest-risk truthfulness compiler  
**Result**: 1/1 mutation killed — PASS.

## Supply-Chain Release-Age Finding

A separate fresh-store CI-mode probe with a **non-repository** policy override,
`minimumReleaseAge=1440`, rejected newly published
`@playwright/test`, `playwright`, and `playwright-core` `1.62.0`, plus
`ip-address` `10.3.1`. Exact reproduction:

```powershell
$env:CI = "true"
corepack pnpm --config.minimum-release-age=1440 install `
  --frozen-lockfile `
  --ignore-scripts `
  --store-dir .pnpm-verifier-store
```

This is **not a blocker for this website specification**:

- the repository does not configure `minimumReleaseAge`;
- the declared frozen clean-clone command passed;
- the CI workflow executes that same declared command;
- WEB-01 through WEB-12 do not require an externally imposed 24-hour package quarantine; and
- the site remains `0.0.0-qualification`, not a package or 1.0 release.

It is a legitimate optional supply-chain-hardening decision. It becomes blocking if the project or organization adopts a 1,440-minute release-age policy. At that point the repository should encode the policy itself and either wait for the pinned packages to age past the window or record narrow, reviewed exceptions—never silently weaken the CI check.

## Code Quality

| Principle | Status |
| --- | --- |
| Scope matches the approved website and documentation portal | PASS |
| Canonical content remains single-source | PASS |
| Static output has no runtime data authority | PASS |
| Tests assert exact product/status values rather than implementation presence alone | PASS |
| Deployment permissions are isolated to the deploy job | PASS |
| Actions and dependency versions are pinned | PASS |
| No generated output or machine-local data is tracked | PASS |
| Existing project conventions and English-only public policy are preserved | PASS |

## Edge Cases

- Missing qualification evidence is rejected by `repository-content.test.mjs:31-43`.
- Repository path escape and duplicate routes are rejected by
  `repository-content.test.mjs:46-49,75-83`.
- Reduced motion, direct deep links, 404 recovery, and keyboard-only navigation are
  exercised in `site.spec.ts`.
- Installability and production-readiness overclaims are rejected from built output.
- Windows Lighthouse cleanup handles transient locked temporary directories with a
  bounded retry.

## Operational Post-Merge Acceptance

The orchestrator must still verify after merging to protected `main`:

1. `Quality gate` and `Site quality` are both successful for the deployed SHA.
2. `Deploy GitHub Pages` consumes that run's uploaded artifact.
3. `https://accd.github.io/verchestra/`, a direct documentation route, search,
   `robots.txt`, and the sitemap return successfully over HTTPS.

These checks validate external GitHub state; they do not require a repository code fix.

## Summary

**Overall**: PASS — implementation ready for protected-main publication.

**Spec-anchored check**: 12/12 WEB requirements matched.  
**Gate**: clean-clone gate and build passed at the implementation baseline; the `54d259a` portability suite passed 7/7; 19 unit, 45 browser, and Lighthouse qualification evidence remains valid.
**Sensor**: 1/1 targeted mutation killed.  
**Blocking findings**: none.  
**Advisory**: decide whether to adopt a repository-owned dependency release-age policy before the eventual 1.0 release.
