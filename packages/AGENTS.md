# Package Instructions

Apply the root `AGENTS.md` first.

- Read `docs/repository-map.md` and the target package manifest before editing.
- Preserve the dependency rules enforced by `scripts/architecture.mjs`.
- Contracts contain portable structures; domain contains platform-free rules;
  application defines workflows and ports; adapters implement inward ports.
- Do not import Node modules or read `process.env` from `packages/domain`.
- Adapter packages may depend on contracts, domain, and application, but not on
  sibling adapters. Compose adapters only in `apps/vestra-cli`.
- Export public package behavior through the package `src/index.ts`.
- Add unit tests for pure behavior, integration tests for adapter boundaries,
  security tests for authority/data handling, and fault tests for recovery.
- Run the smallest matching test scope, `pnpm test:architecture` for dependency
  changes, and then `pnpm gate:quick`.
