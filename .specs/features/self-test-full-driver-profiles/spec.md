# T71 Full, Fault, and Approved-Driver Self-Test Specification

## Problem statement

The existing Self-Test proves isolation and the smoke/workspace surfaces, but it
does not exercise the complete delivery workflow, restart convergence, or an
explicitly reviewed read-only Driver invocation. Release qualification needs a
hermetic profile that exposes failures in those boundaries without reaching a
real provider, credential, production root, or writer Tool.

## Goals

- Add complete `full` and `drivers` scenario content to the closed profile
  registry.
- Prove process-independent, exactly-once convergence for every declared
  durable boundary in the full scenario.
- Prove denied Driver authority causes zero provider calls.
- Prove an approved Driver review surface states the exact destination, cost,
  model capability, and egress scope before a deterministic read-only run.
- Add at least 30 discriminating system, fault-injection, and security cases.

## Out of scope

| Exclusion | Owner / reason |
| --- | --- |
| Live, paid, or credential-bearing provider calls | Forbidden in Self-Test |
| Writer Tool exposure or mutation of the subject repository | Forbidden by #12 |
| A fifth crash profile ID | Sealed T57 contract and AD-010 |
| `doctor --deep` and new report schema/fields | T72 (#13) |
| Installer, production-readiness, or 1.0 claims | Later qualification tasks |
| Requalification of the provider adapters themselves | Existing T35–T37 evidence |

## Requirements

### FULL-01 — Complete delivery path

WHEN the `full` profile runs THEN it SHALL exercise production APIs for package,
approval, context compilation, model routing, read-only effect, verification,
portable Handoff, and terminal Run Capsule creation inside one disposable trust
domain.

### FULL-02 — Closed durable-boundary catalog

WHEN the full scenario declares restart coverage THEN application-owned rules
SHALL require exactly the registered durable boundary IDs and SHALL reject a
missing, duplicate, unknown, or failed boundary fact.

The initial catalog is:

1. `full.package.stored`
2. `full.approval.stored`
3. `full.execution.checkpoint-stored`
4. `full.effect.intent-stored`
5. `full.effect.receipt-stored`
6. `full.gate.commit-stored`
7. `full.verification.report-stored`
8. `full.handoff.prepared-stored`
9. `full.handoff.publication-receipt-stored`
10. `full.handoff.acceptance-stored`
11. `full.capsule.stored`

### FULL-03 — Hard-crash convergence

WHEN a deterministic child process exits immediately before or after any
registered durable boundary THEN a clean process resumed from the same
disposable state SHALL converge to the same semantic fingerprint and SHALL
contain exactly one logical result for every boundary.

### FULL-04 — Portable evidence safety

WHEN the full profile emits package, Handoff, Capsule, or Self-Test evidence
THEN it SHALL contain no provider-local session, transcript, prompt, credential,
secret, environment value, or machine-local path.

### DRV-01 — Explicit review surface

WHEN a Driver invocation is proposed THEN the human-inspectable review facts
SHALL bind the exact provider/model destination, maximum cost, model
capabilities, allowed read-only Tools, data classification, purpose, retention,
and egress scope.

### DRV-02 — Denied authority makes no provider call

WHEN approval, capability, destination, cost, or egress authority is absent or
mismatched THEN invocation SHALL fail closed before Driver resolution, process
spawn, SDK construction, or any other provider boundary call.

### DRV-03 — Approved deterministic provider boundaries

WHEN exact authority is approved THEN the profile SHALL exercise the qualified
Claude Code, Codex, and OpenCode/Qwen boundaries using deterministic local
substitutes, SHALL display the exact review facts, and SHALL perform no network
call.

### DRV-04 — No writer Tool

WHEN the approved Driver request is constructed THEN its Tool catalog SHALL be
closed to read-only capabilities, and any writer-shaped Tool or permission
request SHALL be unreachable or denied before provider execution.

### CLI-01 — Reachable profiles

WHEN `vestra self-test --profile full` or `--profile drivers` is invoked THEN
the production CLI SHALL run the selected packaged profile and preserve the
existing stable exit-code and human/JSON report contracts.

### TST-01 — Adequate evidence

WHEN T71 is submitted for verification THEN at least 30 system,
fault-injection, and security cases SHALL pass, no assertion SHALL be skipped or
weakened, `pnpm gate:quick` and `pnpm gate:security` SHALL pass, and independent
verification plus human review SHALL remain required.

## Edge cases

- Unknown, missing, reordered, or duplicated durable-boundary facts fail closed.
- A crash before the first durable write and after the final durable write both
  converge safely.
- A lost acknowledgement is reconciled before any retry.
- A forged cost, destination, capability, or egress value invalidates authority
  and records zero provider calls.
- A Driver requesting a writer Tool is denied even when its other fields match.
- Provider-local values are rejected from portable artifacts and from the
  allowlisted Self-Test report.
- All scenarios stay offline and leave guarded roots byte-identical.

## Traceability

| Requirement | Upstream requirements | Status |
| --- | --- | --- |
| FULL-01 | VES-TST-003 | In tasks |
| FULL-02 | VES-TST-006–007 | In tasks |
| FULL-03 | VES-TST-006, VES-HOF-005–006 | In tasks |
| FULL-04 | VES-TST-007, VES-HOF-005–006 | In tasks |
| DRV-01 | VES-TST-005 | In tasks |
| DRV-02 | VES-TST-005 | In tasks |
| DRV-03 | VES-TST-003/005 | In tasks |
| DRV-04 | VES-TST-005 | In tasks |
| CLI-01 | VES-TST-003 | In tasks |
| TST-01 | Issue #12 completion | In tasks |

Coverage: 10 requirements, 10 mapped to tasks, 0 unmapped.
