# Structural Verifier Isolation Design

## Why no new package

AD-010 splits Self-Test into three places because adapters cannot import
sibling adapters and the domain must exercise exactly those siblings. This
feature has no equivalent pressure: `packages/drivers` already provides real
process isolation and driver identity for every implementation session, and
`packages/application/src/verification/` already owns verification's rules.
Adding a package here would duplicate what `packages/drivers` already proves
(a driver session is a real, separate OS process) — a table-driven read at
existing exports is cheaper and more honest than a parallel abstraction.

## What changes

### `packages/application/src/verification/verification.ts`

- New error codes: `VES_VERIFIER_DRIVER_CONFLICT`, `VES_VERIFIER_GRANT_INVALID`.
- `VerificationInput` gains `implementerDriverId: string` and
  `verifierDriverId: string` (both required, non-empty, validated by the
  existing `token()` helper).
- `IndependentVerificationCoordinator.verify` checks
  `implementerDriverId === verifierDriverId` immediately after the existing
  actor-identity check (same position, same "before anything else" shape) and
  fails with `VES_VERIFIER_DRIVER_CONFLICT` naming both ids.
- `assertReadOnlyGrant(tools: readonly unknown[]): void` — a pure function
  requiring the granted tool array to be **empty**. No tool-name classifier
  is introduced: verification inspects already-produced evidence and runs
  sensors, neither of which needs any execution-tool capability, so the only
  honest, non-guessable definition of "read-only" here is zero granted
  tools — the same structural instinct as `packages/data-probe`'s
  `sessionReadOnly` fact (asked of the engine/session itself, never inferred
  from an operation-name list). A nonempty grant fails with
  `VES_VERIFIER_GRANT_INVALID` naming the count and the first tool name.
- `resolveVerifierDriver(candidates: readonly {driverId: string; available: boolean}[], implementerDriverId: string): {status: "resolved"; driverId: string} | {status: "not-configured"}` —
  pure, exported standalone (not a coordinator method): filters to
  `available && driverId !== implementerDriverId`, sorts by `driverId` for
  determinism, returns the first or `not-configured`. Composition roots call
  this to decide _which_ driver to spawn for verification; the coordinator
  only validates the _result_ was applied correctly (SVI-01).
- The sealed report (`schemaVersion: 2`) adds `implementerDriverId` and
  `verifierDriverId` fields alongside the existing `actorBinding`. The input
  normalizer rejects `schemaVersion !== 2` with the existing
  `VES_VERIFIER_INPUT_INVALID` code — no new code needed, the check already
  exists, only the accepted literal changes.
- Sensor result gains no new field; SVI-06 is satisfied by requiring
  `verifierDriverId` to already be validated (SVI-01) before the sensor runs,
  so a driver-identity tamper is caught earlier in the same call, and the
  existing `activeStateBeforeDigest`/`AfterDigest` mismatch mechanism already
  fails closed on a tampered digest — this task adds a test proving that
  mechanism plus the driver check compose correctly, not a new mechanism.

### Tests only, no adapter changes

`tests/unit/verification-driver-isolation.test.mjs` — new file. Uses fake
ports (the existing `VerificationPorts` shape) plus two labeled fake driver
identities (`"driver-a"`, `"driver-b"`) to exercise SVI-01/02/03/07 as pure
function calls, and one `DeterministicMockDriver`-backed scenario for SVI-04
(tool-invocation rejection is meaningful only against a real `Driver`
implementation, even a deterministic one, because it proves the rejection
happens at the driver-session boundary rather than being hand-waved by a
fake). SVI-05/06 extend `tests/unit/independent-verification.test.mjs`
in place (schema bump touches existing fixtures there).

## Rejected

A new `packages/verifier-runtime` adapter — no sibling-adapter coupling
problem exists here to force a split; `packages/drivers` is already inward of
nothing `packages/application` cannot depend on through the existing driver
port pattern. Spawning a bespoke child process for verification — drivers
already do this and reusing them keeps one process-isolation mechanism in the
codebase, not two. A live-CLI-only test — forbidden (paid calls) and would
make the suite flaky/non-deterministic in CI.
