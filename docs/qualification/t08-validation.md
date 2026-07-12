# T08 Validation — Worker Isolation and Framed Protocol

**Gate:** `corepack pnpm@10.34.5 gate:security`  
**Result:** 203 passed, 0 failed, 0 skipped, 0 todo (50 T08 cases)  
**SPEC_DEVIATION:** none. Strong isolation is correctly unqualified, not simulated.

## Check A — Sufficient coverage

| Done-when / requirement | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Content-Length framing and streaming | `framed-protocol.test.mjs:29` — `assert.equal(header, Content-Length byte size)`; lines 36–45 assert split and concatenated decoding | UTF-8 byte-framed stdio | Yes |
| Malformed/oversized worker output | `framed-protocol.test.mjs:50–89` — exact `VES_FRAME_*`/envelope codes with `grantsRevoked: true, terminationRequired: true` | Reject, revoke, and terminate; infer no action | Yes |
| Workspace and sequence isolation | `framed-protocol.test.mjs:94–113` — exact Workspace, gap, conflict, duplicate outcomes | Cross-Workspace denied; invalid stream terminated; identical duplicate idempotent | Yes |
| Exact handshake | `framed-protocol.test.mjs:140–163` — full negotiated object and exact mismatch/escalation codes | Bind protocol/schema/identity/capabilities/size | Yes |
| Backpressure | `framed-protocol.test.mjs:168–178` — exact pause/resume, overflow cancellation, retained size | Bounded queue; no silent drop | Yes |
| Skill/untrusted authority | `isolation-policy.test.mjs:26–35` — reclassification and explicit-grant codes | No implicit execution or content-driven promotion | Yes |
| Isolation grades and no downgrade | `isolation-policy.test.mjs:39–69` — exact strong block and platform evidence results | High risk blocked without qualified strong isolation | Yes |
| Environment/cwd/resource bounds | `isolation-policy.test.mjs:80–106` — full allowlisted env and launch object | Minimal environment, dedicated cwd, explicit limits | Yes |
| Filesystem boundary | `isolation-policy.test.mjs:116–146` — realpath allow, outside/junction/Workspace denial | No access outside granted roots/Workspace | Yes |
| Network boundary | `isolation-policy.test.mjs:151–157` — default deny and exact-origin result | Network denied except call-specific allowlist | Yes |
| Probe read-only and limits | `isolation-policy.test.mjs:161–194` — exact principal/session/schema/function/table/concurrency/row/byte/timeout failures with `promotedEvidence: false` | Missing controls or exceeded bounds block production evidence | Yes |
| Cancellation escalation | `worker-supervisor.test.mjs:16–30` — exact ordered evidence and invoked stages | Cancel → grace → signal → tree kill | Yes |
| Real process-tree death | `worker-supervisor.test.mjs:37–43` — parent and descendant `true` before, `false` after | No worker descendant survives cancellation | Yes |

## Check B — Non-shallow

The 50 cases assert complete protocol payloads, stable failure codes plus revocation/termination conjunctions, actual queue state, realpath/junction outcomes, full launch/environment records, Probe promotion state, exact cancellation evidence, and live OS process status. The process-tree test spawns a real descendant and verifies both PIDs are dead after the platform tree-kill adapter runs.

## Check C — Necessary reverse mapping

| Test evidence | Maps to | Keep |
| --- | --- | --- |
| Framing, handshake, sequencing, queue cases | AD-016 and T08 protocol/backpressure criteria | Yes |
| Skill execution and untrusted authority cases | VES-SKL-005, VES-SEC-006 | Yes |
| Workspace/path/network/environment cases | VES-SEC-003 and T08 restricted-resource criteria | Yes |
| Probe dual-readonly and bound cases | VES-DBP-002…003 | Yes |
| Isolation-grade matrix and real tree termination | T08 strong-isolation/no-survivor criteria | Yes |

## Check D — Guidelines

Tests follow AD-016, design sections 7.1–7.3 and 9, the T08 definition, and the project Test Coverage Matrix. Platform capability tests intentionally distinguish selection/attestation fixtures from native-helper implementation; no unimplemented strong sandbox is advertised.

## Adequacy verdict

PASS — all 50 cases are requirement-bound, exceed the ≥24 threshold, and prove fail-closed protocol/resource/cancellation behavior without overstating the available sandbox grade. The complete security gate passes without skips.
