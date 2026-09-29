# Init Probe Scaffold Tasks

**Status:** T1–T5 complete on `feat/234-init-probe-scaffold`; T6 (independent
review of AD-035) pending

## Test Coverage Matrix

| Layer | Test file | Coverage | Command |
| --- | --- | --- | --- |
| Generator | `tests/unit/probe-scaffold.test.mjs` | Per-engine byte determinism and contract 1 digests, file hygiene, directory independence, TODO(driver) codes, directory confinement, input refusal, generator purity | `pnpm test:unit` |
| Contract copy | `tests/contract/probe-scaffold-typecheck.test.mjs` | Strict NodeNext typecheck of all eight scaffolds, type identity with the published ports and a drift sensor, repository ESLint, repository Prettier | `pnpm test:contract` |
| Kit fidelity | `tests/contract/probe-scaffold-kit.test.mjs` | TODO(driver) failure in process and through `node --test`, pass on published fixtures, same session calls and verdicts as the published adapters, distinct failure codes, real `node:sqlite` pass | `pnpm test:contract` |
| CLI manifest | `tests/contract/cli-surface.test.mjs` | Option names, literal values pinned to the generator, parser refusal | `pnpm test:contract` |
| Init transaction | `tests/integration/safe-init-probe-scaffold.test.mjs` | Preview writes nothing, apply bytes and ownership, no-op repeat, no overwrite of a filled-in scaffold | `pnpm test:integration` |
| Binary | `tests/e2e/init-probe-scaffold-e2e.test.mjs` | `--dry-run` byte identity, apply, repeat, custom directory, no dependency, honest kit failure in the applied workspace, argument refusals | `pnpm test:e2e` |

## Execution Plan

1. **T1:** Per-engine templates and the deterministic generator in
   `packages/workspace/src/init/`. Requirements: IPS-01, IPS-02, IPS-06,
   IPS-10, IPS-11. Done.
2. **T2:** Port-level kit and `node --test` wiring, with the fidelity tests
   against the published adapters. Requirements: IPS-07, IPS-08. Done.
3. **T3:** Strict typecheck, contract identity and drift sensor, ESLint, and
   Prettier over the generated output. Requirements: IPS-05, IPS-09. Done.
4. **T4:** `init` options, validation, and `SafeInitService` wiring; manifest
   and e2e tests. Requirements: IPS-03, IPS-04, IPS-12. Done.
5. **T5:** README and `docs/data-probe-contract.md` sections, AD-035, and this
   feature directory. Done.
6. **T6:** Independent review of AD-035, in particular the vendored contract
   copy, the `.verchestra/probes/` confinement, and the `.mts` format. Then
   rebase onto `main` after #379 merges. Pending.

## Follow-ups (not in this change)

- AI completion of the TODOs as a delivery task through `vestra task` (#405).
- An upgrade path when the probe contract version changes.
- Replacing the copied contract and kit with an import once the kit is
  distributed, or with the out-of-process host (#235).
