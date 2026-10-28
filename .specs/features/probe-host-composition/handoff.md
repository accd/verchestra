---
schema: verchestra-feature-handoff/v1
feature: probe-host-composition
issue: 235
status: complete
branch: feat/235-extension-commands
baseRevision: d069bf9291efaeeafbdc9dcea189fb56b8eafb0f
lastCompletedTask: T1
nextTask: "Plan slice 2 of T3 in its own feature: `vestra probe run` and grant issuance, the grant a CapabilityGrant in the authority store under a run row (owner decision, 2026-10-28), with database registration persistence; see plan.md Out of scope."
lastGate: "Independent Verifier round 2 PASS at ec219824 (profile light, validate_verification exit 0); SonarCloud follow-up on sonar/679-extension-follow-up: gate:quick, test:contract and agent:check PASS on Windows; test:unit and test:contract with coverage, and the extension, launcher, sealed closure, architecture and task suites PASS on Linux"
updatedAt: 2026-10-28T21:52:49Z
---

# Evidence

Slice 1 (T1) is complete and verified. It lands with PR #679. These commands
now take a workspace probe worker to "would be admitted" with nothing
started:

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

The proof results per platform are in `validation.md`, with the dispositions
of the Verifier's round 1 findings. The independent report is
`verification.md`: round 1 failed on two pinned command lists outside the
checks (fixed in `ec219824`), and round 2 passed every check on Linux and
Windows. macOS was not run locally; CI covers it.

A SonarCloud follow-up on branch `sonar/679-extension-follow-up`, based on
#679's head `985f3b8f`, addresses the two quality gate conditions #679
failed (new-code coverage and duplication). It changes no behaviour: it adds
in-process tests and removes the duplicated blocks SonarCloud named. Its
evidence is the "SonarCloud follow-up" section of `validation.md`; only the
next SonarCloud analysis can confirm the gate.

# Next exact action

Send the SonarCloud follow-up branch for human review as its own PR, after
#679 merges, and confirm the next SonarCloud analysis passes the gate. Then
plan slice 2 as its own feature under `.specs/features/`: `vestra probe run`
and grant issuance, using the authority-store grant the owner chose on
2026-10-28, plus database registration persistence. Start from `plan.md`'s
Out of scope rows and door 4, which keeps the supervisor and spawned worker
unreachable from the CLI until slice 2's grant exists.
