# Verchestra Specification State

## Decisions

### AD-001 — GitHub Pages website architecture

- **Status:** active
- **Decision:** Build the public website as the private `@verchestra/site` Astro workspace package and deploy static output through GitHub Actions to `https://accd.github.io/verchestra/`.
- **Rationale:** The website belongs with the product source, requires no runtime service, and must be reviewed and qualified with the same repository controls.

### AD-002 — Public website truth boundaries

- **Status:** active
- **Decision:** Repository Markdown remains canonical; website-only guides may live in the site package, and build-time adapters may project canonical documents without changing their source.
- **Rationale:** Public presentation must not create a second, drifting architecture or qualification record.

### AD-003 — Public status language

- **Status:** active
- **Decision:** The site describes `0.0.0-qualification`, T68 complete, and T69 next. It must not claim a public installer, production readiness, or a 1.0 release.
- **Rationale:** Evidence and release state take precedence over marketing language.

### AD-004 — Canonical agent instructions

- **Status:** active
- **Decision:** `AGENTS.md` is the only canonical agent instruction format; scoped files refine root rules and provider compatibility files are generated import-only pointers.
- **Rationale:** A provider-neutral hierarchy keeps a clean clone understandable without duplicated or drifting rules.

### AD-005 — Durable cross-agent memory

- **Status:** active
- **Decision:** Git, tracked specifications, decisions, tasks, validation evidence, and feature handoffs are the authoritative cross-agent memory.
- **Rationale:** Contribution and resumption must not depend on chat history, provider memory, an IDE, MCP, or an installed skill.

### AD-006 — LLM-readable content projection

- **Status:** active
- **Decision:** LLM-readable repository and website output is generated only from allowlisted canonical repository content and never becomes a second source of truth.
- **Rationale:** AI retrieval should preserve provenance, current qualification state, and the existing documentation authority boundary.

### AD-007 — Project license is Apache-2.0

