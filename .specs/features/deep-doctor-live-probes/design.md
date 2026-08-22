# Deep Doctor Live Probes Design

## Architecture

Four seams, in dependency order. Each is a prerequisite for the next, and
three of the four are prerequisites the issue text did not name.

```
  (1) layout contract        (2) async probe port
      domain, pure                application, port widening
            |                            |
            +-------------+--------------+
                          |
              (3) read-only subpaths + transitive guard
                    platform-node/readonly, policy/readonly
                          |
              (4) seven live probes + availability records
                    apps/vestra-cli composition root
```

### 1. Layout contract (DDL-01..03)

`packages/domain/src/workspace-layout/subsystem-layout.ts` — a pure module,
no imports, exporting `WORKSPACE_ROOT_DIRNAME` and the seven subsystem
relative paths. Domain is provably read-only: `scripts/architecture.mjs`
already rejects any non-relative, non-`ajv` import there, so adding
`@verchestra/domain` to the doctor's import allowlist widens the graph by a
package that structurally cannot reach a writer.

`safe-init.ts` and `doctor-composition.ts` both consume it, replacing the two
independent literals that drifted once already.

### 2. Async probe port (DDL-04..05)

```
- export type DoctorSubsystemProbe = () => DoctorObservation;
+ export type DoctorSubsystemProbe = () => DoctorObservation | Promise<DoctorObservation>;

- export function collectDoctorFacts(probes: DoctorProbeSet): DoctorCheckFact[]
+ export async function collectDoctorFacts(probes: DoctorProbeSet): Promise<DoctorCheckFact[]>
```

`runDoctor` is already `async`; the single call site at
`doctor-composition.ts:64` becomes `await`, staying between
`ports.captureSentinels()` at line 62 and line 65. The per-probe
`try/catch -> { present: true, healthy: false }` degradation is preserved and
extended to rejected promises, so a broken observer still degrades to a stable
code instead of crashing the diagnostic.

**Sequential, not `Promise.all`.** The sentinel bracket asserts that nothing
changed *during* the diagnostic. Concurrent probes make a detected mutation
unattributable and turn the window into an unordered interval. A per-probe
timeout keeps the serial interval bounded.

**Rejected alternative:** pre-computing the async observations in the
composition root and feeding them as constant synchronous probes. This is
cheaper and it is what the issue text floats first, but it places the live
observation *outside* the sentinel window, which the issue's own final
acceptance criterion forbids.

### 3. Read-only subpaths and the transitive guard (DDL-12)

`tests/architecture/doctor-readonly-graph.test.mjs` is today a textual scan of
one file: an import allowlist, forbidden `fs` calls, exactly one `spawnSync`,
and a symbol denylist. Every live probe must import `@verchestra/platform-node`
or `@verchestra/policy`, whose barrels re-export genuine writers — including
`RuntimeStore` at `packages/platform-node/src/index.ts:9`. The regex would not
fire and the guard would keep passing while the reachable graph quietly stopped
being read-only.

Two changes, together:

- **Narrow entry points.** `@verchestra/platform-node/readonly` exports only
  `inspectRuntimeDatabase`, `ProtectedPathBroker`, and the new secret-presence
  surface. `@verchestra/policy/readonly` exports only `verifyPolicyBundle` and
  the new pure `policyViewDigest`. Only these subpaths enter the allowlist.
- **Transitive assertion.** The guard resolves the import closure from
  `doctor-composition.ts` and asserts no module in it names a writer, replacing
  a property held by inspection with one held structurally.

The transitive upgrade is not optional polish: it is what makes step 4's
availability records reviewable, because it is the mechanism that proves the
records did not smuggle an adapter in.

### 4. Live probes (DDL-06..11)

