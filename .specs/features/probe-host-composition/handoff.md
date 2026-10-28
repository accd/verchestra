---
schema: verchestra-feature-handoff/v1
feature: probe-host-composition
issue: 235
status: verification
branch: feat/235-extension-commands
baseRevision: d069bf9291efaeeafbdc9dcea189fb56b8eafb0f
lastCompletedTask: T1
nextTask: "Dispatch an independent Verifier over d069bf92..HEAD against plan.md and checks.md (C1-C34)."
lastGate: "gate:quick PASS and agent:check PASS on Windows; every proof in checks.md passes on Linux (WSL Ubuntu 24.04) and on Windows (validation.md)"
updatedAt: 2026-10-28T23:30:00Z
---

# Evidence

Slice 1 (T1) is built on `feat/235-extension-commands`. These commands now
take a workspace probe worker to "would be admitted" with nothing started:

- `vestra extension add`
- `vestra extension approve`
- `vestra extension list`
- `vestra extension revoke`
- `vestra extension check`

Owner decisions taken mid-build are recorded in `plan.md`:

- Landing door 6: TLC is required by `resolve`, not by lock validation.
- The registration record is the update's evidence.
- Two Out of scope follow-ups: re-approving a revoked reference, and
  re-registering a worker.

The proof results per platform are in `validation.md`. The `## Handoff`
lines of `checks.md` name the boundary commit. Nothing is pushed.

# Next exact action

Dispatch an independent Verifier over `d069bf92..HEAD` with `plan.md`,
`checks.md` (C1-C34) and `validation.md`. The Verifier has to run the proofs
that need `approve` and `check` on Linux or macOS. On Windows, those proofs
assert the refusal.
