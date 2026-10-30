# Repository Map

Read the root and closest scoped `AGENTS.md` before editing any area.

## Dependency model

Portable dependencies point inward: contracts → domain → application.
Adapter packages may depend on those inward packages but never on sibling
adapters. `apps/vestra-cli` is the private composition root and may import any
package it needs. `apps/vestra-launcher` is the public composition root and is
stricter than every other package: its `src/` may import no workspace package
at all, because its published tarball must reach nothing but Node built-ins.
Its build-input directory `closure/` is the one exception — it composes the
activation closure from `packages/distribution` and `packages/platform-node`
by repository-relative path, never by package name, so the launcher still
declares no dependency edge and the closure is resolved by the bundler at
build time rather than by the published tarball at run time. `apps/site` is an
independent build-time documentation projection.

No production module reaches itself through its runtime imports, its own
package index included (`tests/architecture/no-import-cycles.test.mjs`). A
package's test doubles live in its `src/testing.ts`, never in an entry point;
production source imports one only from the self-test composition
(`tests/architecture/no-test-doubles-in-entry-points.test.mjs`).

## Workspace packages

| Package | Responsibility | Allowed internal dependencies | Relevant tests | Canonical documentation |
| --- | --- | --- | --- | --- |
| `apps/vestra-cli` | CLI parsing, composition, launchers, and public errors; `closure/` holds the entries the T76 candidate builder bundles into a sealed release's `bin/*.mjs`; the first-party SQLite probe worker is bundled the same way from `src/probe/sqlite-probe-worker-main.ts`, and a checkout builds it, git-ignored, into `dist/` with `corepack pnpm build:probe-worker` | Any package needed for composition | CLI unit/integration/E2E and release tests | `README.md`, `docs/architecture.md` |
| `apps/vestra-launcher` | Publishable `verchestra` npm launcher and the per-target `vestra` single binary (#236): host gate, pinned public release inputs, and the bootstrap that activates a verified release; `single-binary/` pins the embedded official Node runtime | None from `src/`; `closure/` reaches `packages/distribution` and `packages/platform-node` by relative path, at build time only | `tests/architecture/vestra-launcher-boundaries.test.mjs`, `tests/build/vestra-launcher-package.test.mjs`, `tests/security/vestra-launcher-package-security.test.mjs`, `tests/build/vestra-binary.test.mjs`, `tests/unit/sea-inject.test.mjs` | `.specs/features/npx-launcher/`, `.specs/features/single-binary-distribution/`, `apps/vestra-launcher/README.md` |
| `apps/site` | Static product and documentation website | No runtime product-package dependency | `apps/site/tests`, Playwright, Axe, Lighthouse | Repository Markdown and site guides |
| `packages/contracts` | Versioned portable schemas and generated contract types | None | Contract and schema tests | `schemas/`, `VERSIONING.md` |
| `packages/domain` | Platform-free primitives, workflow rules, and errors | `contracts` only | Domain unit/property tests | `docs/architecture.md` |
| `packages/application` | Use cases, orchestration, and adapter ports | `contracts`, `domain` | Unit and integration tests | `docs/architecture.md` |
| `packages/workspace` | Workspace discovery, placement, initialization, and reconciliation | `contracts`, `domain`, `application` | Workspace unit/integration/E2E/security | Architecture and qualification reports |
| `packages/agent-runtime` | Bounded task execution and driver supervision | `contracts`, `domain`, `application` | Executor/driver integration, E2E, fault, security | Architecture and driver qualification |
| `packages/data-probe` | Read-only database planning, parsing, and adapters; the CLI composes its registration and access policy validation, from `apps/vestra-cli/src/database/`, and its planner and SQLite parser, from `apps/vestra-cli/src/probe/`, and opens no database itself; only the first-party SQLite probe worker, `apps/vestra-cli/src/probe/sqlite-probe-worker.ts`, which runs as its own bundled process, takes the SQLite adapter and its read-only connection | `contracts`, `domain`, `application` | Database unit/integration/security; `tests/architecture/database-command-composition.test.mjs` | Database workflow guide and qualification; `.specs/features/database-registration/`, `.specs/features/probe-run/`, `.specs/features/sqlite-probe-worker/` |
| `packages/memory` | Source-bound lifecycle, storage, retrieval, and vector index | `contracts`, `domain`, `application` | Memory unit/integration/fault/security | Architecture and memory qualification |
| `packages/effects` | Durable effects and authority-bound effect execution | `contracts`, `domain`, `application` | Effect unit/integration/fault | Architecture and qualification reports |
| `packages/evidence` | Signed packages, capsules, bundles, handoffs, and verification | `contracts`, `domain`, `application` | Evidence/handoff unit, integration, E2E, security | Architecture and qualification reports |
| `packages/policy` | Cedar policy evaluation and activation | `contracts`, `domain`, `application` | Policy unit/integration/security | Security policy and Cedar qualification |
| `packages/platform-node` | Node filesystem, Git, state, secret, and coordination adapters | `contracts`, `domain`, `application` | Platform integration/fault/security | Architecture and isolation qualification |
| `packages/drivers` | Claude, Codex, OpenCode/Qwen, and Pi driver adapters | `contracts`, `domain`, `application` | Driver lifecycle/security and spike suites | Driver qualification reports |
| `packages/connectors` | Jira and Confluence boundary adapters | `contracts`, `domain`, `application` | Connector integration/fault/security | Integration qualification reports |
| `packages/extension-host` | Out-of-process probe host: the `verchestra-probe/1` protocol, workspace probe admission, and the probe worker supervisor; the CLI composes its admission, through the `./admission` export, from `apps/vestra-cli/src/extension/extension-check.ts`, and starts a probe worker under its admission, supervisor and framed protocol only from `apps/vestra-cli/src/probe/probe-run.ts`; the first-party SQLite probe worker, `apps/vestra-cli/src/probe/sqlite-probe-worker.ts`, takes only its frame codec | `domain` (the only one it declares; the adapter rule would also allow `contracts` and `application`) | Probe protocol, admission, and supervisor contract/security/fault tests; `tests/architecture/extension-host-composition.test.mjs` | `.specs/features/out-of-process-probe-host/`, `.specs/features/probe-host-composition/`, `.specs/features/probe-run/`, `.specs/features/sqlite-probe-worker/` |
| `packages/distribution` | Hermetic bundles, TUF resolution, activation, rollback, and uninstall | `contracts`, `domain`, `application` | Distribution E2E/fault/security/release | Distribution architecture and T66–T68 evidence |
| `packages/self-test` | Self-Test trust domain facts: disposable-root provisioning, path-fact probing, sentinel capture, cleanup, quarantine mechanics, test-only keys | `contracts`, `domain`, `application` | Self-Test unit/security/fault tests | T69 specification in `.specs/features/self-test/` |

The executable source of truth for package edges is
`scripts/architecture.mjs`; `tests/architecture/repository-boundaries.test.mjs`
keeps this map aligned with the approved graph.

## Non-package areas

| Area | Responsibility | Primary checks |
| --- | --- | --- |
| `.specs` | Decisions, requirements, plans, handoffs, and validation | `pnpm agent:check` |
| `docs` | Canonical architecture, roadmap, and qualification evidence | readiness, link, and site projection tests |
| `schemas` | Canonical versioned public contracts | `pnpm test:contract` |
| `scripts` | Repository generators, gates, and deterministic tooling | architecture/readiness tests |
| `spikes` | Bounded dependency and provider qualification | `pnpm test:qualification` |
| `tests` | Cross-package behavioral verification | declared `pnpm test:*` commands |