- **Status:** active
- **Decision:** The project license changes from GPL-3.0-only to Apache-2.0, decided by the repository owner on 2026-07-26 after the external review triage (`.specs/features/external-review-triage/`).
- **Rationale:** The product targets enterprise adoption (auditable handoffs, Cedar, first-class enterprise database adapters); permissive licensing removes legal-department friction, and Apache-2.0 keeps an explicit patent grant. Authorship was verified with `git log`: the project is effectively single-author (owner plus the owner's local `Test` identity and trivial Dependabot bumps), so no external consent is required.
- **Consequences:** `package.json`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, and site pages (`index.astro`, `community.astro`, `ProductLayout.astro`) were updated in the same change. The GPL strings in `tests/unit/governed-skill-registry.test.mjs` and `tests/contract/skill-update-lifecycle.test.mjs` are skill-registry fixture data, not project license statements, and remain unchanged. Commits made before this decision stay historically GPL-licensed; the new terms apply from this change forward.

### AD-008 — External review re-prioritization (T68a–T68d)

- **Status:** active
- **Decision:** Four tasks from the verified external review triage are inserted into the product chain between T68 and T69: T68a key lifecycle, T68b budget enforcement, T68c declarative gate repair, T68d policy hardening. DSSE/in-toto and context-tokenizer decisions are mandatory before T76.
- **Rationale:** The review's blocker (ephemeral keys breaking cross-machine verification) and the cheap, high-value controls (budget, repair, policy) gate the product's central portability promise; existing T01–T68 evidence and T69–T77 numbering are preserved.
- **Consequences:** Derived status surfaces (`agent:context`, root `AGENTS.md`, `llms.txt`, site contracts) still assert "T68 complete; T69 next" and are migrated deliberately as part of starting T68a, with the corresponding gate-script and contract-test updates reviewed in that change.

### AD-009 — Domain packages take no third-party dependency; canonicalization is implemented internally

- **Status:** active
- **Decision:** `packages/domain` takes no third-party dependency. Where a domain package needs a capability an already-qualified third-party library provides, the rule stays: implement the primitive internally in domain rather than widen `scripts/architecture.mjs:67-69`'s third-party import boundary (`VES_ARCH_THIRD_PARTY_IMPORT`). The first instance is `canonicalizeJsonV2` (RFC 8785 / JCS), an internal, zero-import encoder in `packages/domain/src/canonical/canonical-json.ts`, decided 2026-08-01 during the `canonical-json` T3 slice (`.specs/features/canonical-json/`).
- **Rationale:** `scripts/architecture.mjs:67-69` already rejects any non-relative, non-`ajv` import in `contracts`, `domain`, or `application` as `VES_ARCH_THIRD_PARTY_IMPORT`. Reusing the already-qualified `canonicalize@3.0.0` implementation (used by `packages/evidence/src/integrity/canonical.ts` for V1) in domain would require widening that boundary and a lockfile update — a dependency and architecture decision, not an implementation detail. Writing the encoder internally avoids widening the control; the JS parts of JCS that are genuinely risky to reimplement (number serialization) are delegated to `JSON.stringify`, which is already RFC 8785-conformant for finite values.
- **Consequences:** `packages/evidence`'s V1 primitive stays on `canonicalize@3.0.0`; `packages/domain`'s V2 primitive is an independent implementation, anchored to the same published RFC 8785 vectors rather than to each other (`tests/unit/canonical-json-v2.test.mjs`). A future consolidation of the two implementations is a separate, explicitly reviewed migration. Any later domain package that would otherwise reach for a third-party library follows the same pattern: implement internally, or bring an explicit boundary-widening decision to the owner first.

### AD-010 — The Self-Test trust domain splits by nature, not by task

- **Status:** active
- **Decision:** T69's trust domain is split across three places because the architecture, not convenience, requires it: rules and port interfaces in `packages/application/src/self-test/`, Node-bound facts in the `packages/self-test/` adapter, and the only construction of TEST-ONLY sibling adapters in `apps/vestra-cli/src/self-test-composition.ts`. Ports return facts (resolved paths, device and inode ids, link chains, digests, residue), never verdicts. Profile ids stay exactly the four the qualified support-bundle contract admits; T71's crash-recovery is a mode inside `full`, never a fifth id.
- **Rationale:** `scripts/architecture.mjs` forbids an adapter from importing a sibling adapter (`VES_ARCH_ADAPTER_COUPLING`), and the orchestrator must exercise precisely those siblings. A rule an adapter can answer is a rule nobody can unit-test, so every verdict was pushed inward where it is provable without a filesystem; the boundary shaped the design instead of being worked around, including taking key material from `node:crypto` rather than from the evidence package.
- **Consequences:** T70–T72 extend the same three places rather than introducing a fourth. Widening the profile enum would reopen T57's sealed evidence and requires an explicit decision. Verdicts added to the adapter, or sibling imports added to it, are architecture regressions rather than refactors.

### AD-011 — Verifier isolation reuses driver process isolation; no new adapter package

- **Status:** active
- **Decision:** Structural verifier independence (#35) is built entirely inside `packages/application/src/verification/verification.ts`: distinct-driver-identity enforcement, a pure `resolveVerifierDriver` resolution function with an explicit `not-configured` result, and a read-only grant defined as exactly zero granted tools (`assertReadOnlyGrant`, `assertNoToolRequests`) rather than a name-based writer-tool classifier. No new adapter package is introduced.
- **Rationale:** Every real driver (`ClaudeCodeDriver`, `CodexDriver`, `OpenCodeDriver`) already spawns its session in a real, separate OS process and reports a `driverId` — this is the existing substrate for "Claude Code wrote → Codex verifies", so a parallel process-isolation mechanism would duplicate what already exists. A writer-tool name allowlist was considered and rejected during Specify: no such classification exists anywhere in the repository, and guessing one would be exactly the non-deterministic, bypassable pattern the English-only policy work had already rejected for content classification. Verification inspects evidence and runs sensors, neither of which needs any execution-tool capability, so zero granted tools is the only non-guessable definition of read-only — the same structural instinct as `packages/data-probe`'s `sessionReadOnly` fact, asked of the session itself rather than inferred from an operation-name list.
- **Consequences:** The sealed verification report bumps to `schemaVersion: 2` and records `driverBinding: {implementerDriverId, verifierDriverId}` alongside the existing `actorBinding`; `schemaVersion: 1` input is rejected, never silently upgraded. `resolveVerifierDriver` is exported for T71/T74/T75 composition roots to call when they wire a real verifying driver session; this feature does not perform that wiring itself.

### AD-012 — Bounded cognitive assistance rides the existing driver substrate

- **Status:** active
- **Decision:** Bounded cognitive functions (LLM-assisted roles) are admitted into the delivery path only as *proposers*: every such role emits a `Candidate*` output that the deterministic core is free to accept, reject, or ignore. A cognitive function never grants authority, seals, signs, admits evidence, verifies, nor approves. The deterministic core — schemas, policy, authority, budgets, digests, evidence admission, independent verification, and human review — stays untouched by this decision. Decided by the repository owner on 2026-08-04: proceed **zero-SDK** (no external agents SDK enters as a dependency), and **after the beta** (only this ADR lands now; no cognitive code before the qualified beta exists).
- **Rationale:** The substrate a cognitive role needs already exists in-repo, so no framework is required to build one: `CapabilityModelRouter` (`packages/agent-runtime/src/models/model-router.ts`, per-role model selection under role-independence constraints), signed Passports (`packages/agent-runtime/src/models/passport-registry.ts`), `DeterministicContextCompiler` (`packages/agent-runtime/src/context/context-compiler.ts`, bounded input under a token budget), `BudgetMeter` (`packages/application/src/execution/budget-meter.ts`) with `packages/application/src/execution/model-price-table.ts`, `SchemaRegistry` (`packages/contracts/src/schema-registry.ts`, Ajv — ready to validate LLM output), and the `DataEgressFirewall` redaction boundary (`packages/application/src/egress/trust-egress.ts`). A cognitive role composes these existing parts plus a `Driver`; only three small, zero-new-dependency pieces are missing (a driver session runner over `Driver.start` → deltas → close, a `resolveExecution` that turns `(passportRef, serializedContextRef)` into `{prompt, model}`, and JSON schemas for role outputs). Adopting an external agents SDK instead would duplicate three existing layers (model routing, provider integration, context assembly) and — for a Python-first framework such as Strands — break the hermetic TUF distribution required by T76; the repository has zero Python and only five third-party runtime dependencies across seventeen packages, and that boundary is worth keeping.
- **Seam:** The integration point is a role-specific port, not a generic runtime. The first role is `GateRepairPorts.buildFeedback` (`packages/application/src/execution/gate-repair.ts`): a declared, currently-unimplemented port that is already ref-in/ref-out, digest-sealed, bounded by `FEEDBACK_BYTE_BUDGET` (16 KB), and redacted through the egress boundary — the natural "Gate Failure Analyst". Generic names (`AgentRuntime`, `CognitiveRoleRuntime`) are rejected: they collide with the existing runtime, Pi, and driver concepts and invite premature abstraction.
- **Non-interference:** Nothing cognitive enters the T71–T77 qualification chain or the beta path. An unconfigured cognitive provider is reported as an explicit `not configured`; there is never a silent fallback to a paid call. Reintroducing an external SDK is reconsidered only after a *second* proven use case and a formal discovery pass (language, transitive dependencies, license, and compatibility with hermetic distribution) — never as a default.
- **Anti-patterns (normative — a cognitive role MUST NOT):**
  1. **Grant authority.** Produce output that seals, signs, admits evidence, verifies, or approves, rather than proposing a `Candidate*` for the deterministic core to adjudicate.
  2. **Adopt an external agents SDK by default.** Bring a framework that duplicates the existing model router, driver/provider integration, or context assembly, or that breaks hermetic distribution; an SDK returns only through the second-use-case-plus-discovery gate above.
  3. **Abstract prematurely.** Introduce a generic `AgentRuntime`/`CognitiveRoleRuntime` runtime-of-runtimes before a second concrete role proves a shared shape, or reuse names that collide with runtime/Pi/drivers.
  4. **Fall back silently to paid work.** Treat a missing or unconfigured provider as anything other than an explicit `not configured`.
  5. **Interfere with the qualified chain.** Let any cognitive surface enter T71–T77 or the beta path.
  6. **Emit unbounded hints.** Return feedback or output not bounded by an explicit byte or token budget and not passed through the egress redaction boundary — an unbounded hint is an exfiltration channel.
  7. **Boil the ocean.** Stand up many roles or phases at once instead of proving one slice (`buildFeedback`) end-to-end first.
- **Consequences:** The first cognitive slice is scoped as a post-beta feature under `.specs/features/gate-feedback-role/` and follows the fake-first discipline (a deterministic mock driver, zero paid calls in canonical tests), a discrimination sensor, `gate:security`, and independent verification (author ≠ verifier). This ADR is documentation only; it adds no dependency, touches no product-chain code, and changes no qualification state.

## Handoff

- **Feature:** `self-test-full-driver-profiles` (T71, #12) — complete; the implementation merged via PR #182 (tip `ec258a2`) and is independently qualified in `docs/qualification/t71-validation.md` (author ≠ verifier).
- **Qualification chain:** T71 verified; **T72 (#13, deep doctor and signed diagnostic reports) is next**. The derived status surfaces (`agent:context`, root `AGENTS.md`, `llms.txt`, site `product.ts` and current-qualification-status content) advanced from "T70 complete; T71 next" to "T71 complete; T72 next" in the same change, with the corresponding contract-test and site-gate string updates.
- **Branch:** `main`
- **Verification:** `gate:quick`, `gate:full` (3,330 cases), and `gate:security` PASS at `9e663bd`; CI Quality gate and CodeQL PASS at the T71 tip `ec258a2`; discrimination sensor 5 of 5 killed, 0 survived.
- **Next:** Begin T72 (#13): `doctor --deep` and the signed diagnostic report schema, extending AD-010's three-region Self-Test boundary. Structural verifier isolation (#35, AD-011) remains available for T74/T75 composition roots via `resolveVerifierDriver`.
