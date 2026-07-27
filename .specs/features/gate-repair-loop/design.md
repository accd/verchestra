# Gate Repair Loop Design

## Package Schema Addition

```json
"onGateFailure": {
  "maxAttempts": 3,
  "feedbackToDriver": true,
  "escalateAfter": 2
}
```

Declared per gate (or per package with per-gate override — decided in T1
contract work). Added through `schemas/` and
`scripts/generate-contract-types.mjs`; generated output is never edited.

## Execution Flow (verified integration points)

```text
task-executor.execute()
  └── checkpoint "awaiting-gate" (task-executor.ts:475)
        └── gate-commit.run()
              ├── pass → COMMITTED (existing, gate-commit.ts:681)
              └── fail → today: save("gate-failed") (gate-commit.ts:519)
                    └── NEW: policy = package.onGateFailure ?? { maxAttempts: 1 }
                          ├── attempts < maxAttempts → capsule(attempt) →
                          │   checkpoint "repair" → re-dispatch driver
                          │   (feedback appended if feedbackToDriver)
                          └── attempts >= escalateAfter →
                              save("escalated") → human review state
```

- Attempt counting and the last gate output live in the checkpoint data, so
  a crash mid-repair resumes without double-counting (idempotent
  reconciliation, not blind retry).
- Each attempt seals its own Run Capsule; capsules chain via
  `previousAttemptDigest`.

## Feedback Construction (REP-06)

- Source: the failed gate's bounded output already captured in the
  `GATE_FAILED` result (`gate-commit.ts:526-528`).
- Bounded to a fixed byte budget, redacted through the existing egress
  firewall (`DataEgressFirewall.authorize`, already an executor port), and
  recorded by digest in the attempt capsule.
- When `feedbackToDriver` is false, the capsule records the withholding
  explicitly (REP-03).

## Escalation State (REP-04)

`escalated` is a new recoverable checkpoint stage: work stops, the attempt
chain is complete evidence, and continuation requires a human decision
recorded through the existing approval boundary. No autonomous retry past
`escalateAfter` under any circumstances.

## Test Strategy

- Unit: policy parsing bounds, attempt counting, feedback withheld/attached.
- Integration: flaky gate (fail once, then pass) converges; permanent
  failure escalates at exactly `escalateAfter`.
- Fault injection: crash between attempts resumes with correct counts;
  no duplicate capsules.
- Regression: packages without `onGateFailure` produce byte-identical
  single-attempt behavior against current fixtures.
- Security: feedback cannot carry secrets — redaction sensors in
  `tests/security/`.
