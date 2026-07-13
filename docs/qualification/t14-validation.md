# T14 Validation — Pure Workflow State Machine

**Gate:** `corepack pnpm@10.34.5 gate:quick`  
**Result:** 1,010 T14 unit/property/mutation cases and 72 retained unit cases passed; 0 failed, 0 skipped, 0 todo. Format, lint, and strict TypeScript passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Exact vocabulary and pure decisions | `workflow-machine.test.mjs:122–144` | 26 states, 29 commands, referential transparency, immutable decisions/events | Yes |
| Total state/command matrix | generated cases beginning at line 147 | All 754 pairs return a typed transition or stable rejection without throwing | Yes |
| Canonical lifecycle | `workflow-machine.test.mjs:162–193` | Planning, reviews, Execution Approval, implementation, independent verification, Human Review, completion | Yes |
| Optimistic concurrency | `workflow-machine.test.mjs:196–204` | Every stale state/command pair rejects before transition logic | Yes |
| Approval separation and invalidation | `workflow-machine.test.mjs:207–263` | No writer before Approval; exact binding; stale/effect-time/explicit changes return to approval and clear authority | Yes |
| Bounded repair | `workflow-machine.test.mjs:266–302` | Three in-scope cycles retain grant; fourth gap requires human resolution; expansion invalidates Approval | Yes |
| Independent verifier and human completion | `workflow-machine.test.mjs:305–327` | Author identity cannot verify; only Human Review reaches `COMPLETED` | Yes |
| Terminal closure | `workflow-machine.test.mjs:330–352` | Every active state can fail/abort/interrupt with Capsule intent; all terminal states reject all commands | Yes |
| Handoff and successor | `workflow-machine.test.mjs:355–437` | Publication approval separation, source terminality, new linked run, no inherited Approval, local bindings/claim/policy/task/source verification | Yes |
| Recovery-run terminal | `workflow-machine.test.mjs:440–453` | `RECOVERED` is reachable only by a recovery run and requests a Capsule | Yes |
| Mutation discrimination | generated five cases at line 479 | Approval removal/bypass, Human Review bypass, terminal reopening, and repair-scope authority mutants all die | Yes |
| Declarative edge enforcement | generated cases beginning at line 488 | Every declared edge accepts; every declared artifact and actor requirement is independently removed/changed and rejected | Yes |
| Public error catalog | `workflow-machine.test.mjs:539–559` | All 11 stable workflow errors validate against `public-error@1` | Yes |

## Check B — Non-shallow

The 754-case cartesian matrix invokes the production decision function for every state and command. Generated edge tests independently exercise every legal transition and remove each required evidence item or declared actor. Focused journeys inspect state versions, Approval snapshots, repair counters, author/verifier identities, terminal Capsule events, handoff publication mode, and successor links rather than checking only booleans.

Five structural mutants alter the declarative graph itself; validation kills every mutant. The workflow error registry is compiled through the canonical JSON Schema. No persistence, clock, policy engine, model, or connector is mocked inside the machine because the domain decision performs no I/O.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Execution Approval and invalidation | VES-EXE-001/003/006 | Yes |
| Repair, independent verifier, Human Review | VES-VFY-003/005/006 | Yes |
| Handoff/source terminal/successor/local rebind | VES-HOF-001/003/004 | Yes |
| Signed-package and source bindings | VES-SPC-004…005 | Yes |
| Terminal Capsule intent matrix | VES-RLS-005 | Yes |

## Check D — Guidelines

Tests were authored before implementation. The graph is the sole transition authority; the machine finds one edge or returns a stable rejection. Expected version is checked first. Terminal states have no outgoing edges. Approval and author identity are data in the snapshot, not process-local session state. Repair escalation is automatic at the bound. Handoff acceptance creates a fresh run at `EXECUTION_READY` only after portable and local prerequisites pass; it never mutates the terminal source or copies its Approval.

## Adequacy verdict

PASS — 1,010 focused cases exceed the ≥80 threshold, all five required mutations are killed, the transition matrix is total, requirements have direct evidence, and `gate:quick` passed.
