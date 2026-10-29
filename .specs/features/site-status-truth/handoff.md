---
schema: verchestra-feature-handoff/v1
feature: site-status-truth
issue: null
status: verification
branch: site/status-truth
baseRevision: d2f6de855089e1496a6d9a95c01c54975da1120e
lastCompletedTask: T5
nextTask: Human review and merge of the pull request; then PR-B (site/landing-redesign) and PR-C (site/docs-chrome) rebase on the merged main
lastGate: gate:quick PASS; site unit 66/66; architecture 148/148; agent:check PASS; site build + check:built PASS (135 pages); e2e 54/54 on three browsers; Lighthouse audits within budget but the gate itself fails on a Windows temp-cleanup EPERM; astro check not runnable on this Windows machine (emnapi alpha WASM crash, same on main)
updatedAt: 2026-10-29T17:20:00Z
---

# Scope

Make every status statement on the public site true to the repository: the
signed 1.0.0 decision is a reject recorded as a hold, T77 is complete, the
published npm package is the primary path, and AD-017 governs the engine
wording. Pin the status-bearing guides to the derived status so the drift
cannot recur silently. This is PR-A of the three-PR site redesign approved on
2026-10-29; PR-B (landing redesign) and PR-C (docs chrome, light mode, H1,
Mermaid gap) follow on their own branches.

# Completed evidence

T1–T4 complete; see `validation.md` for the requirement-to-evidence table and
the gate transcript. Seventeen tracked files changed; no validation report and
no signed decision file was touched.

# Next action

1. Human review of the pull request. Merge by rebase through the maintainer
   bypass only after the required checks pass at the exact head; the CI `site`
   job is the authoritative run of `astro check` and Lighthouse, which this
   machine could not complete (see `validation.md`).
2. After merge, move this handoff to `complete` and start PR-B
   (`site/landing-redesign`) and PR-C (`site/docs-chrome`) from the merged
   `main`, since their copy depends on the honest strings landed here.

# Known limitation

`astro check` cannot run on the Windows machine that produced this evidence:
`@astrojs/check@0.9.12` resolves `@emnapi/runtime@2.0.0-alpha.3` as its WASM
fallback and the import crashes before the checker starts, on `main` as well.
The CI `site` job runs it on Ubuntu, where the native binaries are used. A
lockfile re-resolution of `@emnapi/runtime` would need the dependency-upgrade
approval `AGENTS.md` requires; it is outside this change.