| Check | Surface | Sync | Notes |
| ----- | ------- | ---- | ----- |
| `sandbox` | `ProtectedPathBroker.create` then `openExisting` on an out-of-root path | async | Refusal is the pass signal. `create` performs `realpath` and `stat` only. |
| `sqlite-durable-state` | `inspectRuntimeDatabase` | sync | Already exists (`runtime-store.ts:472`); opens `readOnly: true, allowExtension: false, defensive: true` and runs `PRAGMA integrity_check`. One of the issue's named blockers is already resolved. |
| `cedar-policy` | `verifyPolicyBundle` plus a new pure `policyViewDigest(view)` | async | The digest is currently computed inside `CedarPolicyAdapter.#compile` and needs a `CedarEnginePort`; the pure export removes that dependency. |
| `secret-presence` | `SecretAdapter.has` | async | Never `SecretBrokerBindingInspector.isBound` — that calls `broker.bind()`, which mints a handle. |
| `driver` / `connector` / `probe` | Availability record read | sync | See below. |

**Availability records.** `tests/architecture/doctor-readonly-graph.test.mjs:77-79`
forbids `@verchestra/drivers`, `@verchestra/connectors`, and
`@verchestra/data-probe` by name — precisely the three packages these checks
would otherwise need. Rather than widen that list, each subsystem publishes an
availability record into the layout from step 1, and the doctor reads records.
The doctor never constructs an adapter, and the forbidden-package list stays
untouched and meaningful.

"Available" means the record exists, parses, and declares an installed
subsystem. Reachability is deliberately excluded: a reachability check is a
network or provider call, which would break both the read-only and the unpaid
property the whole diagnostic rests on.

## Components and responsibilities

| Component | Responsibility |
| --------- | -------------- |
| `packages/domain/src/workspace-layout/subsystem-layout.ts` | Sole authority for the workspace root dirname and the seven subsystem paths. |
| `packages/application/src/doctor/doctor-facts.ts` | Port widening and sequential async fact collection; unchanged fact mapping. |
| `packages/platform-node/readonly` | Narrow read-only observation surfaces: database inspection, path broker, secret presence. |
| `packages/policy/readonly` | Read-only bundle verification and pure policy-view digest. |
| `apps/vestra-cli/src/doctor-composition.ts` | The only place probes are constructed; sentinel bracket; sealing. |
| `scripts/provision-doctor-fixtures.mjs` | T75-only fixture provisioner, driven by the layout contract. |
| `tests/architecture/doctor-readonly-graph.test.mjs` | Transitive read-only proof over the doctor closure. |
| `tests/architecture/doctor-workspace-root.test.mjs` | Path-ownership and provisioning drift proof. |

## Dependency direction

contracts -> domain -> application; adapters depend inward only. The layout
contract lives in domain so both `workspace` (an adapter) and the CLI
composition root can consume it without either importing the other. No sibling
adapter dependency is introduced. `apps/vestra-cli` remains the composition
root.

## Security and trust boundaries

The diagnostic must remain read-only, unpaid, and non-leaking. Read-only is
enforced structurally by DDL-12 rather than by inspection. Unpaid is enforced
by excluding reachability from the availability definition. Non-leaking is
enforced by DDL-11: the observation vocabulary is two booleans, so no path,
value, digest, secret, or error string can reach the sealed report. The sealed
report stays bound to `DOCTOR_CODE_DIGEST`, so adding checks cannot silently
replay against a build with a different catalog.

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The transitive guard is expensive or flaky to resolve | Resolve statically from source specifiers, not by executing imports; cache within the test run. |
| The layout contract becomes a second source of drift | AC1 and AC2 make ownership and provisioning a gate, not a convention. |
| Availability records become a stub that always passes | The discrimination sensor must kill a record that declares a subsystem the build does not contain (AC13, edge case 4). |
| A live probe leaks a path or digest into the report | DDL-11 is asserted by a security test over the sealed payload, not by review. |
| Async widening lets an observation escape the bracket | AC3 asserts the await lands between the two captures; a test mutates a sentinel mid-probe and expects the diagnostic to fail closed. |
| Scope creep into a config surface | Explicitly out of scope per AD-019; the layout contract is fixture-only until T76+. |
