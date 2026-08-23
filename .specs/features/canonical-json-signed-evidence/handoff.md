---
schema: verchestra-feature-handoff/v1
feature: canonical-json-signed-evidence
issue: 58
status: verification
branch: codex/issue-58-signed-evidence-execution-package
baseRevision: b0e0c831c4efa52f85d7c90b7e5fa10a5527a3a8
lastCompletedTask: T4
nextTask: Request reviewer re-validation of the V2 receiver-boundary canonical-ordering fix; do not merge without that review.
lastGate: Reviewer correction focused evidence 117/117 PASS; corepack pnpm gate:quick PASS (2,067 unit and 153 readiness); corepack pnpm gate:security PASS; reviewer re-validation remains required.
updatedAt: 2026-08-23T12:18:51Z
---

# Scope

This is the Execution Package portion of the signed-evidence migration for #58.
It intentionally leaves Run Capsule, Recovery Bundle, Support Bundle, and release
surfaces at their current recorded V1 contracts.

# Blockers

Human review remains mandatory before merge. No private signing material is
needed or accessed by this work.

The first independently checked candidate (`b116e84`) was rejected. It changed
legacy V1 code-unit default-sort sites to locale ordering for `uniqueStrings`,
task component/command/criterion arrays, and `blockedBy`. No product output from
that candidate is accepted. The correction keeps code-unit ordering for those
sites in both versions and keeps `localeCompare` only where schema V1 used it
historically.

The corrected candidate was independently validated on `a06c242`: the verifier
compared the base and corrected V1 outputs with mixed-case values, reran the
focused suite and agent check, and killed a disposable locale-order mutation.
This validation does not replace the mandatory human review before merge.

The reviewer of PR #305 found that a trusted signer could seal a V2 payload
with a non-canonical set order and the receiver would normalize it silently.
The correction compares the complete normalized V2 payload with the signed
payload at the receiver boundary, while leaving V1 verification semantics
unchanged. A trusted-signer regression covers mixed-case `requiredCapabilities`
ordering, and the canonical census records the two new canonicalizer signals.
The correction is locally gate-verified; reviewer re-validation is the next
action and no merge is authorized by this handoff.

`site:test` reached its Playwright phase but its configured Astro preview command
daemonized and its parent exited before Playwright could supervise it. This
pre-existing local test-infrastructure observation is not recorded as a pass;
the static site checks and build passed. It is outside this Execution Package
slice and needs a separately scoped site-preview review if it remains reproducible.
