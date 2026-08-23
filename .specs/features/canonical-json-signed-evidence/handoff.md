---
schema: verchestra-feature-handoff/v1
feature: canonical-json-signed-evidence
issue: 58
status: complete
branch: codex/issue-58-signed-evidence-execution-package
baseRevision: b0e0c831c4efa52f85d7c90b7e5fa10a5527a3a8
lastCompletedTask: T4
nextTask: Continue the remaining #58 T4j/T4k migration from canonical-json-t4-completion.
lastGate: PR #305/#307 required checks and human review passed; merged at 190e06f
updatedAt: 2026-08-23T00:00:00Z
---

# Scope

This is the Execution Package portion of the signed-evidence migration for #58.
It intentionally leaves Run Capsule, Recovery Bundle, Support Bundle, and release
surfaces at their current recorded V1 contracts.

# Completion

PR #305 introduced the versioned Execution Package and PR #307 applied the
review correction; both are merged on `main`. No private signing material was
needed or accessed by this work. The slice is complete; the remaining #58
portable identities are tracked by `canonical-json-t4-completion`.

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
