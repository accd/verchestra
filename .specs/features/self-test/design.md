# Self-Test Design

## The constraint that decides the shape

Adapters cannot import sibling adapters (`scripts/architecture.mjs`,
`VES_ARCH_ADAPTER_COUPLING`), and the orchestrator must exercise exactly those
siblings: workspace, policy, evidence, drivers. So the split is by nature, not
by task — rules in `application`, Node-bound facts in an adapter, sibling
wiring only in the composition root.

| Layer                                          | Contents                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/application/src/self-test/`          | `SelfTestOrchestrator`, closed profile registry, non-overlap rules, Sentinel Set comparison, quarantine state machine, report allowlist rules, all port interfaces, error codes             |
| `packages/self-test/` (new adapter)            | Disposable-root provisioning and path-fact probing (realpath, junction, device and inode), sentinel capture, bounded fixture factory, cleanup, quarantine mechanics, test-only key material |
| `apps/vestra-cli/src/self-test-composition.ts` | The only place that constructs TEST-ONLY instances of the sibling adapters and hands them to the orchestrator as `SelfTestSubjectPort`                                                      |

Ports return facts, never verdicts: `roots.provision()` returns `RootFacts`
(canonical path, real path, device id, inode id, link chain); the overlap
decision is a pure rule in `application`. A rule an adapter can answer is a
rule nobody can unit-test.

## Decisions inherited from exploration

- Profile ids come from the already-qualified support-bundle enum:
  `smoke | full | workspace | drivers` (T57 evidence). Crash-recovery in T71
  is a mode inside `full`, not a fifth id — the enum is sealed evidence.
- No `VES_SELFTEST_*` code enters `self_test.failure_codes` without being
  registered in a `SupportCodeRegistry`; none exists in the CLI yet, so
  building it is in scope here.
- No report field may match the prohibited-content pattern
  (`source|prompt|context|credential|secret|environment|row|raw|transcript|log|database`).
- No JSON schema for the report until T72: `schema-registry.test.mjs` seals
  the schema list, and `test:contract` does not run in `gate:security`, so a
  schema added here would break a gate this task never runs.
- Test placement: `tests/unit/`, `tests/security/`, and
  `tests/fault-injection/` only — `gate:security` does not run the contract,
  integration, or e2e scopes.

## Repository registration order

1. `scripts/architecture.mjs` `EXPECTED_PACKAGES` gains `packages/self-test`
   (first edit — the boundary test fails the moment the directory exists).
2. `docs/repository-map.md` gains the adapter row.
3. `scripts/gate-selection.mjs` security rule gains `self-test`.
4. Package skeleton with `private: true`, `version: "0.0.0"`,
   `type: "module"`.
