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

## Workspace packages

| Package | Responsibility | Allowed internal dependencies | Relevant tests | Canonical documentation |
| --- | --- | --- | --- | --- |
| `apps/vestra-cli` | CLI parsing, composition, launchers, and public errors; `closure/` holds the entries the T76 candidate builder bundles into a sealed release's `bin/*.mjs` | Any package needed for composition | CLI unit/integration/E2E and release tests | `README.md`, `docs/architecture.md` |
| `apps/vestra-launcher` | Publishable `verchestra` npm launcher: host gate, pinned public release inputs, and the bootstrap that activates a verified release | None from `src/`; `closure/` reaches `packages/distribution` and `packages/platform-node` by relative path, at build time only | `tests/architecture/vestra-launcher-boundaries.test.mjs`, `tests/build/vestra-launcher-package.test.mjs`, `tests/security/vestra-launcher-package-security.test.mjs` | `.specs/features/npx-launcher/`, `apps/vestra-launcher/README.md` |
| `apps/site` | Static product and documentation website | No runtime product-package dependency | `apps/site/tests`, Playwright, Axe, Lighthouse | Repository Markdown and site guides |
| `packages/contracts` | Versioned portable schemas and generated contract types | None | Contract and schema tests | `schemas/`, `VERSIONING.md` |
| `packages/domain` | Platform-free primitives, workflow rules, and errors | `contracts` only | Domain unit/property tests | `docs/architecture.md` |
| `packages/application` | Use cases, orchestration, and adapter ports | `contracts`, `domain` | Unit and integration tests | `docs/architecture.md` |
| `packages/workspace` | Workspace discovery, placement, initialization, and reconciliation | `contracts`, `domain`, `application` | Workspace unit/integration/E2E/security | Architecture and qualification reports |
| `packages/agent-runtime` | Bounded task execution and driver supervision | `contracts`, `domain`, `application` | Executor/driver integration, E2E, fault, security | Architecture and driver qualification |
| `packages/data-probe` | Read-only database planning, parsing, and adapters | `contracts`, `domain`, `application` | Database unit/integration/security | Database workflow guide and qualification |
| `packages/memory` | Source-bound lifecycle, storage, retrieval, and vector index | `contracts`, `domain`, `application` | Memory unit/integration/fault/security | Architecture and memory qualification |
| `packages/effects` | Durable effects and authority-bound effect execution | `contracts`, `domain`, `application` | Effect unit/integration/fault | Architecture and qualification reports |
| `packages/evidence` | Signed packages, capsules, bundles, handoffs, and verification | `contracts`, `domain`, `application` | Evidence/handoff unit, integration, E2E, security | Architecture and qualification reports |
| `packages/policy` | Cedar policy evaluation and activation | `contracts`, `domain`, `application` | Policy unit/integration/security | Security policy and Cedar qualification |
| `packages/platform-node` | Node filesystem, Git, state, secret, and coordination adapters | `contracts`, `domain`, `application` | Platform integration/fault/security | Architecture and isolation qualification |
| `packages/drivers` | Claude, Codex, OpenCode/Qwen, and Pi driver adapters | `contracts`, `domain`, `application` | Driver lifecycle/security and spike suites | Driver qualification reports |
| `packages/connectors` | Jira and Confluence boundary adapters | `contracts`, `domain`, `application` | Connector integration/fault/security | Integration qualification reports |
| `packages/extension-host` | Governed extension loading boundary | `contracts`, `domain`, `application` | Skill/extension unit and security tests | Architecture and qualification reports |
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

