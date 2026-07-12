# T02 Validation — Pi Runtime Boundary

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 28 passed, 0 failed, 0 skipped, 0 todo  
**SPEC_DEVIATION:** Package namespace updated from deprecated `@mariozechner/pi-*` to current `@earendil-works/pi-*`; architecture and boundary semantics are unchanged.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Required outcome | Covered |
| --- | --- | --- | --- |
| Current packages are exact-pinned | `spikes/pi-runtime/test/pi-boundary.test.mjs:31-32` — package versions equal `0.80.6` | Current Pi runtime/AI packages are immutable inputs | Yes |
| Deprecated packages are absent | `pi-boundary.test.mjs:37` — deprecated-prefix search equals `false` | No deprecated Pi dependency remains | Yes |
| Resolved model identity is explicit | `pi-boundary.test.mjs:43-47` — deep-equal API/provider/model | Driver result preserves exact resolved identity | Yes |
| Usage and normal completion are preserved | `pi-boundary.test.mjs:48-50` — tokens positive, stop `stop`, text `hello` | Usage/output/stop evidence survives normalization | Yes |
| Streaming lifecycle is normalized | `pi-boundary.test.mjs:56-58` — started, nonempty delta, closed | Ordered normalized lifecycle and content | Yes |
| Allowed tool uses mediation | `pi-boundary.test.mjs:78-80` — one execution, request and non-error completion | Controller authorization precedes one tool effect | Yes |
| Denied tool never executes | `pi-boundary.test.mjs:100-101` — executions `0`, error completion exists | Denial blocks implementation | Yes |
| Abort is stable | `pi-boundary.test.mjs:125-126` — stop `aborted`, code `VES_PI_ABORTED` | Controller cancellation remains distinct | Yes |
| Overflow stops before provider | `pi-boundary.test.mjs:132-133` — capacity code, call count `0` | Ineligible context never invokes Pi/provider | Yes |
| Provider failure is normalized | `pi-boundary.test.mjs:139-141` — stop/error code/message exact | Provider error remains non-throwing evidence | Yes |
| Stream contract rejection is distinct | `pi-boundary.test.mjs:153-155` — runtime code/message exact | Runtime integration failure is not mislabeled provider failure | Yes |
| Portable result excludes private state | `pi-boundary.test.mjs:162-165` — no messages/prompt/system/session data | Pi state never enters portable output | Yes |
| Every run starts fresh | `pi-boundary.test.mjs:176-177` — both outputs `visible:1` | No transcript leaks between runs | Yes |

## Check B — Non-shallow litmus

- Tests assert normalized payload values and resulting execution counts, not mock call presence alone.
- Denial would fail if tool code executed even once.
- Overflow would fail if the faux provider received a call.
- Privacy would fail if any private prompt/system/session field entered the serialized result.
- Fresh-state behavior would fail if the second Agent reused the first transcript.

## Check C — Necessary tests

| Test group | Maps to | Keep |
| --- | --- | --- |
| Package pins/deprecation | T02 qualification input and lock requirement | Keep |
| Identity/usage/streaming | VES-MDL-005 and T02 Done-when | Keep |
| Allowed/denied tools | VES-SKL-005, Verchestra authority boundary | Keep |
| Abort/overflow/errors | T02 Done-when, VES-CTX-001, Driver contract | Keep |
| Private-state exclusion/fresh run | VES-HOF-004 and T02 zero canonical ownership | Keep |

## Check D — Guideline conformance

Tests follow T02 and the Driver contract matrix in `.specs/features/verchestra-1.0/tasks.md`. Official Pi faux-provider utilities are test inputs; no third-party behavior is reimplemented.

## Verdict

PASS — the Pi boundary is small, mediated, backend-neutral, and independently replaceable. All tests are spec-anchored and no test was weakened, deleted, skipped, or deferred.
