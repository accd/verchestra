---
schema: verchestra-feature-handoff/v1
feature: npx-launcher
issue: 36
status: in_progress
branch: codex/npx-vestra-bootstrap
baseRevision: c0b53a498087c466f9a6c89ff345b389b5946de9
lastCompletedTask: T1
nextTask: T2 after T76 defines the executable launcher and observed health protocol
lastGate: repository gate:build and gate:security PASS on bfab60355942e5a19259a0ee3dc40c9a377778be
updatedAt: 2026-08-09T19:55:00Z
---

# Scope

Deliver AD-016's `npx vestra` bootstrap over the qualified TUF and
transactional-activation path. Ambient Node is bootstrap-only; product control
passes to the activated bundle's `launcher:vestra` and embedded Node 24.14.0.

# Current Evidence

- Issue #36 and its owner scope comment fix the npm shape and defer the single
  binary post-1.0.
- Existing TUF and activation implementations are qualified, but no API maps
  the validated active pointer to a launcher path.
- Repository inspection found no production TUF root, repository URLs,
  executable candidate closure, production activation health gate, or emitted
  npm build. Current release fixtures contain placeholder bytes only.
- The npm registry reports `vestra` as unpublished on 2026-07-25; owner control
  or reclaim must be confirmed before release.
- T1 adds `TransactionalActivationManager.resolveActiveLauncher()`. It reads
  the closed active pointer, reopens the installed bundle, verifies every
  component byte, binds pointer identity to the bundle, selects exactly
  `launcher:vestra`, and returns an immutable path result without execution.
- Five additive behavior/security cases moved from RED to GREEN. The complete
  focused activation suites pass 44 of 44 with zero skipped or todo.
- `gate:quick` passes, and the full security suite passes 1001 of 1001 with no
  skipped or todo cases.
- Two local `gate:build` attempts reached integration but were inconclusive due
  to Windows `EBUSY` cleanup failures in disposable self-test fixture roots (5
  cases, then 4). All T1 cases passed; no assertion was weakened or bypassed.
- Repository validation passed both `gate:build` ([run
  31332661966](https://github.com/accd/verchestra/actions/runs/31332661966))
  and `gate:security` ([run
  31332772835](https://github.com/accd/verchestra/actions/runs/31332772835))
  on the exact implementation commit
  `bfab60355942e5a19259a0ee3dc40c9a377778be`.

# Next Exact Action

T2 is the next code task after T76 defines a directly spawnable launcher and
the real pre-publication health protocol. The repository owner must also
confirm control of the unpublished npm name and the approved emitted/bundled
JavaScript build path before T3.

# Blockers

T1 is complete. T2 requires T76 to define a directly spawnable launcher and
real health protocol. T3 additionally requires the real TUF root/URLs/source
identity, npm-name control, and an approved emitted/bundled JS build path. T4
requires the T76 candidate. These block closing #36, not the T1 bridge.

# Decisions

- Never hard-code `bin/vestra.cmd`; that name belongs to a Windows test fixture.
- Never synthesize activation health evidence or ship a test TUF root.
- Resolve through pointer -> verified release manifest -> component identity.
- No shell interpolation of user arguments.
- Do not claim a public installer, clean-machine pass, or issue completion
  until T76-owned inputs and platform evidence exist.

# Files Intentionally Left Unchanged

- Qualification-chain reports and derived status surfaces; B4 is out of chain.
- Milestone programme files currently touched by the in-flight T72 report PR.
- `verchestra-workpackages-2026-08-09/`; local coordination input, never staged
  or committed.
