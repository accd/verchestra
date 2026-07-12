# T04 Validation — Codex Driver

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 55 passed, 0 failed, 0 skipped, 0 todo (15 T04 cases)  
**SPEC_DEVIATION:** none

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Required outcome | Covered |
| --- | --- | --- | --- |
| Installed CLI is detected without model use | `codex-driver.test.mjs:12` | Exact compatible version and capabilities | Yes |
| Incompatible version blocks | `codex-driver.test.mjs:21` | Unsupported CLI fails before a turn | Yes |
| Local invocation is constrained | `codex-driver.test.mjs:27` | App Server uses local stdio and no bypass flag | Yes |
| Handshake and private prompt transport | `codex-driver.test.mjs:34` | Experimental capability negotiated; prompt is stdin-only | Yes |
| Thread policy is explicit | `codex-driver.test.mjs:45` | Ephemeral, read-only, untrusted, explicit tool schema | Yes |
| Identity/events/usage normalize | `codex-driver.test.mjs:60` | Common Driver evidence preserves semantics | Yes |
| Tool request is mediated data | `codex-driver.test.mjs:69` | Dynamic request is normalized and not executed | Yes |
| Built-in effects fail closed | `codex-driver.test.mjs:75` | Command approval is declined; no hidden writer | Yes |
| Malformed stream fails closed | `codex-driver.test.mjs:81` | Invalid JSONL cannot become an event or action | Yes |
| Provider failure is stable | `codex-driver.test.mjs:87` | Turn failure becomes typed evidence | Yes |
| Cancellation escalates correctly | `codex-driver.test.mjs:94` | Protocol interrupt precedes tree termination | Yes |
| Backpressure is bounded | `codex-driver.test.mjs:113` | Excess output closes with a stable limit error | Yes |
| Ambient credentials are excluded | `codex-driver.test.mjs:119` | Only allowlisted/explicit child environment survives | Yes |
| Sensitive output is redacted | `codex-driver.test.mjs:129` | Secret absent from all serialized results | Yes |
| Session state is non-portable | `codex-driver.test.mjs:137` | Thread/turn IDs never enter portable output | Yes |

## Checks B–D

- **Non-shallow:** tests execute the installed CLI version probe and real child-process JSONL protocol; the schema and initialization smoke use the installed App Server. Assertions cover normalized values, ordering, policy parameters, errors, cancellation, limits, and absence of secrets/state.
- **Necessary:** every case maps to T04 Done-when, VES-MDL-001…005, VES-HOF-004, or the common Driver oracle. The read-only Passport constraint prevents an unsupported writer claim.
- **Guidelines:** official OpenAI guidance selects App Server; the locally generated 0.115.0 schema defines the tested wire shape. No paid or state-mutating model call was needed for protocol qualification.

## Independent adequacy verdict

PASS — all prior and 15 T04 cases pass with zero skip. Tests were added before implementation, observed failing, and were not weakened, deleted, skipped, or deferred. The experimental dynamic-tool dependency is explicit and is bound to version/schema conformance rather than treated as stable by assumption.
