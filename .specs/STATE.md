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

- **Status:** active; narrowed by AD-032 for the installer clause only. The `verchestra` npm package is published, so repository-canonical surfaces and the documentation portal describe it truthfully. Production readiness and 1.0 stay unclaimed, and the homepage's typed `installable` flag and the copy driven by it remain an owner decision.
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
- **Decision:** Bounded cognitive functions (LLM-assisted roles) are admitted into the delivery path only as _proposers_: every such role emits a `Candidate*` output that the deterministic core is free to accept, reject, or ignore. A cognitive function never grants authority, seals, signs, admits evidence, verifies, nor approves. The deterministic core — schemas, policy, authority, budgets, digests, evidence admission, independent verification, and human review — stays untouched by this decision. Decided by the repository owner on 2026-08-04: proceed **zero-SDK** (no external agents SDK enters as a dependency), and **after the beta** (only this ADR lands now; no cognitive code before the qualified beta exists).
- **Rationale:** The substrate a cognitive role needs already exists in-repo, so no framework is required to build one: `CapabilityModelRouter` (`packages/agent-runtime/src/models/model-router.ts`, per-role model selection under role-independence constraints), signed Passports (`packages/agent-runtime/src/models/passport-registry.ts`), `DeterministicContextCompiler` (`packages/agent-runtime/src/context/context-compiler.ts`, bounded input under a token budget), `BudgetMeter` (`packages/application/src/execution/budget-meter.ts`) with `packages/application/src/execution/model-price-table.ts`, `SchemaRegistry` (`packages/contracts/src/schema-registry.ts`, Ajv — ready to validate LLM output), and the `DataEgressFirewall` redaction boundary (`packages/application/src/egress/trust-egress.ts`). A cognitive role composes these existing parts plus a `Driver`; only three small, zero-new-dependency pieces are missing (a driver session runner over `Driver.start` → deltas → close, a `resolveExecution` that turns `(passportRef, serializedContextRef)` into `{prompt, model}`, and JSON schemas for role outputs). Adopting an external agents SDK instead would duplicate three existing layers (model routing, provider integration, context assembly) and — for a Python-first framework such as Strands — break the hermetic TUF distribution required by T76; the repository has zero Python and only five third-party runtime dependencies across seventeen packages, and that boundary is worth keeping.
- **Seam:** The integration point is a role-specific port, not a generic runtime. The first role is `GateRepairPorts.buildFeedback` (`packages/application/src/execution/gate-repair.ts`): a declared, currently-unimplemented port that is already ref-in/ref-out, digest-sealed, bounded by `FEEDBACK_BYTE_BUDGET` (16 KB), and redacted through the egress boundary — the natural "Gate Failure Analyst". Generic names (`AgentRuntime`, `CognitiveRoleRuntime`) are rejected: they collide with the existing runtime, Pi, and driver concepts and invite premature abstraction.
- **Non-interference:** Nothing cognitive enters the T71–T77 qualification chain or the beta path. An unconfigured cognitive provider is reported as an explicit `not configured`; there is never a silent fallback to a paid call. Reintroducing an external SDK is reconsidered only after a _second_ proven use case and a formal discovery pass (language, transitive dependencies, license, and compatibility with hermetic distribution) — never as a default.
- **Anti-patterns (normative — a cognitive role MUST NOT):**
  1. **Grant authority.** Produce output that seals, signs, admits evidence, verifies, or approves, rather than proposing a `Candidate*` for the deterministic core to adjudicate.
  2. **Adopt an external agents SDK by default.** Bring a framework that duplicates the existing model router, driver/provider integration, or context assembly, or that breaks hermetic distribution; an SDK returns only through the second-use-case-plus-discovery gate above.
  3. **Abstract prematurely.** Introduce a generic `AgentRuntime`/`CognitiveRoleRuntime` runtime-of-runtimes before a second concrete role proves a shared shape, or reuse names that collide with runtime/Pi/drivers.
  4. **Fall back silently to paid work.** Treat a missing or unconfigured provider as anything other than an explicit `not configured`.
  5. **Interfere with the qualified chain.** Let any cognitive surface enter T71–T77 or the beta path.
  6. **Emit unbounded hints.** Return feedback or output not bounded by an explicit byte or token budget and not passed through the egress redaction boundary — an unbounded hint is an exfiltration channel.
  7. **Boil the ocean.** Stand up many roles or phases at once instead of proving one slice (`buildFeedback`) end-to-end first.
- **Consequences:** The first cognitive slice is scoped as a post-beta feature under `.specs/features/gate-feedback-role/` and follows the fake-first discipline (a deterministic mock driver, zero paid calls in canonical tests), a discrimination sensor, `gate:security`, and independent verification (author ≠ verifier). This ADR is documentation only; it adds no dependency, touches no product-chain code, and changes no qualification state.

### AD-013 — Milestone 2 recomposition and three-workstream distribution

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-09. (1) Milestone 2 (`1.0.0 — Verified release`) absorbs the four open release-gating issues that lived outside it (#217, #218, #207, #36), so 100% of the milestone equals backlog-zero (13 open issues). (2) The whole open backlog is distributed across three workstreams, superseding previous assignees: WS-A accd (#217, #218, #16, #35, #17, #18 — owner decisions, T75 remaining matrices, release engineering, human review), WS-B MiguelCorre (#13, #15, #36 — independent verification stream), WS-C brunomjanuario (#14, #58, #110, #207 — hardening implementation plus one report). (3) Qualification-report authorship: MiguelCorre authors `t72/t74/t75-validation.md`; brunomjanuario authors `t73-validation.md`. (4) The contributors receive portable work packages (one archive: `shared/`, `miguelcorre/`, `brunomjanuario/`; briefing text in Portuguese) while every repository-tracked artifact stays English-only.
- **Rationale:** Author ≠ verifier forces the report split: accd authored the T72–T74 implementations (PRs #188/#189/#190 and the C-1..C-3 remediation) and cannot verify them; brunomjanuario authored F1a (PR #200) inside T75 scope and cannot verify T75. The serial chain (T72→T77) plus the out-of-chain hardening set (#58 mandatory before T76, #35/#207 landing with T74/T75, #217/#218 owner ADs before T76) defines the dependency structure recorded in `.specs/features/milestone-2-completion/tasks.md`, grounded in the 2026-08-09 reanalysis (`analysis.md` in the same folder).
- **Consequences:** The milestone description was rewritten to the derived position ("T71 complete; T72 next") and dated; GitHub assignees now carry per-issue accountability; chain issues close only with their validation reports (the report-before-close rule that reverted the 2026-08-09 #16 close). The critical path is B1 (t72 report) → C4 → B2 → B3 → A5 (T76) → A6 (T77).

### AD-014 — Signature envelope is DSSE with in-toto Statement payloads (#217)

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-09, resolving the DSSE decision spec (`.specs/features/dsse-attestation/spec.md`, DSSE-01) in favour of **Option A**. Every artifact sealed through `ArtifactSealer` moves from the current detached base64url signature over project canonical JSON to a **DSSE envelope** (`payloadType`, `payload`, `signatures[{keyid, sig}]`) whose payload is an **in-toto `Statement`** with a Verchestra predicate type. Ed25519, `KeyProviderPort`, `PublicKeyRef`, and the trust root are unchanged — only the envelope and the signed pre-authentication encoding change. The migration is specified in `.specs/features/dsse-attestation/migration.md` and implemented before T76 (#17) qualification starts.
- **Rationale:** Three facts measured on `1f21582` made Option A the cheapest-now, most-expensive-later choice. (1) **The blast radius is bounded and centralized:** signing has a genuine single choke point — `NodeEd25519Signer.sign` (`packages/evidence/src/integrity/signer.ts:75`) reached only through `ArtifactSealer.seal` (`artifact-sealer.ts:111`, 8 call sites) and `ArtifactSealer.verify` (`artifact-sealer.ts:142`, 5 call sites), covering 8 sealed artifact kinds; DSSE's `PAE(payloadType, payload)` substitutes exactly at `artifact-sealer.ts:137`, where the signed bytes are built today. (2) **There is no installed base:** the product is `0.0.0-qualification` with no release, so the complete inventory of pre-decision sealed artifacts is regenerable repository content (`docs/proof/execution-package.json` plus test fixtures) — DSSE-02's dual-format burden and DSSE-03's re-verification burden are at their global minimum now and become permanent obligations after 1.0. (3) **The product already promises what it cannot deliver:** the hermetic bundle carries a `provenance.intoto.jsonl` slot (`tests/helpers/hermetic-bundle-fixture.mjs:39`) that nothing produces — repo-wide there is not one `intoto`/`dsse` producer. Option B would require deleting that promise; Option A makes it true. Option C was rejected on the same grounds as AD-009 and AD-010: this repository consistently ships one qualified path rather than two, and a second signed projection is a second surface to secure, keep consistent, and qualify forever.
- **Scope boundary:** AD-014 governs the 8 `ArtifactSealer` artifact kinds (Execution Package, Run Capsule, Recovery Bundle, Support Bundle, doctor report, promotion report, self-test report, approval grant) **and the T75 qualification evidence index** (`scripts/t75-evidence-index.mjs`), added 2026-08-12. The index is generated unsigned today and records that state explicitly (`signingState.signed = false`); `matrix.md` section 8 permits unsigned-first only on condition that the signature is scheduled here rather than merely deferred, so the DSSE migration seals it in the same change. Nothing else is added: the parallel signature surfaces that do **not** route through the sealer — policy bundles (`packages/policy/src/policy-bundle.ts`), passport registry, governed skill registry, work claims, trust egress, and the context manifest — sign digests or strings rather than attestable subjects and stay on their current mechanism; changing them is a separate decision. TUF release metadata (`packages/distribution/src/tuf-update-client.ts`, `tuf-js@5.0.1`) already speaks an external standard and is untouched.
- **Consequences:** `SealedArtifact<T>` (`packages/evidence/src/integrity/types.ts:33`) is replaced by a DSSE envelope; the four structural re-validation blocks in the evidence modules (`execution-package.ts:860-889`, `run-capsule.ts:557-582`, `recovery-bundle.ts:613-632`, `support-bundle.ts:625-638`) are rewritten against the new shape; `envelopeVersion: 1` — today implicit, with no rejection gate anywhere — becomes an explicitly gated, fail-closed field. 41 test and helper files touch signature machinery and migrate with the change; `docs/proof/` is regenerated by `scripts/generate-proof-artifact.mjs` and re-sealed under recorded evidence. The V1 format is **rejected**, never silently accepted (following the `verification.ts:271` precedent of bumping a sealed schema without a compatibility shim).

### AD-015 — One pinned, conservative, repository-owned context token estimator (#218)

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-09, resolving the tokenizer decision spec (`.specs/features/context-tokenizers/spec.md`, TOK-01) in favour of **Option B**. Verchestra ships a single deterministic token estimator implemented inside the repository, pinned and versioned, wired at the composition root so no product run depends on caller injection (TOK-04). Its identity (`name` + `version`) is recorded in the context manifest and therefore covered by the manifest digest and signature (TOK-02). The estimator is calibrated to **over-estimate** relative to real model tokenizers so that estimation error fails closed (context omitted or the compile refused) rather than dispatching a context larger than the model's real capacity. No third-party tokenizer dependency is added (TOK-03 does not engage).
- **Rationale:** The estimator is the last machine-dependent input in an otherwise pinned pipeline — fragment ordering is already provably deterministic (`context-compiler.ts:104-113`, proven invariant across all 24 source permutations by `tests/unit/context-compiler.test.mjs:19-33`), while `#estimate` is a bare `(content: string) => number` closure with no port, no identity, no product implementation, and zero wirings in `packages/`. Its only enforced contract is "positive safe integer, does not throw" (`context-compiler.ts:375-385`), so two conforming estimators may disagree arbitrarily — and the two heuristics actually present in this repository do, by roughly 25% on ordinary prose (`apps/vestra-cli/src/self-test-full-scenario.ts:380` word-count versus `tests/helpers/context-compiler-fixture.mjs:67` chars/4). That divergence is not cosmetic: the greedy accumulation at `context-compiler.ts:228-240` means an estimate difference changes **which** fragments are included and cascades to every later fragment, and `context-compiler.ts:222` can refuse the whole compile with `VES_CONTEXT_CAPACITY_INELIGIBLE` on one machine while another succeeds. The product's promise is that an Execution Package compiles the same context anywhere, not that budgets are maximally efficient — a _consistently_ approximate estimator satisfies the promise; a _divergently_ accurate one does not. Option B also follows the AD-009 precedent directly: when a domain-adjacent primitive was needed, this repository implemented it internally (`canonicalizeJsonV2`, CJ-02) rather than widen the dependency boundary — and `packages/agent-runtime`, which owns the compiler, currently carries **zero** third-party runtime dependencies against a product-wide total of five. Option A would put a WASM/JS tokenizer on that surface and tie a sealed-digest input to vendor release calendars, since the qualified per-model-family set drifts whenever a provider ships a new tokenizer; Option C keeps two qualified paths forever, rejected for the same reason as in AD-014.
- **Consequences:** A new estimator module ships in `packages/agent-runtime` with its identity constant; `ContextManifest` (`context-compiler.ts:51-74`, 24 fields, none tokenizer-related today) gains a `tokenizer: { name, version }` field, which enters `manifestId` and the signature automatically because both derive from the whole `unsigned` object (`context-compiler.ts:288-315`); `estimateTokens` stops being a required constructor argument and becomes an override with the qualified default. The second estimation surface — `ContextCapacityEstimatorPort` in `packages/agent-runtime/src/context/backend-serializers.ts:21-23`, which has the same no-product-implementation gap — adopts the same pinned estimator, so the repository ends with one estimator rather than the current three heuristics across two surfaces. Changing the estimator after 1.0 invalidates historical context manifests and therefore requires a versioned migration, exactly like a canonicalization change. Related finding routed to #58: `context-compiler.ts:76-86` and `backend-serializers.ts:46-55` each carry a private `canonicalJson()` that orders keys with ambient `localeCompare`, which the canonical-JSON contract prohibits on a trust path.

### AD-016 — The 1.0 entry point is an npx launcher over hermetic TUF activation

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-09 after a structured design review. Verchestra 1.0 ships **`npx vestra`** as its entry point: a small, publishable npm launcher that runs under the user's ambient Node **only as bootstrap** — it resolves the pinned release through the TUF update client (trust root pinned inside the npm package), drives transactional activation, and hands off to the activated bundle's own `launcher:vestra` shim, after which everything runs on the bundle's embedded Node 24.14.0 runtime. A per-target single binary is explicitly deferred to a post-1.0 issue. This resolves the open shape of #36 (WS-B / MiguelCorre).
- **Rationale:** The infrastructure below the entry point already exists and is qualified — hermetic single-target bundles with their own Node runtime and two launcher shims, TUF resolution with online/mirror/offline/air-gapped views, transactional activation with launcher health evidence — but nothing maps an activated release (`installRoot/active.json`) to a stable on-PATH command, and the external-review triage recorded no npx-vs-binary analysis at all (one deferred table row). The npm-first entry is the established distribution pattern for Node tooling, needs no new packaging technology, and preserves the hermetic promise: ambient Node touches only the bootstrap, and the TUF client is exactly the mechanism that forbids unpinned runtime downloads. A single binary duplicates what the bundle already carries (pinned runtime per target) at a much higher packaging cost per target, and each distribution channel is its own T76 qualification surface — the wrong place to double scope. `apps/vestra-cli` is `private: true` with `bin` shims importing TypeScript directly, so the launcher is a new small package, not a flip of the private flag. "Run as a skill" was considered and rejected as a category error: a skill may invoke the CLI; it is not a distribution channel.
- **Consequences:** #36's acceptance is unchanged (one command runs the portability demo from a clean machine) with the npx shape now fixed; the single-binary issue is filed post-1.0; T76 qualifies one distribution channel, not two.

### AD-017 — Database probes qualify at the edge; 1.0 ships the published contract and conformance kit

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-09 after a structured design review; resolves decision **D1** of `.specs/features/platform-qualification-matrix/matrix.md` and reshapes the database story. (1) **The 1.0 claim** is: a published probe contract, a runnable conformance kit, and real-SQLite qualification — no other live engine is claimed. (2) **Real-engine qualification happens at the edge:** a team implements the published connection port for its engine in **its own repository**, runs the conformance kit against its own database, and commits the probe; teammates pull it like any delivered code. Workspace-side only — generated or hand-written probe code never enters the installed product. (3) **1.0 work (issue #233, WS-C):** export every engine's connection port and supporting types, add the package `exports`, parameterize the six remaining kit helpers with the proven `realConnection` pattern, unweld the two fixture-bound postgres assertions, document the flow. (4) **Post-1.0:** the deterministic `vestra init` probe scaffold (with AI completion only as an optional, user-triggered Verchestra delivery task per AD-012), and the out-of-process extension host that makes the contract language-neutral via the already-specified `verchestra-probe/1` wire protocol plus the declared-but-unconsumed `extensionRef`/`approvalRef` trust path. The 1.0 in-process seam is TypeScript-only. (5) **SAP ASE / Sybase loses "principal database qualification target" status** — it keeps contract-kit parity with every other engine; issue #16 and the site capability matrix are reworded accordingly. (6) Resolves **D2**: `PiDriver.probe()` stops returning the hardcoded `PI_VERSION` constant and reads the installed `@earendil-works/pi-agent-core` version for real, reporting `not configured` when absent (matrix.md M-4, WS-A).
- **Rationale:** Measured facts at `7caebb9` made the previous claim untenable: no live engine but SQLite runs anywhere (zero dependencies in `packages/data-probe`, no container tooling in the repository), and SAP ASE's "16.1 SP00 PL02" is a default string in a fixture connection — while ASE and Oracle have no freely licensable CI images, so the "principal target" sentence could never be proven, only contradicted by the T75 report. The edge model inverts the weakness into the product's own thesis: Verchestra's job is verified delivery, so the team's probe is delivered _by_ Verchestra's own flow — gates, review, commit — and re-verified continuously by the kit in the team's CI (written once, verified always). The seam is real but unpublished (every connection port is file-private; the package has no `exports`), and the kit pattern is already proven end-to-end by the real-SQLite path (`realConnection` through the identical supervisor bounds and assertions). Keeping the eight fixture adapters as the executable contract preserves exactly the artifact that makes "interface-guided" true. The out-of-process host stays post-1.0 deliberately: admitting workspace executables under product supervision is a new security surface that deserves its own qualification, not a rush inside T75/T76.
- **Consequences:** #16's requirements paragraph is rewritten (done 2026-08-09); the site capability matrix drops SAP ASE's first/bold placement and states the edge model; the T75 report claims contract + kit + SQLite and lists every other engine as contract-verified, never live-qualified; #233 must land before `t75-validation.md`; three post-1.0 issues track the scaffold, the host, and the single binary; the doctor's `.vestra/` vs `.verchestra/` root discrepancy found during this review is routed to #207.

### AD-018 — The sealed-holdout evaluator's isolation is an authority boundary, not a process boundary (#15, T74 F1)

- **Status:** active
- **Decision:** Decided by the repository owner on 2026-08-11, resolving finding **F1** of the independent T74 verification. Issue #15's isolation requirement is narrowed from _"separate evaluator identity, process, storage, and policy"_ to **separate identity and separate, provable authority**. The candidate is given a real invocable surface and every path it can reach is proven not to reach the oracle, the criteria, the evaluator's state, or the pre-seal report. A separate OS process and a separate storage engine are **not** claimed at 1.0.
- **Rationale:** The verifier's finding is precise and correct: `CandidateFacts` is an inert record inside the evaluator's own process, so a candidate _cannot attempt_ the forbidden access, and no fixture can discriminate a missing boundary. Identity separation is necessary and not sufficient. But the product's own definition of a read-only boundary is already **zero granted authority**, not a separate process — AD-011 rejected a name-based writer-tool classifier in favour of "exactly zero granted tools" precisely because a capability you cannot exercise is the only non-guessable definition, and `packages/data-probe`'s `sessionReadOnly` follows the same instinct: a fact asked of the session rather than inferred. A real out-of-process host is already scoped and deliberately deferred to post-1.0 (#235), so claiming one here would either duplicate that work or fake it. An authority boundary is falsifiable today; a process boundary is infrastructure this repository has already decided to build later.
- **Consequences:** `PROM-09` is added to `.specs/features/sealed-holdout/spec.md` and issue #15 is corrected: the acceptance bar becomes _the candidate holds a surface, exercises it against every protected asset, and is denied every time without relying on a caller-supplied fact_. The contamination fact (`PROM-05`) stays a supplied input and is explicitly **not** upgraded to an observed property by this decision — it remains the honest `PARTIAL` the T74 verification recorded. What 1.0 does not claim is stated in the T74 report rather than left implied: the evaluator and candidate share a process and a store, and cross-process isolation arrives with #235.

### AD-019 — Authorized automation preserves independent human accountability

- **Status:** active
- **Decision:** On 2026-08-22 the repository owner authorized automated
  contributors to manage issue updates, focused branches, commits, pull
  requests, review requests, CI observation, and rebase merges for the
  backlog-zero programme. Automation must satisfy the real GitHub ruleset and
  must never use an administrative bypass to replace human review, code-owner
  review, last-push approval, or resolved review threads.
- **Rationale:** The programme needs fast, repeatable operational execution,
  while qualification and release accountability remain human responsibilities.
- **Trade-off:** Automation can progress ordinary repository work without a
  confirmation at each GitHub step, but cannot access release secrets, publish
  with unconfigured trust, decide a failed review, or promote T77.
- **Scope:** All branches and pull requests in the backlog-zero programme;
  especially #58, #207, #294, #16, #17, #36, #18, #234, #235, and #236.
- **Date:** 2026-08-22

### AD-020 — T75 qualification evidence uses owner-custodied DSSE signing (#294)

- **Status:** active
- **Decision:** The T75 qualification evidence index is attested as a DSSE
  envelope carrying an in-toto `qualification-evidence-index` predicate. The
  signing key is an Ed25519 PKCS#8 value supplied only through a protected
  GitHub Actions secret. A committed public `PublicKeyRef` is the trust anchor;
  the workflow derives the public key from the secret and refuses signing unless
  every identity field matches the reviewed reference.
- **Rationale:** Qualification evidence needs a durable, independently
  verifiable release identity, while the private key must stay outside source,
  logs, artifacts, and contributor machines.
- **Consequences:** No generated test key is trusted for T75. Missing secret or
  public reference is a failed signing configuration, never an unsigned pass.
  The owner provisions the secret and public reference; automation implements
  and verifies the fail-closed path but does not create key material.

### AD-021 — Signed-evidence Execution Package ordering is version-gated locally (#58)

- **Status:** superseded by AD-029 for the V1 branch; the V2 contract, the
  unchanged `ArtifactSealer`, and the absent-version default remain active.
- **Decision:** Chosen by brunomjanuario on 2026-08-23 while resuming #58's
  T4i vertical; flagged here for human review, not asserted as an owner
  decision. `ArtifactSealer` remains unchanged. The Execution Package owns its
  array ordering before sealing: schema V2 uses UTF-16 code-unit comparison,
  while schema V1 keeps the qualified historical comparators and default-sort
  sites needed for byte-compatible verification. A caller that omits
  `schemaVersion` receives the new V2 contract; an explicit V1 remains V1.
- **Rationale:** RFC 8785 preserves array order, so the portability defect is
  in the package's own pre-seal array normalizers, not in the shared sealer.
  Keeping the version switch in `execution-package.ts` lets new packages be
  locale-independent without silently changing the identity of a stored V1
  package. The builder's absent-version default is explicit and tested; a
  malformed or explicit version is never silently rewritten.
- **Consequences:** `.specs/features/canonical-json-t4i-signed-evidence/`
  requirements CJ4I-01 through CJ4I-08. The focused suite proves hostile
  locale independence for V2, V1 byte compatibility, default V2 emission, and
  failed-closed invalid versions. Any other signed artifact type needs its own
  versioned migration rather than widening `ArtifactSealer` implicitly.

### AD-024 — Deep doctor's subsystem paths get one layout contract, provisioned as T75 fixtures (#207)

<!-- Renumbered from AD-019 on merge with upstream/main (2026-08-22): upstream
independently landed its own AD-019 ("Authorized automation preserves
independent human accountability", above) while this branch was in flight.
AD-024 through AD-028 below were originally numbered AD-019 through AD-023;
content is unchanged except for the renumbering and the AD-027 supersession
note. -->

- **Status:** active
- **Decision:** Chosen by brunomjanuario on 2026-08-22 while planning #207; flagged here for human review, not asserted as an owner decision. The seven subsystem observation paths are named by **one inward layout contract** in `packages/domain`, consumed by both `packages/workspace/src/init/safe-init.ts` and `apps/vestra-cli/src/doctor-composition.ts`, and **provisioned as T75 qualification fixtures** by a script the T75 workflow calls. `vestra init` is **not** extended to create them, and no user-facing configuration surface for subsystem locations is introduced at 1.0.
- **Rationale:** The `.vestra` → `.verchestra` root correction routed here by AD-017 fixed the root and left the same defect one level down: every one of the seven probed leaf paths is referenced nowhere in the repository except `apps/vestra-cli/src/doctor-composition.ts:127-136`. `safe-init.ts` writes six files, none of them; `artifact-placement.ts` reserves seven directories for project artifact classes, none of them; the only real runtime store is `runtime.sqlite` under a scenario root (`apps/vestra-cli/src/self-test-full-scenario.ts:343`). A live probe watching a path nothing creates is no better than a presence probe watching one. Extending `init` was rejected as the larger blast radius — it is a real filesystem writer with a guard refusing targets outside `.verchestra/`, and changing what every new workspace contains is a product change, not a diagnostics fix. Observing each subsystem at its real configured location was rejected because no configuration surface exists, which would grow #207 into designing one. Fixtures are the smallest change that makes the issue verifiable on the matrix where the fixtures are required to exist anyway.
- **Consequences:** `.specs/features/deep-doctor-live-probes/` requirements DDL-01 through DDL-03. A static guard (`tests/architecture/doctor-workspace-root.test.mjs`, extended by T4) fails when the doctor probes a path the contract does not own **or** when the contract names a path nothing provisions — making the drift class that produced this decision a gate rather than a convention. The configuration surface is deferred to T76+.

### AD-025 — The doctor's read-only property is proven transitively, not textually (#207)

- **Status:** active
- **Decision:** Chosen by brunomjanuario on 2026-08-22 while planning #207; flagged here for human review. Read-only observation surfaces are exposed as **narrow package subpaths** (`@verchestra/platform-node/readonly`, `@verchestra/policy/readonly`) and only those subpaths enter the doctor's import allowlist. `tests/architecture/doctor-readonly-graph.test.mjs` is upgraded from a textual scan of one file to a **transitive closure assertion**: resolve every module reachable from `apps/vestra-cli/src/doctor-composition.ts` and prove none of them names a writer.
- **Rationale:** The guard exists because T72's audit read AC1 as vacuously true and the remediation made it structural. Live probes must import `@verchestra/platform-node` and `@verchestra/policy`, whose barrels re-export genuine writers — `RuntimeStore` at `packages/platform-node/src/index.ts:9` among them. The existing regexes would not fire, so the guard would keep passing while the reachable graph quietly stopped being read-only: the guard would assert a property it no longer proves, which is the precise failure the guard was written to end. The cheaper option — keep the barrels and extend the symbol denylist — was rejected for that reason. The transitive upgrade is also the enabling mechanism for the driver, connector, and probe checks: it is what makes an availability-record read reviewable as _not_ having smuggled an adapter into the closure.
- **Consequences:** `.specs/features/deep-doctor-live-probes/` requirement DDL-12, tasks T8–T11. `@verchestra/drivers`, `@verchestra/connectors`, and `@verchestra/data-probe` stay on the forbidden list unchanged; the three checks that would need them read availability records instead. "Available" is defined as _the record exists, parses, and declares an installed subsystem_ — reachability is excluded by construction, because a reachability probe is neither read-only nor unpaid.

### AD-026 — T4j is a direct swap while release identity has no installed base (#58)

- **Status:** active
- **Decision:** Chosen by brunomjanuario on 2026-08-22 while planning the remainder of #58; flagged here for human review, following the same process as every prior T4 slice. `docs/canonical-json-compatibility.md`'s T4j row is reclassified from _"highest risk — publish a new bundle schema/release format and retain V1 verification"_ to a **direct swap**, gated by a first task that turns the reclassification's premise into an assertion. T4j is also moved **ahead of T4i**, inverting the matrix's risk ordering.
- **Rationale:** The matrix rated release identity highest-risk on the assumption of an installed base of signed release bytes a migration could invalidate. That base does not exist: `resolveReleaseIdentity()` returns `releaseDigest: null` (`apps/vestra-cli/src/release-manifest.ts:19`), T76 has not shipped a candidate, and the only consumers of the bundle digest are `transactional-activation.ts`, `tuf-update-client.ts`, and two fixtures under `tests/helpers/`. With no V1 bytes in the wild there is nothing to preserve, and T4j collapses to T4a's shape — a swap plus a fixture re-pin. The ordering inverts because the dominant constraint is not risk but a closing window: the moment T76 ships, the versioned facade becomes mandatory and permanent. The premise is a claim rather than an axiom, so it is not taken on faith — task T1 asserts `releaseDigest` is null and that no tracked fixture pins a V1 release-manifest digest, and the slice stops and re-plans as a facade if either fails.
- **Consequences:** `.specs/features/canonical-json-t4-completion/` requirements CJ5-01 through CJ5-03; Phase 1 must land before T76. T4i remains a genuine versioned facade and is expected to close at a **non-zero ceiling by design** — retaining V1 verification means retaining the V1 sort — so #58's "no digest input is ordered with default `localeCompare`" box closes as _no unintentional ordering remains_, with each residual named and justified (CJ5-12).
- **Confirmed fresh (2026-08-23), not merely carried forward:** `docs/canonical-json-compatibility.md` had, in the meantime, classified T4j as needing the full versioned facade ("T4i and T4j do not clear that bar"), contradicting this decision. Before implementing T4j, re-verified this decision's premise directly against current `main` rather than trusting either the old decision or the doc's newer classification: `resolveReleaseIdentity().releaseDigest` is still `null`, and a fresh search across every hermetic-bundle/transactional-activation test and fixture file found no pinned digest bytes anywhere. The premise holds; T4j shipped as a direct swap. See `.specs/features/canonical-json-t4j-release-identity/` and the "Completed vertical slice (T4j)" section of the compatibility doc.

### AD-027 — Versioned effect identity is split out of #58 (#58) — SUPERSEDED

- **Status:** active
- **Decision:** Chosen by brunomjanuario on 2026-08-22 while planning the remainder of #58; flagged here for human review. `packages/application/src/effects/effect-contract.ts`'s versioned-identity migration — deferred out of T4g and never rescheduled — is **removed from #58's scope** and filed as its own issue. #58 closes without it.
- **Rationale:** `buildIdempotencyKey` uses plain `JSON.stringify` on a fixed-order object literal. It has no ambient-locale dependency at all, its ambient-locale ceiling is already 0, and there is nothing for #58's actual contract — removing `localeCompare`-driven nondeterminism — to fix. Its real risk is a different concern: `EffectIntent` has no `expiresAt`, is durable until completed, is looked up by exact key string in a real SQLite table, and a key mismatch **does not fail closed** — it silently inserts a second intent for the same logical operation, defeating the at-most-once guarantee the mechanism exists for. Fixing that needs versioned identity material with V1 dual-read retained, which is a distinct design and review unit. Folding it into #58 would attach the chain's largest single design task to an issue whose contract it does not belong to.
- **Consequences:** A new issue tracks it, carrying forward the matrix's own prescribed fix ("add a versioned effect identity material and retain V1 key lookup for existing intents and receipts"). `.specs/features/canonical-json-t4-completion/spec.md` records it under Out of scope. The matrix's T4g classification section already documents the split and needs no rewrite.
- **Superseded (2026-08-22):** `feat(effects): version durable idempotency identities (#58)` landed on `main` while this branch was in flight — the versioned-identity migration this decision recommended splitting out was instead built inside #58 directly (`packages/application/src/effects/effect-contract.ts`: `EffectCanonicalizationVersion`, dual V1/V2 `buildIdempotencyKey`, `canonicalizationVersion` field). The decision's _reasoning_ about the risk (a key mismatch silently inserting a duplicate intent) was correct and is presumably what the landed migration addresses; only the _scoping recommendation_ (split to a separate issue) was overruled by whoever did the work. `docs/canonical-json-compatibility.md`'s own T4i label now refers to that landed effect-identity migration, not the signed-evidence-facade slice AD-026 describes as T4i in `.specs/features/canonical-json-t4-completion/` — that slice needs a new label when resumed, to avoid colliding with the merged doc.

### AD-028 — Deep doctor's secret-presence check stays on file-presence; live wiring is deferred, not built speculatively (#207)

- **Status:** active
- **Decision:** Chosen by brunomjanuario on 2026-08-22 while implementing #207's T15; flagged here for human review, not asserted as an owner decision. `doctor.secret-presence` keeps its current `existsSync`-based file-presence check. T15 (wiring the T10 `secretPresence` read-only surface into a real `SecretAdapter`) is deferred, not implemented, and is not part of this feature's completion.
- **Rationale:** `secretPresence` needs a real `SecretAdapter` to call `.has()` on. `QualifiedOsSecretAdapter` requires a real `OsSecretBackend` — Windows CNG, Apple Keychain, or Linux Secret Service — and none of the three has any implementation anywhere in the repository, confirmed by searching `packages` and `apps` for any construction of `QualifiedOsSecretAdapter` or a concrete `OsSecretBackend` outside `secret-broker.ts`'s own interface declaration; nothing in `apps/vestra-cli` constructs a real secret adapter today, for any purpose. This is native per-platform credential-store integration — three separate backends, each with its own qualification burden — categorically different from every other T12–T14 gap this feature closed, all of which reused an already-established product convention (`ProtectedPathBroker`, `RuntimeStore`'s migrations, the Ed25519 encoding already used for artifact sealing). Building an OS-keychain bridge here would mean inventing a new product capability with no other consumer to validate the design against, unilaterally, inside a task whose stated scope was one probe wire-up — precisely the risk T14's crypto question raised and the reason that one _was_ answerable: it applied an existing convention rather than inventing one. `MockSecretAdapter` was considered and rejected as a substitute: it starts empty on every real machine, so it would satisfy DDL-09's letter (a genuine `.has()` call happens) while defeating its purpose (a live observation) — the check could never report `pass` on a real machine, the exact failure mode the T12/T13/T14 fixture-content work existed to prevent.
- **Consequences:** `.specs/features/deep-doctor-live-probes/` — DDL-09's traceability is partial (T10's presence surface exists and is tested; T15's wiring does not). #207's acceptance is not fully met by this feature alone; the deferral is explicit rather than silently narrowing the issue's scope. T15 is the natural first task of a follow-up once a real `OsSecretBackend` exists for at least one platform — most naturally driven by whatever future work first needs live OS-secret access for a non-diagnostic purpose (secret binding at run time), since that is where the backend's real requirements get established, rather than deep-doctor guessing at them speculatively.
- **Superseded (2026-08-22):** T15 is no longer deferred. Reconciling this branch with an independently landed competing #207 implementation on `main` (`cf8913c`, `f901b0f`) surfaced a live `DoctorLiveProbeOptions.secret` port and `secretPresenceProbe` wiring built there. That wiring is adopted here, rerouted through this repository's own `@verchestra/platform-node/readonly` subpath's `secretPresence` helper (T10) instead of the competing branch's direct `@verchestra/platform-node` import, so the doctor composition root's read-only transitive-closure guard (AD-025) still holds. `doctor.secret-presence` now calls `secretPresence(live.secret.adapter, ...)` and reports `blocked` whenever no live secret port is configured (source mode, or any caller that leaves `options.live` unset) — the original deferral's concern (no `QualifiedOsSecretAdapter`/`OsSecretBackend` implementation exists) still applies to what a caller _can_ pass, not to whether the wiring itself is built.

### AD-029 — Execution Package schema V1 ordering is normalized, not preserved (#58, #320)

- **Status:** active; supersedes AD-021's V1 branch.
- **Decision:** Owner decision (accd, 2026-08-25). `compareIdentity` uses
  UTF-16 code-unit ordering for schema V1 as well as V2, removing the last
  ambient-locale ordering from a trust surface. This is a normalization that
  changes what a _rebuild_ of a V1 payload produces for identifier sets
  differing only by case. It is not a byte-preservation, and no artifact,
  document, or test may claim otherwise.
- **Rationale:** The claim that V1 historically used default `Array#sort` is
  false: every comparator-based sort in `execution-package.ts` has used
  `localeCompare` since the file's first commit (`867ce74`); the sites that
  did use a bare `.sort()` were already restored by `72bc9e1`. So the honest
  choice was between keeping ambient collation on a signed-evidence surface —
  which #58's acceptance criterion forbids outright — and normalizing V1 with
  the break stated plainly. Normalization is safe here because verification of
  a stored V1 artifact compares stored bytes against the stored digest and
  never re-sorts, because `derivePendingTasks`' tie-break is unreachable for
  valid packages (task sequences are unique), and because no V1 artifact
  exists outside the repository fixtures. A third schema version was rejected:
  it would preserve a rebuild path nothing exercises at the cost of a third
  ordering contract to carry through every later migration.
- **Consequences:** `docs/canonical-json-compatibility.md`'s migration rule 1
  (never silently change a persisted digest) gains one recorded exception,
  scoped to this owner and taken while the installed base is empty; every
  other owner still owes a versioned migration. The census and locale
  allowlist ceiling for `execution-package.ts` is 0. If a V1 artifact ever
  reaches a real installation before 1.0, this decision must be revisited
  rather than reinterpreted.

### AD-030 — The #58 migration wave normalizes ordering without version gates (#58)

- **Status:** active; extends AD-029's reasoning from one owner to the wave.
- **Decision:** Owner decision (accd, 2026-08-25). The remaining #58 verticals —
  memory, agent-runtime, connectors, effects, policy, drivers, extension host,
  application bootstrap and regression, the two platform-node stores, and the
  CLI Self-Test surfaces — move directly onto `canonicalizeJsonV2` and explicit
  code-unit ordering. No `schemaVersion` gate is introduced for any of them.
  Each batch states in `docs/canonical-json-compatibility.md` whether its bytes
  actually moved, measured against the repository fixtures rather than assumed.
- **Rationale:** A version gate earns its cost only when a stored artifact would
  otherwise be misread. Verchestra is `0.0.0-qualification` with no published
  installer, so no surface in this wave has an installed base; several of the
  affected types are typed `schemaVersion: 1` literals, which would make a gate
  dead code that still has to be carried through every later migration. Where a
  digest is re-derived from stored material the comparison stays self-consistent
  (the authority store re-derives from stored text; the vector index re-derives
  from stored row order), and where it is not, the effect is one self-healing
  regeneration (a first `profileChanged: true` after upgrade, a new ingestion
  generation), never a silent reinterpretation.
- **Consequences:** One genuine cross-version hazard is recorded rather than
  hidden: re-promoting a memory artifact published _before_ this wave, whose
  fragment identifiers differ only by case, produces different bytes and fails
  with `VES_MEMORY_PROMOTION_CONFLICT`. It fails closed. If any artifact from
  this wave ever reaches a real installation before 1.0, the affected owner
  needs a real versioned migration and this decision must be revisited rather
  than reinterpreted. Batches that measured byte-identical output (connectors,
  regression campaigns) say so explicitly, so the distinction between "did not
  move" and "moved and we accepted it" stays legible.

### AD-031 — A V1 verifier that re-sorts an array keeps its comparator (#58)

- **Status:** active; bounds AD-029 and AD-030 rather than extending them.
- **Decision:** Owner decision (accd, 2026-08-25). Run Capsule and Recovery
  Bundle each retain exactly one ambient-locale comparator, reachable only from
  their V1 verification path. Their V2 emission paths are code-unit throughout,
  and both types now default to `schemaVersion: 2`. Support Bundle retains none.
  `docs/canonical-json-compatibility.md` is amended to admit this case, and each
  retained site is pinned by an exact ceiling in the locale allowlist.
- **Rationale:** AD-029 normalized the Execution Package's V1 ordering on the
  argument that verification compares stored bytes to a stored digest and never
  re-sorts. Probing showed that argument is _specific to that owner_, not
  general: the Execution Package's re-sorted member is an object, whose keys JCS
  re-sorts anyway, so its pre-sort is inert. Run Capsule's `sourceStateRefs` and
  Recovery Bundle's `objects`/`recipients` are **arrays**, and RFC 8785
  preserves array order — so their verifiers recompute a signed digest _from_
  the re-sorted order. Measured, not assumed: a stored capsule verified under a
  divergent collation returns `VES_RUN_CAPSULE_BINDING_INVALID`, and Recovery
  Bundle's `open()` additionally takes `recipientIndex` from the re-sorted list
  and uses it to index the _stored_ `jwe.recipients`, so a comparator change
  mis-selects the decryption recipient. Normalizing would have stranded stored
  artifacts to make a census column read zero.
- **Consequences:** #58's criterion is met in its precise sense — no **V2**
  digest input is ordered by ambient collation — and the two exceptions are
  recorded rather than hidden. Support Bundle's sites were removed as a genuine
  bug fix: `plan()` sorted with `localeCompare` while `#assertPlan` already
  required code-unit order, so a plan built under a divergent collation was
  rejected by its own validator. The general lesson for any future migration:
  before reusing AD-029's reasoning, check whether the re-sorted member is an
  array or an object, because JCS treats those differently.

### AD-032 — The packaged Self-Test smoke profile is #36's portability demo (#36)

- **Status:** active
- **Decision:** Owner decision (accd, 2026-08-26). `npx verchestra self-test
  --profile smoke` is the clean-machine portability demonstration that issue
  #36 requires. It supersedes R13's original "replayable two-minute
  demonstration", which was repository-bound (`corepack pnpm install
  --frozen-lockfile` followed by `node --test
  tests/e2e/key-lifecycle-portability.test.mjs`, recorded in
  `docs/qualification/t68a-validation.md:61-83`). The demo's shape follows
  AD-016, which fixed the 1.0 entry point as an npx launcher over hermetic TUF
  activation, and the npm-name decision recorded in
  `.specs/features/npx-launcher/spec.md:129-137` (`verchestra` is the package,
  `vestra` the short bin alias).
- **Rationale:** R13 was written when the only runnable surface was a clean
  clone, so the only honest demonstration it could name was a repository test.
  That premise no longer holds: `verchestra@0.0.0-qualification` is published
  on the public npm registry and resolves a live signed release, so the
  composed product can now demonstrate its own portability without a checkout.
  The Self-Test smoke profile is the successor rather than a new artifact: it
  is a packaged profile of the qualified Self-Test trust domain (AD-010), it
  runs inside a disposable, isolated enclave, and it emits a sealed verdict —
  which is exactly what a portability claim needs and what a repository-bound
  `node --test` invocation cannot supply from a machine that has no
  repository. Keeping the repo-bound transcript as #36's demo would have meant
  closing a distribution issue on evidence that requires the thing
  distribution exists to remove.
- **Consequences:** #36's acceptance closes on per-platform clean-machine
  evidence for help, version, this demo, recovery, and cleanup, recorded in
  `.specs/features/npx-launcher/` (T4, NPX-01/NPX-09/NPX-10). The root
  `AGENTS.md` mission line stops forbidding a public-installer claim, because
  the package is genuinely published; production readiness and 1.0 remain
  unclaimed. `docs/qualification/t68a-validation.md` is untouched — it is a
  dated report and its transcript stays true of the revision it names. One
  limitation is stated rather than smoothed over: `self-test` refuses when the
  working directory is an ancestor of the OS temporary directory, which on
  Windows includes the default home directory
  ([#370](https://github.com/accd/verchestra/issues/370)); the demo is
  documented as run from a project directory until the fix is republished.
  AD-003's public-status language is narrowed only for repository-canonical
  surfaces and the documentation portal; the homepage's typed `installable`
  flag (`apps/site/src/data/product.ts`) and the copy driven by it stay as the
  owner left them and are not reinterpreted by this decision.

### AD-033 — The signed decision body is the §4.1 canonical projection (#18)

- **Status:** proposed (owner ratifies by reviewing the pull request that
  carries the signature-verifying validator).
- **Decision:** The bytes a release decision's `signature` covers are the RFC
  8785 canonical JSON of `{ claims, bodyDigest }`, where `claims` is the decision
  frontmatter with the `signature` field removed and `bodyDigest` is
  `sha256:<hex>` over the Markdown body — the definition proposed in
  `.specs/features/release-decision/prepared-decision.md §4.1` and executed by its
  §4.3 signing procedure. The decision validator (`scripts/agent-readiness.mjs`)
  now recomputes those bytes and verifies the Ed25519 signature against the key
  resolved from `publicKeyRef`, replacing the previous presence-only check and
  closing the security reviewer's remaining must-fix (#18, "the signature is
  checked for presence, not verified").
- **Consequence:** A decision on disk is verified, not merely present — a wrong
  key, a tampered claim, an edited body, or an unresolvable reference all fail
  closed (`tests/agent-readiness/release-decision.test.mjs`). Which bytes are
  signed is still the owner's call; this records the definition the validator
  enforces so a promote's signature is accountable rather than decorative.

### AD-034 — Readable provider credentials get their own qualified contract; key material keeps non-exportable (#379)

- **Status:** proposed (the owner ratifies by reviewing the pull request that
  carries `feat/os-secret-backend`).
- **Decision:** Two qualified OS-store contracts, not one relaxed contract.
  `OS_SECRET_CONTROLS` (key material: signing and recipient keys) is
  unchanged and still requires `non-exportable` on darwin and win32. A new
  `OS_CREDENTIAL_CONTROLS` governs **readable provider credentials** — API keys
  a governed task injects into a child process. Its vocabulary claims only what
  is true: `keychain`, `user-scope`, `workspace-namespace`, `not-in-argv`,
  `presence-without-value`. `QualifiedOsCredentialAdapter` enforces it, and
  only darwin has a contract (`docs/qualification/os-secret-backend-darwin.md`,
  bound by digest). The backend is `/usr/bin/security`, with a write path that
  passes the hex-encoded value over stdin to `security -i`.
- **Rationale:** An API key must be readable, so claiming `non-exportable` for
  it would be false. Admitting such a store under the key-material contract
  would quietly weaken the guarantee every key-material caller relies on. A
  separate contract keeps both honest, and a test proves that credential
  evidence cannot qualify the key-material adapter. `access-control` is not
  claimed either: an item created with `-T /usr/bin/security` is readable,
  without a prompt, by any same-user process that runs that tool.
- **Keychain selection:** an explicit per-invocation `--keychain <path>` option
  on `secret set|status|delete` and `doctor`, not an environment variable. The
  README records that the launcher "deliberately reads no environment
  variable" so ambient state cannot redirect a trust input. A credential source
  is a trust input: #405 injects whatever it returns into a provider child. A
  flag is visible on the command line and in the output (`keychain:
  explicit`), and the path is proven to be a user-owned keychain file before
  every operation. The real-keychain qualification suite (`pnpm qualify:keychain`)
  uses the same flag with a disposable keychain. Gate tests inject a fake
  runner in process and never spawn `security`. No hidden test seam exists.
- **Measured constraints adopted as invariants:** `add-generic-password`
  silently falls back to the login keychain for an unusable path; `security -i`
  splits lines over 4095 bytes and echoes the tail; `-w` output is ambiguous
  hex; `-U` combined with `-T` raises an access-list approval dialog. Hence:
  a file check before every operation, a value budget derived from the line
  limit (`MAX_CREDENTIAL_VALUE_BYTES`), reads with `-g`, and rotation as delete
  then add (non-atomic, reported as `VES_SECRET_ROTATION_INCOMPLETE`). Every
  spawn is bounded, and a timeout is `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`.
- **Consequences:** `.specs/features/os-secret-backend/`. Deep doctor observes
  `anthropic-api-key` through a presence-only closure, so a bound credential on
  macOS removes L2's remaining blocker there. Linux (Secret Service) and Windows
  stay unqualified and report `not configured` until each has its own
  qualification report (since done: AD-041). The maximum value is 1416 bytes, not 8 KiB, because the
  line limit dictates it.

### AD-035 — The `init` probe scaffold carries a checked copy of the contract and a port-level kit (#234)

- **Status:** proposed (the owner ratifies by reviewing the pull request that
  carries `feat/234-init-probe-scaffold`). It changes no 1.0 claim and leaves
  the recorded 1.0.0 hold untouched.
- **Decision:** `vestra init --probe-engine <engine>` emits five files through
  the existing `SafeInitService` preview/apply: `contract.mts` (a copy of the
  engine's published port and supporting types), `connection.mts` (a class whose
  methods throw `VES_PROBE_DRIVER_TODO`), `conformance-kit.mts` (a port-level
  kit), `conformance.test.mts` (a `node --test` wiring), and `README.md`. The
  generator is `packages/workspace/src/init/probe-scaffold.ts`, keyed by engine
  and `PROBE_CONTRACT_VERSION` 1, with no clock, no product version, and no
  dependency. The directory is confined to lowercase paths under
  `.verchestra/probes/`. Files are `.mts` so they are ES modules whatever the
  team's `package.json` `type` is.
- **Rationale:** AD-017 has the team run the kit in its own CI, but the
  published kit (`tests/helpers/*-probe-fixture.mjs`) imports this repository's
  sources and `@verchestra/data-probe` is private, so generated wiring that
  imports either would neither typecheck nor run in a team repository. A copy is
  only safe when it cannot drift silently: a type-identity test fails when any
  copied type differs from the published one, and a fidelity test requires the
  scaffold kit to make the same session calls and reach the same verdicts as
  the published adapter. `SafeInitService` writes only under `.verchestra/`, and
  widening that writer authority is a separate decision, so `--probe-dir` stays
  inside it rather than reaching into the team's source tree. The generator
  lives in `packages/workspace`, which the CLI already depends on, so no package
  edge or lockfile change is needed; the CLI manifest spells the option values
  as literals because the doctor's read-only closure reaches that module.
- **Consequences:** `.specs/features/init-probe-scaffold/`. Re-running `init`
  never overwrites a filled-in scaffold (`VES_INIT_TARGET_CONFLICT`); an
  upgrade path for a contract version bump is future work. Once the kit is
  distributed as a package, or the out-of-process host (#235) lands, the copy
  can be replaced by an import. AI completion stays a user-triggered delivery
  task through `vestra task` (#405) and is not built here.

### AD-036 — A superseded, retained release re-activates locally; a remote downgrade still fails (#393)

- **Status:** proposed (owner ratifies by reviewing the pull request that
  carries it).
- **Decision:** The launcher closure re-activates the pinned release without a
  TUF refresh and without any source read only when all of the following hold:
  the machine's trust anchor for the pinned root exists and equals the pinned
  root digest; a verified-release record under that same root names exactly one
  installed release with the pinned `releaseId` and `semanticVersion`; and a
  later TUF-verified activation under that root has superseded it. It then calls
  `TransactionalActivationManager.rollback(digest, { trustRootDigest })`, which
  re-verifies the installed manifest and every component byte, checks the host
  target and the recorded identity, runs the health gate, and switches the
  pointer under a `rollback` journal. Any failure is fail closed. Every other
  case keeps the unchanged `resolveAndStage` path. Records are written only by a
  TUF-verified `activate` that is given the trust-root digest, never by
  `rollback`. This is option 2 of #393; option 1, a source-side roll-forward
  publication that points at the old bytes, is documented as the way to serve an
  older release to every client.
- **Rationale:** Anti-rollback correctly rejects older metadata, so re-invoking
  an older release after an update can never be a metadata operation. The
  release's bytes were already verified under the same authority and are still
  on disk; re-hashing them proves what TUF proved without asking the network a
  question whose honest answer is "that is a downgrade". Restricting the path to
  a *superseded* release keeps the steady state on the network path, so metadata
  expiry and publisher revocation stay observed for the current release. Keying
  the records by trust-root digest keeps a release verified under one root from
  ever running under another. Threat model and pre-mortem:
  `.specs/features/retained-release-rollback/design.md`.
- **Consequences:** The local path observes neither revocation nor metadata
  expiry for a superseded release (residual risks R1, R2); deleting the state
  root or a purging uninstall removes every retained release and record. The
  published `0.0.0-qualification` and `.2` packages do not carry this code, so a
  live rollback demonstration needs two same-root publications built from a
  revision that does. No live run is claimed by this decision.

### AD-037 — Workspace probe workers run out of process under `process-contained` supervision (#235)

- **Status:** proposed (the owner ratifies by reviewing the pull request that
  carries `.specs/features/out-of-process-probe-host/`).
- **Decision:** `verchestra-probe/1` goes on the execution path:
  `FramedProbeWorker` (extension-host) drives a worker spawned by
  `SpawnedProbeWorker` (platform-node) through the bounded codec, a strict
  sequence guard, payload digests, and Workspace binding, under the unchanged
  supervisor bounds. A workspace worker is admitted only from a signed lock's
  `extensionRef` + `approvalRef` (`GovernedSkillRegistry.resolveExecutableExtension`)
  plus a controller grant accepted by `authorizeSkillExecution`; admission is
  denied by default. The host is `process-contained`, POSIX-only, and refuses
  `high-untrusted-executable` work. Full record: `.specs/features/out-of-process-probe-host/adr.md`.
- **Consequence:** Protocol-level containment is qualified
  (`docs/qualification/out-of-process-probe-host.md`); OS-level containment is
  not, so an admitted worker keeps the host user's filesystem and network
  authority until a stronger isolation grade is qualified. Post-1.0; the signed
  1.0.0 hold is unchanged.

### AD-038 — The single binary is a Node 24.14.0 SEA injected by a repository-owned injector (#236)

- **Status:** proposed. The owner ratifies it by reviewing the pull request
  that carries `.specs/features/single-binary-distribution/`.
- **Decision:** The owner decided on 2026-09-29 to implement #236, the
  per-target single binary that AD-016 deferred, now. The signed 1.0.0 hold
  and the npx entry point stay unchanged. Each binary is the official
  Node 24.14.0 executable for its target, verified against digests recorded
  from nodejs.org `SHASUMS256.txt`
  (`apps/vestra-launcher/single-binary/node-runtime.json`). Into it goes a SEA
  blob generated by that runtime's own `--experimental-sea-config`, carrying
  the npm launcher's bootstrap and the reviewed pinned inputs. Node 24.14.0 has
  no `--build-sea`, and `postject` is an npm dependency the repository does not
  carry. The blob is therefore injected by `scripts/sea-inject.mjs`, which
  implements only the lookups the pinned runtime compiles in:
  - a Mach-O `NODE_SEA` segment;
  - an ELF `NODE_SEA_BLOB` note in a mapped `PT_NOTE`;
  - a PE `RT_RCDATA` resource;

  plus the sentinel fuse. It verifies every artifact by recovering the blob
  the way the runtime does.
- **Rationale:** The alternatives each widen the release path. `postject`
  would add a dependency carrying a LIEF WebAssembly build. A newer Node's
  `--build-sea` would add a second, unqualified toolchain for a blob whose
  format belongs to the runtime that reads it. A self-extracting wrapper would
  write an unverified runtime at run time. The injector is small, has no
  dependencies, fails closed on any layout it cannot explain, and is proven on
  synthetic executables in every branch and on the real host binary.
- **Consequences:**
  - A lone `--version` is answered from the embedded inputs, so an air-gapped
    binary can identify itself. Every other argument vector passes through
    verbatim. Whether that difference between channels stays is an open owner
    decision.
  - macOS binaries carry a reproducible ad-hoc signature. Windows binaries
    carry none.
  - Developer ID signing with the hardened runtime and V8's JIT entitlements,
    notarization, Authenticode signing, and per-artifact signed attestations
    are owner actions.
  - The channel is its own qualification surface.
    `docs/qualification/single-binary-distribution.md` records it as proven on
    the darwin-arm64 build host and pending on the other four targets
    (`.github/workflows/single-binary-build.yml`).
  - It changes no T76, T77, or 1.0.0 status.

### AD-041 — Linux and Windows credentials qualify on the same readable-credential contract, each with its own evidence (#379)

- **Status:** proposed. The owner ratifies it by reviewing the pull request
  that carries `feat/379-linux-windows-credential-stores`
  (`.specs/features/os-secret-backend-cross-platform/`).
- **Decision:** `OS_CREDENTIAL_CONTROLS` (AD-034) gains a `linux` and a `win32`
  contract, each qualified by its own digest-bound report. The key-material
  contract is unchanged, and no credential evidence satisfies it.
  - **Linux:** `secret-service-credential`, controls `secret-service`,
    `user-scope`, `workspace-namespace`, `not-in-argv`, and
    `presence-without-value`. The backend writes with
    `/usr/bin/secret-tool store` (value on stdin) and reads with
    `secret-tool lookup` (value on captured stdout). Presence is the Secret
    Service's own `SearchItems` method through `/usr/bin/dbus-send`, which
    returns item paths and never a secret.
  - **Windows:** `windows-credential-manager`, controls `credential-manager`,
    `dpapi-at-rest`, `user-scope`, `workspace-namespace`, `not-in-argv`, and
    `presence-without-value`. The backend runs
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -`
    with a program on stdin. The program compiles an inline P/Invoke of
    advapi32 `CredReadW`, `CredWriteW`, and `CredDeleteW`, for a
    `CRED_TYPE_GENERIC` credential with target `verchestra/<ws>/<name>` and
    `CRED_PERSIST_LOCAL_MACHINE` persistence. `ENTERPRISE` would roam the key
    to other machines; `SESSION` would lose it at logoff. Presence is
    `%SystemRoot%\System32\cmdkey.exe /list:<target>`, which prints the
    target's attributes and never its value.
  - **Both:** the store is selected by platform in `createOsCredentialStore`,
    and `--keychain` is refused there. A store that is not running in the
    session is a new `VES_SECRET_STORE_UNAVAILABLE`, which deep doctor reads
    as `blocked` (not configured), never `pass`. The injectable runner
    carries an optional `tool` name so the Linux backend can run its two fixed
    programs.
- **Measured constraints adopted as invariants** (hosted `ubuntu-latest` and
  `windows-latest` runners, recorded in the two reports):
  - `secret-tool search` prints the secret, so presence cannot use it.
  - With no prompter in the session, `secret-tool lookup` of a locked item
    misses silently, exactly like a missing item. A read miss is therefore
    confirmed by `SearchItems`, and a locked-only match is
    `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`.
  - `secret-tool clear` of nothing exits 1 silently, so delete decides from
    presence.
  - Under `-Command -`, Windows PowerShell reads stdin ahead of the program,
    so `[Console]::In.ReadLine()` gets nothing. The value therefore travels as
    the base64 literal of one program line. A read or write first checks the
    Script Block Logging and transcription policies, and stops with a new
    `VES_SECRET_STORE_LOGGED` if either is enforced.
  - The `Add-Type` cmdlet took 23 to 33 s in the allowlisted child environment,
    because command discovery ran against a cold module-analysis cache. The
    program therefore calls `CSharpCodeProvider` directly and uses no cmdlet.
  - A cold PowerShell start that compiles the P/Invoke took over 4 s, beyond
    the presence budget inside deep doctor's 5 s probe (run 36682126079 failed
    on it). Presence therefore runs `cmdkey`, which answered in 21 ms.
  - Credential Manager never prompts, so a Windows timeout is a retryable
    `VES_SECRET_BACKEND_FAILURE`, not an interaction-required error.
- **Rationale:** Each platform claims only what its store guarantees. The
  value never enters argv or the environment on any platform. Presence never
  returns the value on any platform. On Linux it is the Secret Service's
  attribute-only search. On Windows it is `cmdkey`'s attribute listing, which
  is the operating system's own program.
- **Evidence:** `pnpm qualify:keychain` (`spikes/os-secret-store`) runs in
  `.github/workflows/os-credential-store.yml` on `ubuntu-latest`,
  `windows-latest`, and `macos-latest`. On Linux it uses a disposable
  `dbus-daemon` and gnome-keyring with a temporary HOME. On Windows it uses
  random target prefixes, deleted in `finally`. On macOS it uses a disposable
  keychain. Green on all three in run 36682622312 (revision `a885a2b`). Gate
  suites use fake runners only, and the spawn guard now refuses
  `secret-tool`, `dbus-send`, PowerShell, and `cmdkey` as well as `security`.
- **Consequences:** #379's store exists on every supported platform, and L2's
  secret-presence blocker is gone wherever `anthropic-api-key` is bound. The
  reported limits:
  - same-user processes can read any of these stores;
  - AMSI sees the Windows program lines;
  - the logging-policy guard's effect is designed, not observed under an
    enforced policy;
  - Windows presence depends on `cmdkey`'s output shape (a `<label>: <target>`
    line, with the label possibly localized);
  - a cold Windows read or write can take several seconds, within its 30 s or
    15 s budget;
  - Linux needs `/usr/bin/secret-tool` and `/usr/bin/dbus-send`.

### AD-039 — Claude Code implements through a mediated MCP tool bridge over an authenticated Unix socket (#405)

- **Status:** proposed (owner decision that Claude Code is the implementer and
  Codex the verifier is recorded in #405; the channel design is ratified by
  reviewing the pull request that carries it).
- **Context:** The T03 Claude Code profile disables every built-in tool and
  loads no MCP server, so it cannot change files. Enabling Claude Code's own
  Edit/Write tools would let the model write without the executor's scope,
  protected-path, capability-grant, and tool-effect authority checks. Claude
  Code launches MCP servers itself as stdio children, so Verchestra cannot hand
  the bridge an inherited file descriptor.
- **Decision:** Claude Code runs with `--tools ""` and a strict MCP
  configuration naming one server, `verchestra`, whose process is a thin relay
  (`packages/agent-runtime/src/execution/mcp-tool-bridge.ts`). The relay speaks
  MCP JSON-RPC 2.0 on stdio and forwards `tools/call` to the controller over a
  Unix domain socket created in a fresh per-run `0700` directory. The relay
  must first present a 256-bit random token (from its MCP-config environment,
  written `0600` inside the per-run `0700` Claude config directory, never in
  argv); the controller compares it in constant time, accepts exactly one
  authenticated connection, and serves nothing before authentication. All
  authority stays in the controller: read tools are confined to the worktree
  and the approved read scope; `write_file`/`delete_file` become
  `control.invokeTool` requests whose content travels as a
  `payload:sha256:<hex>` reference, so the executor re-checks scope, protected
  paths, capability grant, and tool-effect authority before
  `ExecutionToolPort` writes.
- **Alternatives rejected:** Claude Code built-in tools with permission rules
  (the executor would not see the effect before it happens); loopback TCP with a
  token (reachable by every local user, port races); an inherited descriptor
  (not offered by Claude Code's MCP launcher); putting authority in the relay
  (it runs in the model's process tree).
- **Consequence:** The T03 profile is requalified as a new `mediated-mcp`
  profile (`docs/qualification/claude-code-driver-mediated.md`); the original
  profile and its report are unchanged. Only macOS/Linux sockets are in scope;
  Windows reports not configured. Same-user processes remain out of the threat
  model (see `.specs/features/governed-task-cli/threat-model.md`).

### AD-040 — The governed `vestra task` composition: local human confirmation, one Workspace evidence key, forbid-only Workspace authority, and checked verifier claims (#405)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `feat/405-governed-task-cli`). Owner decisions from #405 bind it: Claude Code
  implements through the mediated bridge, Codex verifies independently,
  provider credentials live in the macOS keychain, and nothing merges
  automatically.
- **Decision:**
  1. **Human decisions are typed back.** `approve` and `review` record a
     decision only after the exact binding or surface digest is typed at an
     interactive terminal. The only other path is the explicit, non-default
     `--confirm-stdin` flag with the digest on standard input, for scripted
     tests and automation that must spell the digest out. This is local human
     authority, not a cryptographic proof of identity.
  2. **One Workspace evidence key.** The Execution Package, the approval, the
     context manifest, and the run capsule are signed by one Ed25519 key held
     by the existing `EncryptedFileKeyProvider` under the Workspace state root.
     Its passphrase is the brokered credential `evidence-signing-passphrase`;
     its public key is pinned on first use so verification needs no secret.
  3. **Authority is a task Cedar view.** A built-in layer permits
     `task-start`, `tool-effect` (with the capability grant), `gate-commit`,
     and `human-review` only for an approved run. A Workspace may add
     forbid-only policies in `.verchestra/policy/task-authority.json`; the
     view's digest is bound into the approval, so changing it after approval
     makes the approval stale. The Cedar glue lives in the CLI composition
     root; Cedar loads from the release's `native/cedar-wasm.wasm` through the
     package's `web` glue.
  4. **Verifier claims are checked, not trusted.** Codex answers per
     requirement with a cited assertion and the implementation file; the
     coordinator accepts a requirement only when the cited lines exist at the
     task commit and reverting the named file makes the covering gates fail in
     a scratch worktree, with the user's checkout unchanged.
  5. **Gates run only allowlisted executables** named by `commandRef` in a
     machine-local `task-gates.json` under the Workspace state root.
- **Alternatives rejected:** a TTY-only approval (no deterministic test path
  without a hook in product code); an environment variable to skip
  confirmation (ambient state could approve by accident); a separate key per
  artifact kind (more secrets for no added separation on one machine); letting
  a Workspace permit (would let local configuration widen authority);
  accepting the verifier's verdict as-is (a model's PASS would be the only
  evidence).
- **Consequence:** `.specs/features/governed-task-cli/` (GTC-24..41),
  `docs/quick-start.md`. Limits recorded there: macOS only, one implementer and
  one verifier, token and cost ceilings checked when usage is reported, local
  human authority, live pilot pending (#406).

### AD-042 — The publication ledger module derives the release entry; the publisher writes it, a human appends it (ADP-7)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/publication-ledger-derives-release-entry`).
- **Decision:**
  1. **One admission.** `admitRelease` in `scripts/tuf-publication-ledger.mjs`
     refuses a `metadataVersion` that does not strictly exceed every version
     recorded for the root, as `assertMonotonicMetadataVersion` did, and returns
     the entry that records the release. The chain fields, the kind, and the
     split of the base URL into origin and `urlPrefix` are derived there. The
     publisher calls it once, before any output and before any signature other
     than the in-memory root.
  2. **The publisher writes, a human appends.** `scripts/t76-publish-release.mjs`
     writes `ledger-entry.json` beside `publication-manifest.json`, takes
     `--run-id`, and cites the fixed `RELEASE_EVIDENCE`. The workflow passes the
     runner's `GITHUB_RUN_ID` and uploads the file. Nothing edits the committed
     ledger: the entry is appended verbatim in a reviewed pull request.
  3. **A release the ledger cannot record is not signed.** A base URL that does
     not split back to itself, or whose prefix the ledger's entry rules refuse,
     now fails with `VES_T76_PUBLISH_LEDGER_INVALID` before any output. The
     release workflow's own `base_url` pattern already admits only recordable
     URLs.
  4. **The closure's identity is read before the admission**, because the entry
     names the release. The ledger check therefore runs after the target index
     is validated and still before `assertOutputAbsent`, the output directory,
     and every timestamp, snapshot, and targets signature.
- **Proof it changes no recorded fact:** deriving from the recorded inputs of
  `.3` and `.4`, each over the ledger prefix that preceded it, reproduces the
  committed entries 3 and 4 byte for byte
  (`tests/agent-readiness/tuf-publication-ledger.test.mjs`). The committed
  ledger is unchanged.
- **Alternatives rejected:** keeping the hand-built entry (the `.3` and `.4`
  entries needed `sequence` and `previousEntryDigest` typed by a human);
  letting the workflow commit the entry (it would need `contents: write` in the
  signing job and would remove the reviewed pull request); taking the evidence
  paths on the command line (the refresh cites a fixed list too, and a path
  typed at dispatch is one more untrusted input in the signing job).
- **Consequence:** `.specs/features/architecture-deepening/validation-c7.md`,
  `.specs/features/tuf-role-separation/republish-v3-runbook.md` (step 7),
  `docs/release-custody.md` (3.1). A release whose record lives outside
  `RELEASE_EVIDENCE` needs that list changed in a reviewed pull request first.

### AD-043 — The task worktree module owns the handle, the task branch name, and the commit trailers; the handle is opaque at the port (ADP-1)

- **Status:** proposed (ratified by reviewing the pull requests that carry
  `refactor/task-worktree-module`).
- **Context:** The worktree handle `worktree:<id>:<base>` was encoded in one
  adapter, matched by a regular expression copied into two, and taken apart or
  rebuilt by hand in three places in the CLI composition. The task branch name
  was defined three times and the commit trailers were written in one file and
  parsed in two others. Each copy could drift on its own, and one already had:
  a handle sliced by a fixed 40 digits is wrong for a SHA-256 repository.
- **Decision:**
  1. `packages/platform-node/src/task-worktree.ts` is the one module that
     defines the handle encoding and its parser, the task branch ref and its
     short name, the commit message writer and the trailer parser, the ref
     lookup, the worktree registration reader, and the one git runner of the
     task path. The worktree adapter, the gate and commit adapters, and the Git
     context source consume it.
  2. The handle stays an opaque string at `ExecutionWorktreePort`. The port
     keeps `create`, `inspect`, and `cleanup` and gains no parsing duty: test
     doubles and other adapters may use any handle text, and only the Node
     worktree module reads its own encoding. The handle ID derivation and the
     trailer bytes are unchanged, because a resumed run re-derives the ID,
     tool-receipt idempotency keys include the handle, and a reconciled commit
     is compared against the whole message.
  3. The handle is opaque to the CLI composition as well. What the CLI did by
     taking the handle apart is now an operation of `NodeGitWorktreeAdapter`,
     off the port like `resolvePath`: `cleanupHandle` (cleanup from the handle
     alone), `cleanupAtCommit` (cleanup of the worktree whose registered HEAD
     is a given commit, compared against the canonical worktrees root), and
     `scratchWorktreeHandle` (a handle for a scratch checkout verification
     registered itself). The CLI's git calls go through the module's runner.
  4. **SHA-256 repositories are supported, not refused.** Every object ID
     check on the task path admits a complete SHA-1 (40 hex) or SHA-256 (64
     hex) name. The two sites that admitted 40 only (the CLI commit record and
     the verification input and human-review checks in
     `packages/application/src/verification/verification.ts`) now use the same
     pattern as the adapters. No signed evidence format restricts an object ID
     to 40 digits: `schemas/task-request/1.schema.json` already admits both,
     the Execution Package carries no object ID (its `expectedCommit` is the
     commit boundary text), and the Run Capsule and the verification report
     carry the commit ID inside an artifact reference and a digested record.
     A SHA-256 journey is sealed into a Run Capsule end to end in
     `tests/e2e/task-cli-e2e.test.mjs`. A plan-time refusal was therefore not
     needed, and no public error code was added.
  5. **Idle cancel no longer hides a failed cleanup** (owner-approved
     behaviour change). `vestra task cancel` of a run no process is driving
     ignores only `VES_GIT_WORKTREE_NOT_FOUND`. Any other refusal stops the
     cancel before the lease is released or the abort is recorded and surfaces
     as `VES_TASK_FAILED` with the adapter's code as its reason. `cleanup`
     reports a worktree Git still lists but whose directory was deleted as
     `VES_GIT_WORKTREE_NOT_FOUND` instead of a bare `ENOENT`, so that case
     still cancels.
  6. **Git never inherits the process environment.** The module's runner is
     the only place the task path starts git (an architecture test enforces
     it), and it passes the scrubbed environment the gate runner already used
     (`safeEnvironment`, now in
     `packages/platform-node/src/safe-environment.ts`) plus five variables git
     legitimately needs: `XDG_CONFIG_HOME`, which locates the user's own
     configuration when it is not under `HOME`, and the author and committer
     name and email variables, which name the commit identity when it is given
     by environment. A `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
     `GIT_CONFIG_*`, or `GIT_EXEC_PATH` in the parent environment no longer
     reaches a worktree operation.
- **Alternatives rejected:** a typed handle object at the port (every test
  double and the durable checkpoints carry the handle as text, so the port
  would have to parse it and the encoding would leak inward into
  `packages/application`); keeping the regular expression in a shared constant
  only (the slicing and rebuilding sites would remain); refusing a SHA-256
  repository at `task plan` (justified only if signed evidence could not carry
  a 64-digit ID, which it can); recording the abort and releasing the lease
  even when the idle cleanup is refused (the cancel would again report an end
  state while the worktree remains, only with an error beside it); a
  deny-list of `GIT_*` variables (git adds redirecting variables over time,
  so only an allow-list fails closed); pinning the commit identity to a
  Verchestra identity (the commit is the user's, and the trailers already
  bind it to the run).
- **Consequence:** `tests/architecture/task-worktree-locality.test.mjs` fails
  when another source under `packages/` or `apps/` spells out the handle
  encoding, the task branch name, or a trailer. An idle cancel that meets a
  worktree it must not remove now needs the worktree reconciled by hand before
  the cancel succeeds; until then the run keeps its writer lease, as it did
  before the cancel was tried. Evidence is in
  `.specs/features/architecture-deepening/validation-c1.md`.

### AD-044 — Providers authenticate by subscription by default; the Claude Code subscription profile replaces `--bare` with named controls (ADP-A)

- **Status:** proposed. The owner ratifies it by reviewing the pull request
  that carries `feat/subscription-provider-auth`
  (`.specs/features/subscription-provider-auth/`). The owner decided that the
  task path must work with Claude and Codex subscriptions; the three gaps
  below are open owner decisions.
- **Context:** The `mediated-mcp` profile (AD-039) passes `--bare`, and bare
  mode reads only `ANTHROPIC_API_KEY`. `claude --help` (2.1.282): "Anthropic
  auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and
  keychain are never read)". An owner on subscriptions could not run a task.
- **Decision:**
  1. **A second qualified profile, `mediated-mcp-subscription`.** It is the
     mediated invocation without `--bare`. Its only credential is the
     long-lived token from `claude setup-token`, in `CLAUDE_CODE_OAUTH_TOKEN`.
     What `--bare` gave is rebuilt from named controls: `--setting-sources ""`,
     `--settings` with `disableAllHooks` and `autoMemoryEnabled: false`,
     `--strict-mcp-config`, `--disable-slash-commands`, `--tools ""`, seven
     environment switches, a per-run `HOME` and `CLAUDE_CONFIG_DIR`, and an
     empty per-run working directory in place of the worktree. The profile
     adds three fail-closed checks the bare profile does not need: no MCP
     server but the bridge, no hook event in the stream
     (`--include-hook-events`), and no machine-wide managed policy location.
     The `mediated-mcp` and T03 profiles are unchanged.
  2. **A Codex identity directory per Workspace.** `codex-identity` under the
     machine-local state root is the verifier's `CODEX_HOME`. `vestra` pins its
     `config.toml` to the file credential store and ChatGPT login, accepts only
     `Logged in using ChatGPT` from `codex login status`, and prints the one
     command the owner runs once. The Codex credential never enters the OS
     credential store and `vestra` never reads it.
  3. **The mode is machine-local.** `task-providers.json` beside
     `task-gates.json` selects `subscription` or `api-key` per provider.
     Without it both are `subscription`. The Task Request cannot select it.
  4. **Unbilled usage has no cost.** The budget meter counts tokens and
     duration for a model on a subscription and adds no cost; status and the
     Run Capsule say not billed (subscription). The priced path, and
     `VES_BUDGET_MODEL_UNKNOWN`, are unchanged for billed models.
- **Alternatives rejected:** dropping `--bare` and relying on flags alone while
  keeping the worktree as the working directory (the `AGENTS.md` loader is not
  named by any documented switch); `--safe-mode` (it also disables MCP
  servers, so the bridge would not load); letting Claude Code find the owner's
  logged-in session (an ambient credential the profile cannot name or redact);
  copying `~/.codex/auth.json` into the Workspace (reads the owner's session,
  and a rotated refresh token would break one of the two copies);
  `codex login --with-access-token` (an Enterprise-workspace token, not a
  personal plan); a mode field in the Task Request (untrusted input would pick
  the credential); reporting a cost of zero (a dollar figure that reads as
  free).
- **Open owner decisions:**
  - **G1.** Managed Claude Code policy (file, MDM, or server-managed) can add
    hooks, instructions, or a credential helper the profile cannot switch off.
    The profile refuses the file and MDM locations and ends a session on any
    hook event; server-managed settings are not detectable before a session.
    Decide whether the refusal stays, and whether a Team or Enterprise plan is
    in scope.
  - **G2.** Claude Code may still look up a Keychain entry named after the
    per-run config directory. It cannot find the ambient session. Decide
    whether that is acceptable without a switch that disables the lookup.
  - **G3.** No documented switch covers every startup request Claude Code
    makes with the token.
- **Consequence:** `docs/qualification/claude-code-driver-subscription.md`
  records what the labeled fake proved and what needs the owner's token.
  Nothing was observed live: TA1 allowed only `--help`, `--version`, and
  `codex login status` in a disposable directory. A Workspace that used API
  keys must now say so in `task-providers.json`.

### AD-045 — One session ledger per driver instance, parametrised by the driver's noun and two hooks (ADP-3)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/driver-session-ledger`).
- **Context:** The Claude Code, Codex, OpenCode and Pi drivers each kept a
  session map, a set of closed references, an event numbering step, a guard on
  the terminal event, and the cancel and close sequences. The four copies
  agreed, and only review kept them agreeing.
- **Decision:**
  1. `packages/drivers/src/driver-session-ledger.ts` is the one module that
     owns the session map, event numbering, the terminal event, cancel and
     close. Each driver instance holds one ledger, so a session reference is
     valid only for the instance that opened it. The session a driver holds
     exposes `resources`, `outcome` and `emit`; the sequence and the terminal
     state are not reachable from a driver.
  2. **The ledger takes the driver's noun and no error-code prefix.** The plan
     asked for both. Every session refusal already has a shared code
     (`VES_DRIVER_SESSION_UNKNOWN`, `VES_DRIVER_SESSION_CLOSED`); only the
     message names the driver ("Claude Code session is unknown"). A prefix
     parameter would have had no reader. The driver-prefixed codes
     (`VES_CLAUDE_ABORTED`, `VES_CODEX_STREAM_INVALID`, and the rest) belong to
     each driver's run, which stays in the driver.
  3. Two optional hooks carry what differs between drivers. `stop` ends the
     provider's work before a cancel emits the terminal event: Claude Code and
     Codex call their terminator, Pi aborts its agent and waits for it to be
     idle, OpenCode has none. `release` runs after the terminal event, on
     cancel and on the first close: Pi unsubscribes and resets its agent. A
     `stop` with nothing to wait for returns nothing, so that cancel still
     emits the terminal event in the caller's own turn.
  4. The sink is called before the sequence advances, and emission is not
     gated on the terminal event. Both are what the four drivers did. The
     second means a run cancelled through `cancel()` still reports how it
     ended after `session.closed`; whether it should is left to the session
     runner (ADP-4).
  5. `DeterministicMockDriver` keeps its own bookkeeping. It advances the
     sequence before it calls the sink, keeps a closed session in its map, and
     reports no outcome on close, so adopting the ledger would change its
     events and results.
- **Alternatives rejected:** a prefix parameter kept for symmetry (no reader);
  a base class for the four drivers (they share bookkeeping, not a run
  protocol, and the child-process handling must stay in files the census
  excludes by path); session identifiers issued by the ledger (each driver's
  identifier format is its own, and nothing gained from moving it); gating
  `emit` on the terminal event (it changes the emitted sequence of a cancelled
  run); moving the mock driver onto the ledger (item 5).
- **Consequence:** `tests/contract/driver-session-ledger.test.mjs` is the
  contract. `tests/contract/driver-lifecycle-matrix.test.mjs` gains a session
  axis that proves each driver's wiring, including a cancel of a running
  provider, which no test reached before; nine per-driver cases were retired
  against it. Evidence and the map of retired cases are in
  `.specs/features/architecture-deepening/validation-c3.md`. The `Driver`
  interface is unchanged, so the session runner (ADP-4) can be built on it
  without touching the ledger.

### AD-046 — One version probe, parametrised by error-code prefix and noun; the redactor is a module of its own (ADP-3)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/driver-version-probe`).
- **Context:** The Claude Code, Codex and OpenCode drivers each parsed the
  provider's version line, compared it with a floor, and built the available,
  unsupported and unavailable reports by hand. Pi built the same three reports
  around an exact pin. The three CLI drivers also each carried the same
  sensitive-value redactor.
- **Decision:**
  1. `packages/drivers/src/driver-version-probe.ts` owns the parse, the
     comparison and the three reports. A driver supplies a profile (identity
     fields, error-code prefix, noun, capabilities), a requirement, and a
     function that observes the provider's version text. Observation stays in
     the driver: the `--version` spawn with its own environment and working
     directory for the CLI drivers, the manifest read for Pi.
  2. **The probe takes the error-code prefix and the noun.** The codes are
     `<prefix>_NOT_AVAILABLE` and `<prefix>_VERSION_UNSUPPORTED`, and the
     messages "<noun> is unavailable" and "<noun> version is unsupported". The
     four drivers already followed that scheme, so every code and message is
     unchanged. Because the codes are no longer literals in the product source,
     each driver names its two codes in a comment beside its profile, and the
     driver suites and the lifecycle matrix assert all eight literally.
  3. A requirement is a **minimum** or **exact**. A minimum is read with the
     driver's own pattern, admits one major line only, and qualifies nothing
     when the floor itself cannot be read. Exact compares the reported text
     with the qualified version and parses nothing, so a suffixed or longer
     version is drift and is reported as the provider spelled it. Pi is exact.
     The floors keep their values: `2.1.168` for the T03 profile,
     `CLAUDE_MEDIATED_MINIMUM_VERSION` (`2.1.282`) for the mediated profiles,
     `0.115.0` for Codex and `1.17.18` for OpenCode.
  4. **The redactor is `packages/drivers/src/driver-redaction.ts`, not part of
     the probe module.** The plan asked for one module for parse, compare and
     redact. Redacting provider text shares no state and no vocabulary with
     version probing; a reader looking for either would not look in the other.
     Both land in the same pull request, each in its own commit.
- **Alternatives rejected:** a full error object per driver instead of prefix
  and noun (four strings where two generate them, and a driver could then
  leave the naming scheme the matrix relies on); moving the `--version` spawn
  into the module (each driver's environment and working directory differ,
  and child-process handling stays per driver); parsing Pi's version (a
  suffixed version would compare equal, or the report would lose the text the
  manifest gave); comparing the captured numbers directly instead of re-reading
  the normalized version (it would admit a version number too long to print in
  full, which `supported` refused).
- **Consequence:** `tests/unit/driver-version-probe.test.mjs` and
  `tests/unit/driver-redaction.test.mjs` are the contracts. Three things the
  drivers did and no test pinned are now pinned: the floor each CLI driver
  applies when a composition states none (a floor axis in
  `tests/contract/driver-lifecycle-matrix.test.mjs`), the anchoring of the
  Claude Code pattern, and Pi refusing a newer or suffixed runtime. A change
  to any floor now fails a test and is a requalification. Evidence is in
  `.specs/features/architecture-deepening/validation-c3.md`.

### AD-047 — The Run record module owns the layout, the seal, and the validation of a Run's durable record (ADP-2)

- **Status:** proposed (ratified by reviewing the pull requests that carry
  `refactor/task-run-record`).
- **Context:** A governed task keeps fifteen artifacts under
  `<workspaceState>/tasks/<runId>/`. Their paths, whether each is sealed, and
  how each is validated were spelled out across nine sources of the CLI
  composition: the grant marker was read in three, the commit record and the
  verification report were reached through sideways imports (`task-status`
  from `task-run`, `task-surface` from `task-verifier`), and each command
  joined the Run directory with a file name of its own. Three of them
  (`task-run`, `task-status`, `task-review`) also opened the checkpoint store
  and cast its rows, which the runtime store returns with no declared shape.
  The refusals that guard this state (`VES_TASK_STATE_UNREADABLE`, `VES_TASK_STATE_MISMATCH`,
  `VES_TASK_CONTEXT_*`, `VES_TASK_EVIDENCE_MISMATCH`,
  `VES_TASK_PACKAGE_INVALID`, `VES_TASK_REVIEW_UNAVAILABLE`) had no test,
  because only the macOS end-to-end journey reached the code that raises them.
- **Decision:**
  1. `apps/vestra-cli/src/task/task-run-record.ts` is the one module that
     knows the layout of the Run directory, which artifacts are sealed, and
     what a reader may trust about each. `openRunRecord(workspace, runId)`
     returns it; every task command reads and writes the Run's files through
     its interface and none joins a path into the Run directory. It reuses the
     seal and atomic write of `task-files.ts`, `TaskEvidenceStore`,
     `FileExecutionPackageStore`, and `FileRunCapsuleStore`.
  2. The module stays in the composition root. It needs the stores of
     `@verchestra/evidence` and the `ContextManifest` of
     `@verchestra/agent-runtime`, and `packages/platform-node` may import
     neither.
  3. Nothing is created before the first write, so a command that only reads,
     and a dry run, leave no `tasks/` directory. One reader inherits an effect
     from its store: `FileExecutionPackageStore` creates its root when it
     reads. Every caller has read the plan record first, so the Run directory
     exists by then.
  4. **Bytes, paths, and seals are unchanged.** Runs in flight and sealed Run
     Capsules depend on them. Golden values recorded from the sources as they
     stood before the module (the seal format, the review surface, the grant
     marker, the attempt digests, the context manifest identity, and the whole
     layout) are asserted against the module.
  5. The five plain markers (`grant.json`, `active.json`, `worktree.json`,
     `cancel.json`, `outcome.json`) stay plain. A marker reader returns what
     the file holds, because the Run Capsule digests the grant marker as it is
     read; sealing them would move the bytes of Runs in flight and that
     digest, so it is a separate change. The governed task design text, which
     said every record in the Run directory is sealed or content-addressed,
     now says what is true.
  6. One refusal is new: a plan record is filed only under its own run and
     Workspace (`VES_TASK_STATE_MISMATCH`). Before, the path was derived from
     the record, so the two could not disagree; now the path comes from the
     Run record and the check keeps that property.
  7. The module is also the one reader of the Run's checkpoint rows, which
     live in the runtime store. `RunRecord#checkpoints(runtime, taskId)`
     returns typed projections of the latest executor, gate, and repair
     checkpoints, and the store's three ports bound to the Run and task for
     the coordinators that write. No command opens the checkpoint store or
     casts a row. A member of the wrong type is absent from a projection. Two
     states that could not be told apart before are now refused as
     `VES_TASK_STATE_MALFORMED`: a stored budget ledger that is not a ledger
     (it was printed by `status`, sealed by `review`, and failed on resume as
     `VES_BUDGET_INVALID`), and a committed gate checkpoint that names no
     commit (it reached git as the text `undefined`). The runtime store
     writes neither.
  8. The three state roots the task path keeps beside the Workspace layout
     (`tasks/`, `keys/`, `verification/`) are named in `task-workspace.ts` and
     checked there on every command: one that exists must resolve strictly
     inside the Workspace state root, or the command stops with
     `VES_STATE_ROOT_ESCAPE` before it reads or writes there. The check only
     reads, and a root that does not exist yet passes, so a dry run still
     creates nothing. It is not part of `ensureWorkspaceState`, which creates
     every directory it checks.
- **Alternatives rejected:** the module in `packages/platform-node` (it
  cannot import the evidence stores or the context manifest type); an artifact
  store keyed by caller-supplied names (the callers would keep the layout);
  sealing the markers in the same change (it moves bytes this change must not
  move); marker readers that return only validated members (a hand-edited
  grant marker would then be digested differently into the Run Capsule than it
  is today); reading the Execution Package at review through the same checked
  reader `approve` uses (it would change the public error a damaged package
  store raises at review); typed gate and repair records returned by
  `RuntimeCheckpointStore` itself (the executor checkpoint's data is free-form
  by contract, and the ledger's meaning belongs to the budget meter, so the
  projections would still be needed above the store); a projection that
  returns an unchecked ledger typed as one (resume would then trust what the
  meter refuses); adding the three roots to `ensureWorkspaceState` (a dry run
  would create them); refusing any link at those roots (the Workspace layout
  already accepts a link that resolves inside the Workspace state root, and
  the key provider keeps its own stricter rule for `keys/`).
- **Consequence:** `tests/architecture/task-run-record-locality.test.mjs` fails
  when another task source names a file of the Run directory, joins a path
  into one of its directories, opens one of its stores or the checkpoint
  store, reads or writes a sealed record, casts a checkpoint row, joins a
  task state root onto the Workspace root, or imports another command's module
  for Run state. A Workspace whose `tasks`, `keys`, or `verification`
  directory is a link out of its state root can no longer run a task command
  until the link is removed. The
  module's refusals are exercised in a temporary directory on every platform
  (`tests/unit/task-run-record.test.mjs`,
  `tests/integration/task-review-surface.test.mjs`,
  `tests/integration/task-run-checkpoints.test.mjs`,
  `tests/integration/task-workspace-containment.test.mjs`). Evidence is in
  `.specs/features/architecture-deepening/validation-c2.md`.

### AD-048 — One driver session runner above the Driver interface; a stop always ends as cancelled (ADP-4)

- **Status:** proposed (ratified by reviewing the pull requests that carry
  `refactor/driver-session-runner`).
- **Context:** Four places started a driver, observed its events, and closed
  it: `DriverExecutionAdapter#run`, the Codex verifier of `vestra task`, and
  the two Self-Test scenarios. Only the first cancelled the session when it was
  stopped, each had its own rule for how a session ended, and the verifier
  started Codex for a caller that was already cancelled. AD-012 names "a driver
  session runner over `Driver.start` → deltas → close" as a missing piece and
  forbids a generic runtime. ADP-3 recorded one defect for this decision to
  settle: cancelling a running session emits `session.closed` with `cancelled`,
  then an error event, and `close` answers `failed`.
- **Decision:**
  1. `packages/agent-runtime/src/execution/driver-session-runner.ts` is the one
     module that runs a driver session. Its interface is `runDriverSession`,
     which takes a driver, a start request, an optional signal and an optional
     observer, and returns an outcome (`completed`, `failed`, `cancelled`) and
     the stable codes of the error events. It sits beside the structural
     `DriverSessionPort`, so `agent-runtime` still imports no driver.
  2. **The name and the interface are bound to drivers.** The runner knows the
     Driver protocol and nothing about a role. What an observer does with an
     event, and what an outcome means, stay with the consumer: the adapter
     keeps the tool surface, metering, checkpoints and the precedence of its
     own refusals; the verifier keeps its verdict text and its failure reasons;
     a Self-Test scenario keeps its facts.
  3. The caller's signal is the one way to stop a session. A caller that is
     already aborted never starts the driver. A stop cancels the announced
     session once, and the runner waits for that cancel before it closes, so
     the terminal event carries the cancel and its reason. A session announced
     after the stop is cancelled as soon as it is known.
  4. **A stop always ends as `cancelled`.** So does a session whose terminal
     event or whose close says `cancelled`. An error event or a `failed` close
     after that does not turn a cancel into a failure, and the late event is
     still delivered. `completed` is what the driver's close says and nothing
     less, with no error event observed; everything else is `failed`. This is
     the answer to the defect ADP-3 recorded. The drivers' event sequence is
     not changed.
  5. An observer runs inside a driver's stream handling. An error it throws is
     held, the session is cancelled and closed, and the error is rethrown.
  6. A start that fails after it announced a session has that session closed by
     its announced identifier, so the driver releases what it holds. A start
     that fails after the stop is the cancel the caller asked for.
  7. `recordUsageAndDecide` in
     `packages/application/src/execution/budget-meter.ts` is the one step that
     records a usage event and returns the verdict. Only the meter's own
     refusal is a budget stop; any other error is rethrown. The executor and
     the verifier meter through it.
- **Alternatives rejected:** a generic session or agent runtime (AD-012); the
  runner in `packages/drivers` (the adapter that needs it lives in
  `agent-runtime`, which may not import a sibling adapter); a controller owned
  by the runner and handed to the observer (every consumer already owns one,
  for an executor's cancel, a timer or a fatal denial); dropping events after
  the terminal event (the adapter's checkpoint would then depend on which of
  two events a driver emitted first); the adapter's former rule, under which a
  close with no outcome counted as completed (it would have weakened the
  verifier and the Self-Test verifier session, which already required
  `completed`); changing the drivers' event sequence in the same change (it is
  pinned by the lifecycle matrix and the ledger contract and belongs to a
  requalification of its own); rethrowing a failed cancel (the stop has
  already decided the outcome).
- **Consequence:** `tests/contract/driver-session-runner.test.mjs` is the
  contract, and `tests/integration/driver-session-runner-drivers.test.mjs` runs
  it against the Claude Code, Codex and Pi drivers. The driver execution
  adapter, the verifier of `vestra task` and the two Self-Test scenarios run
  their sessions through it, and
  `tests/architecture/driver-session-runner-locality.test.mjs` fails when
  another source of the composition root or of `agent-runtime` starts a driver
  session. The verifier gained a cancel and the already-aborted check and no
  longer swallows a metering defect. One point is left open: a cancelled
  Claude Code or Pi run still emits an error event after its terminal event
  and still answers `failed` on close. The runner tolerates that; changing it
  is a decision for the drivers. Evidence is in
  `.specs/features/architecture-deepening/validation-c4.md`.

### AD-049 — Stopping a Claude Code or Codex provider terminates its process tree; the composition root injects the terminator (ADP-4)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the process-tree termination range of `refactor/driver-session-runner`).
- **Context:** `vestra task` stopped Claude Code and Codex with a `SIGKILL` of
  the one process the driver had started, written out twice in the composition
  root. Whatever that process had started kept running. A descendant that
  held the provider's output open also kept the session waiting, because a
  driver waits for that pipe to close, and `vestra task cancel` waited with it.
  The routine that kills a group and the descendants that left it already
  existed in `packages/platform-node`, inline in the probe host, and a driver
  may not import a sibling adapter.
- **Decision:**
  1. On macOS and Linux the Claude Code and Codex drivers start their provider
     `detached`, so it leads a process group and a session of its own. Windows
     has no process groups, and its spawn is unchanged.
  2. `packages/drivers/src/driver-process-tree.ts` holds what the two drivers
     share: whether a provider leads its own group, and the terminator a driver
     uses when the composition injects none, which signals that group and
     never rejects when nothing is left to stop.
  3. `terminateProcessTree` in
     `packages/platform-node/src/process-tree-terminator.ts` is the one
     routine that records a child's descendants, kills its group, confirms the
     group is gone, and kills what the group signal could not reach. The probe
     host calls it, and it is exported to the composition root.
  4. `ProviderProcesses` in `apps/vestra-cli/src/task/task-process-tree.ts`
     owns the provider processes of a task command. A provider session gets
     its terminator and its spawn observer from it. The terminator never
     rejects, because a driver calls it from an abort listener, where a
     rejection would be unhandled and end the whole command; a tree that was
     not confirmed stopped is named once on stderr instead, with the provider,
     its process group id and the command that stops it.
  5. Each driver starts one termination per child, whoever asks: the abort
     path, a stream that keeps failing, or a cancel. A terminator that reads
     the process table cannot be asked once for every line left in a pipe, and
     on Windows a second kill of a provider that has already exited is an
     error that failed the cancel and cost the stop its reason. A termination
     that failed is forgotten, so the session stays cancellable.
  6. **A hang-up or a termination request while a provider runs stops the
     providers and ends the command; it is not a cancel.** A provider in its
     own group no longer receives the terminal's signals, so the command
     answers `SIGHUP` and `SIGTERM` itself, only while a provider is running:
     it stops every provider tree it started, with a bounded wait, and then
     ends as the signal would have ended it. Nothing is recorded after the
     signal (no abort, no cancel marker, no checkpoint, no tool effect), so
     the run is left as a killed command leaves it and `task resume`
     continues it. `SIGINT` stays the cancel it was, and so does `SIGTERM` at
     any moment when no provider is running.
  7. Both drivers are requalified with reports of their own. The existing
     reports are not edited: no argument, environment variable, working
     directory or stream check of any profile changed. The mediated profiles
     and `vestra task` stay refused on Windows.
- **Alternatives rejected:** a driver importing the terminator from
  `platform-node` (adapter coupling, which the architecture check refuses);
  leaving the provider in the caller's group and walking its tree instead (a
  walk races with a fork, and a group is one address); `detached` on Windows
  (it opens a console and gives no group); a termination per request (it
  failed the cancel on Windows, and it reads the process table once per
  request); a driver error code for a tree that could not be confirmed gone
  (it adds a code and a branch to two `start` methods that are already
  complexity hotspots; the line on stderr says the same to the one who can
  act on it); handling the terminal's hang-up by aborting the run (a lost
  terminal would then end a run that is resumable today, and an abort is
  recorded as a human decision); keeping `SIGTERM` a cancel while a provider
  runs (a termination request from the system is not a human's cancel
  either); a watchdog process that outlives a killed `vestra` (a second
  process to supervise, for the one signal that cannot be handled).
- **Consequence:** `pnpm qualify:claude` and `pnpm qualify:codex` each run one
  shared contract against their driver and labeled fake: a cancel and an
  aborted start signal leave no process of a three-process tree alive, one of
  which left the group with `setsid()`.
  `tests/architecture/provider-process-tree-termination.test.mjs` fails when a
  driver stops starting its provider in its own group, when the composition
  builds a provider driver without the tree terminator, or when a task source
  signals a provider itself. An operator can notice four things: a cancel no
  longer waits for a process a provider left behind; a provider no longer
  receives the terminal's own signals; a closed terminal or a `kill` of
  `vestra` while a provider runs stops the providers and leaves the run
  resumable, where a termination request at that moment used to abort it; and
  under `nohup` a hang-up, which used to be ignored, now ends the command and
  its providers.
- **Residual risk:** `SIGKILL` of the `vestra` process cannot be handled, and
  no watchdog is built for it. The provider then runs until its closed pipes
  make it exit. Its process group id is its process id, so
  `kill -KILL -- -<pid>` stops the whole group; `task status` shows the run as
  not active, and `task resume` or `task cancel` continues or ends it. The
  quick start says so. The change is platform-specific and needs a
  platform matrix run on the branch before merge. Evidence is in
  `.specs/features/architecture-deepening/validation-c4.md` and in
  `docs/qualification/claude-code-driver-process-tree.md` and
  `docs/qualification/codex-driver-process-tree.md`.

### AD-050 — `task review` proves the Execution Package as `task approve` does

- **Status:** proposed (ratified by reviewing the pull request that carries
  the first range of `fix/run-record-hardening`).
- **Context:** AD-047 left one reader of the Execution Package unchecked.
  `task approve` reads the package through `RunRecord#approvedPackage`, which
  compares its payload digest with the digest the plan bound. `task review`
  used the package store's own reader, and used it only while it built the Run
  Capsule, after the review had been recorded and the workflow had moved. A
  package swapped after approval therefore ended the command with
  `VES_TASK_FAILED` (reason `VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY`) and left
  a run that was `COMPLETED`, with a review record and no Run Capsule. A package
  the store found intact but that was not the one the plan bound was sealed
  into the capsule without a refusal. AD-047 rejected the checked reader at
  review because it changes that public error; this decision accepts the
  change.
- **Decision:**
  1. `task review` reads the package through `RunRecord#approvedPackage`,
     directly after the state check and before the review surface is read, the
     confirmation is asked, a credential is read, or anything is recorded. The
     Run Capsule is built from that one read.
  2. The refusal is `VES_TASK_STATE_INVALID` with reason
     `VES_TASK_PACKAGE_INVALID`, the code `task approve` already raises. No
     code is added.
  3. `RunRecord#loadPackage` stays on the interface for the layout golden of
     ADP-2, and no command calls it.
- **Alternatives rejected:** keeping the store's reader and adding only the
  digest comparison (two readers of one artifact with two error codes);
  checking the package where the capsule is built (the review is already
  recorded by then, so the refusal would still leave an ended run without a
  capsule); removing `loadPackage` from the interface (the ADP-2 layout golden
  calls it and must pass unmodified).
- **Consequence:** a user who reviews a run whose package was replaced or
  damaged now sees `VES_TASK_STATE_INVALID` (`VES_TASK_PACKAGE_INVALID`)
  instead of `VES_TASK_FAILED` (`VES_EXECUTION_PACKAGE_STORAGE_INTEGRITY` or
  `VES_EXECUTION_PACKAGE_STORAGE_INVALID`), and the run stays in
  `HUMAN_REVIEW` with nothing recorded, so restoring the package lets the same
  review succeed. `tests/architecture/task-run-record-locality.test.mjs` fails
  when a command calls the unchecked reader. Evidence is in
  `.specs/features/run-record-hardening/validation.md`.

### AD-051 — Nothing below a task state root is reached through a link

- **Status:** proposed (ratified by reviewing the pull request that carries
  the second range of `fix/run-record-hardening`).
- **Context:** AD-047 checks that `tasks/`, `keys/` and `verification/`
  resolve inside the Workspace state root and stops there. A link below one
  was followed: at `tasks/<runId>`, every read and write of the Run record
  went where the link led; at a directory inside the Run directory, so did
  that artifact family; at `verification/<runId>`, the verifier created its
  scratch checkouts there and deleted them recursively. Only two things were
  already refused: a reader refused a link in the place of a file as
  `VES_TASK_STATE_UNREADABLE`, and the package and capsule stores refused a
  linked root or file of their own. A writer replaced a link in the place of a
  file by its atomic rename.
- **Decision:**
  1. `requireRealDirectories(root, directories)` in `task-workspace.ts` walks
     the named directories below a task state root with `lstat` and refuses
     the first one that is a link. It only reads. A directory that does not
     exist ends the walk, so opening a Run record, reading a run that was
     never planned, and a dry run still create nothing.
  2. **A directory that is a link is an escape: `VES_STATE_ROOT_ESCAPE`.** It
     is the code the root check and the Workspace layout already use, it is a
     public code with no detail to leak, and its recovery text ("remove the
     link") is the right action. `VES_TASK_STATE_INVALID` tells the user to
     plan a new run, which does not help while the link is there. Below a root
     the rule is stricter than at the root: any link is refused, also one that
     resolves inside the Workspace state root, because the names below a root
     are derived from run IDs and the layout, and a link there can only make
     one run's directory another's.
  3. **A link in the place of an artifact is unreadable state:
     `VES_TASK_STATE_UNREADABLE`.** Nothing is read or written through it, so
     it is not an escape. A reader already refused it with that reason, and
     the ADP-2 suite pins that for nine readers. `writeJsonAtomic` now refuses
     anything that is not a regular file in its target's place with the same
     reason, instead of replacing it. One position, one code, for readers and
     writers.
  4. The Run record reaches every path through two private functions that run
     the check immediately before the read or write. The gate evidence store
     asks the Run record for its directory before each operation. The check
     runs outside the `try` of `approvedPackage`, so a linked `packages/` is
     an escape, not a damaged package.
  5. The verifier reaches each scratch checkout through one function that
     checks every directory from `verification/<runId>` down to the checkout.
  6. A cancel marker that is already present stands as the request:
     `requestCancel` does not write over it, so the refusal of point 3 never
     stops a cancel. A driver that cannot tell whether a cancel was requested
     (its Run directory became a link while it ran) stops the run.
- **Alternatives rejected:** comparing real paths, as the root check does (it
  would accept a link that resolves inside the root, and so let one run's
  directory stand in for another's); one code for both positions (a reader of
  a linked file would change from the reason the ADP-2 suite pins, for no gain
  in what the user can do); letting a writer keep replacing a link (nothing is
  written through it, but a replaced link hides that someone planted it, and
  the command then goes on over state it did not write); checking once when the Run record is opened
  (a command that runs for minutes would act on a check made at its start);
  moving the check into `ensureWorkspaceState` (it creates what it checks);
  the verifier checking only `verification/<runId>` (the checkout itself and
  `mutations/` are deleted recursively too).
- **Consequence:** a Workspace in which a run's directory, or a directory
  inside it, is a link can no longer run a command on that run until the link
  is removed. A link in the place of a marker that a command only writes
  (`worktree.json`, `outcome.json`, `active.json`) now fails that command
  instead of being replaced. `tests/integration/task-run-containment.test.mjs`
  asserts the refusal for every artifact family, for a link at the Run
  directory, at each directory inside it, and in the artifact's place, with a
  junction on every platform; the six commands are asserted in process and
  through the real binary; `tests/architecture/task-run-record-locality.test.mjs`
  fails when another task source raises the code or builds a path below a root
  outside the checked functions. **Residual risk:** the check and the act are
  two steps; a link placed between them is not seen. Evidence is in
  `.specs/features/run-record-hardening/validation.md`.

### AD-052 — The five markers are sealed for a run that names the marker seal; a marker that does not verify fails closed and never blocks a cancel

- **Status:** proposed (ratified by reviewing the pull request that carries
  the third range of `fix/run-record-hardening`).
- **Context:** AD-047 kept `grant.json`, `active.json`, `worktree.json`,
  `cancel.json` and `outcome.json` plain, because sealing them moves the
  bytes of runs in flight and because the Run Capsule digested the grant
  marker as it was read. An edit to a marker was not detected. Two readers
  also failed open: an active marker that could not be read counted as "no
  process drives the run", so a second driver could start and a cancel would
  remove the worktree under a live one; and the cancel marker was tested only
  for existence, which was already the safe direction.
- **Decision:**
  1. **The plan record says which form a run uses.** `task plan` writes
     `markerSeal: 1` into the plan record of a new run. The plan record
     already exists and is sealed. A plan record without the member is a
     legacy Run; no existing plan record is rewritten, so its bytes and its
     golden digest stay. A value this build does not know is refused as
     `VES_TASK_STATE_MALFORMED`. The Run record reads the form from the stored
     plan record, whether or not the command loaded the plan through it.
  2. A sealed Run writes each marker with the seal of `task-files.ts` and
     reads it through that seal. **No downgrade:** a marker cannot say which
     form it is in, so a plain marker in a sealed Run is a file outside the
     seal envelope and is refused (`VES_TASK_STATE_MALFORMED`); an edited one
     is `VES_TASK_STATE_TAMPERED`. A legacy Run writes and reads plain markers
     exactly as before.
  3. **The Run Capsule does not move.** A marker reader returns the record in
     both forms, never the envelope, and the capsule digests what the reader
     returns. The grant digest recorded for ADP-2 holds for both forms; in the
     sealed form it is also the seal written in the file.
  4. **An active marker that does not verify counts as a driver nobody can
     name.** `RunRecord#activeProcess` answers a process ID, `undefined`, or
     `"unverified"`. Every caller already treated any answer but `undefined`
     as "driven", so `start` and `resume` are refused with
     `VES_TASK_RUN_ACTIVE` and `status` shows the run as driven with `cancel`
     as its only action. `cancel` writes the request, waits the same minute it
     waits for a live driver, and, if the marker is still there, clears it and
     ends the run as an idle one. A marker that verifies and names a live
     process is never cleared. This is the fail-closed answer that still lets
     a user stop a run: "nobody" would be fail-open, and an error would make
     the run impossible to cancel.
  5. **A cancel marker is a request by being there,** in either form and
     whatever it holds. The only thing it can say is "stop". The record is
     sealed like the others, and no decision reads it.
  6. `task review` reads the grant marker before it asks for the confirmation
     or records the review, so a marker that does not verify stops the review
     with nothing recorded. Before, it was read while the capsule was built.
- **Alternatives rejected:** recognising the form from the file's own shape
  (a plain marker would then be believed, which is the downgrade); a new
  schema version of the plan record (the ADP-2 suite pins version 2 as a
  mismatch, and existing plan records would need a migration); a format file
  beside the markers (one more unsealed file to protect); returning the seal
  envelope from the grant reader (the capsule would digest the envelope and
  its digest would move); an unverifiable active marker as an error on every
  command (a run nobody can cancel) or as "no process" (fail-open); letting
  `cancel` end the run at once when the marker does not verify (a live driver
  would lose its worktree before it could answer the request); verifying the
  cancel marker before honouring it (an edit could then keep a run going);
  a keyed seal (the key would sit beside the files it protects, readable by
  the same user).
- **Consequence:** runs planned from this build on have sealed markers; runs
  in flight are untouched. An operator can notice four things. An edited
  grant or outcome marker of a sealed Run now fails `status` (and the grant
  fails `review` before anything is recorded) with `VES_TASK_STATE_INVALID`.
  An edited worktree marker stops an idle `cancel` with the same code, as an
  unreadable one already did. An active marker that does not verify blocks
  `start` and `resume` with `VES_TASK_RUN_ACTIVE` until `cancel`, which then
  takes up to a minute. And a build older than this one cannot drive a sealed
  Run: it would read the markers as plain and write plain ones back, which
  this build refuses. **Residual risk:** the seal is a digest, not a
  signature; a writer who recomputes it, or who rewrites the plan record
  without its marker seal, is not detected. That writer is another process
  of the same user, which the governed task threat model places out of
  scope. Evidence is in `.specs/features/run-record-hardening/validation.md`.

### AD-053 — A stopped session's run reports first, one terminal event follows, and nothing follows that event; the session ledger owns the order (ADP-3, ADP-4)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the cancel order range of `fix/driver-cancel-terminal-event`).
- **Context:** Cancelling a running session made a driver emit
  `session.closed` with `cancelled`, then an error event, and `close` then
  answered `failed`. AD-045 kept that order and AD-048 made the session runner
  tolerate it. Recording the four sequences showed four different causes
  behind one symptom. The Claude Code and Codex runs were not told that a
  cancel had terminated their provider, so the child's exit handler reported a
  process that died (`VES_CLAUDE_STREAM_INCOMPLETE`,
  `VES_CODEX_PROCESS_FAILED`). The Pi cancel released the agent, which resets
  its transcript, before the run had read from that transcript how it ended,
  so the run reported `VES_PI_RUNTIME_FAILED`, for the session runner's stop
  as well. The OpenCode cancel stopped nothing: the provider kept working and
  its events followed the terminal event.
- **Decision:**
  1. **The session ledger owns the order of a cancel-initiated end.** A driver
     brackets the run that reports how it ended (`runStarted`, and the
     function it returns). A cancel that stopped the provider waits for a run
     in flight before it emits the terminal event. The run's own report
     therefore comes first, and the terminal event carries the outcome that
     report recorded.
  2. **A terminal session accepts no further event.** What is emitted after
     the terminal event is not delivered and not numbered.
  3. **A late event is dropped, not counted.** The reason to keep it would be
     an error that explains a failure the stop did not cause. Item 1 delivers
     that error before the terminal event, where it decides the outcome, so it
     cannot be late. What can still arrive after a terminal event is the
     output of a run whose session was closed while it ran, and a count of it
     would have no reader: the close that could report it has already
     answered.
  4. **An outcome is recorded once.** The first `failed` or `cancelled`
     stands, and nothing changes it after the terminal event, so `close`
     answers what the terminal event said. A stop therefore never relabels a
     failure that preceded it, by `cancel()` or by the start signal, and a
     failure a provider reports after the stop does not turn the stop into a
     failure.
  5. In the drivers only what the ledger cannot know changes. A Claude Code
     or Codex cancel marks the run as stopped through the same request as an
     aborted start signal, so the run ends as `VES_CLAUDE_ABORTED` or
     `VES_CODEX_ABORTED`; the one termination per child of AD-049 is the only
     caller of the terminator, as before. A Codex stop no longer marks a run
     whose stream had already failed, so that failure keeps its own code. The
     OpenCode driver gives the ledger a stop hook: a cancel aborts the SDK
     session and closes the isolated server, as an aborted start signal does.
     The Pi driver only brackets its run.
  6. **The session runner keeps its rule that a stop always ends as
     `cancelled`** (AD-048, item 4). The end it was written for no longer
     occurs with the four drivers, but the rule is still reachable: a session
     that had failed before the stop now closes as `failed`, a cancel can fail
     and leave the close to say how the run ended, a start can reject after
     the stop, and a driver that keeps no session ledger (the deterministic
     mock, or a later driver) may still report an error after its terminal
     event. The runner's source changes in a comment only.
  7. No error code or message is added, removed or changed. The four drivers
     are requalified with reports of their own; no existing report is edited.
- **Alternatives rejected:** dropping late events in the ledger and changing
  no driver (a stream failure that preceded the stop would be dropped with the
  rest, and the session would close as `cancelled`); delivering a late error
  through the result of `close` (the terminal event would then say `cancelled`
  and the close `failed`, which is the defect); counting late events (item 3);
  letting `failed` outrank `cancelled` instead of recording the first (a
  provider that reports the abort as an error would turn every stop into a
  failure); a run that is implicitly in flight from `open` until the driver
  says otherwise (a start that fails before its run begins would leave every
  later cancel waiting); the wait inside each driver's stop hook (four copies
  of the order the ledger exists to own); marking the Pi run (its
  classification reads the agent's own stop reason, which the cancel already
  sets); refusing a `close` while a run is in flight (it changes what `close`
  answers to a caller that closes early, which is not this defect; it is left
  as the open point below).
- **Consequence:** `tests/contract/driver-session-ledger.test.mjs` asserts the
  order at the ledger's interface; its case "an event emitted after the
  terminal event is still delivered and numbered" is replaced by its opposite.
  `tests/contract/driver-lifecycle-matrix.test.mjs` gains a cancel order axis
  for the four drivers, and `pnpm qualify:claude`, `qualify:codex`,
  `qualify:opencode` and `qualify:pi` each pin their driver's exact sequences
  through one shared contract (`tests/helpers/driver-cancel-order-fixture.mjs`).
  A caller of a driver can notice five things: the error event of a stopped
  run comes before the terminal event and is the driver's `…_ABORTED`; `close`
  answers `cancelled` for it; `cancel()` of a running session resolves once
  the run has reported, not as soon as the provider was told to stop; a
  session that had failed before it was stopped closes as `failed`; and an
  OpenCode cancel stops the provider. Through the session runner the outcome
  of a stop is unchanged. One point is left open: a session closed while its
  run is in flight is terminal at once, and what the run reports afterwards
  is dropped. No composition does that. Evidence is in
  `.specs/features/architecture-deepening/validation-cancel-order.md` and in
  `docs/qualification/claude-code-driver-cancel-order.md`,
  `docs/qualification/codex-driver-cancel-order.md`,
  `docs/qualification/opencode-driver-cancel-order.md` and
  `docs/qualification/pi-driver-cancel-order.md`.

### AD-054 — Every end of a Claude Code or Codex provider goes through the tree termination; the OpenCode server and a Claude Code run that ends normally are left as they are (ADP-4)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the provider ends range of `fix/driver-cancel-terminal-event`).
- **Context:** AD-049 made a stop terminate a provider's process tree, once
  per child. An architecture review of `main` found that a stop is not the
  only way a driver ends its provider. The Codex driver still signalled the
  one process with `child.kill()` when its stream failed and when a run ended
  with the App Server still running, which is every completed turn. Checking
  the other drivers found that the Claude Code driver did not end a provider
  whose input write had failed, that the OpenCode driver's own server
  factory ends the `opencode serve` process it starts with `child.kill()` on
  every path, and that Pi starts no process.
- **Decision:**
  1. In the Claude Code and Codex drivers every end of the provider asks for
     the single termination per child of AD-049: a stop, a stream that failed,
     an output limit, a write to the provider's input that failed, and a Codex
     run that ended with the provider still running. Neither driver signals its
     child itself, and
     `tests/architecture/provider-process-tree-termination.test.mjs` fails
     when one does.
  2. An end that no caller awaits takes one form, `unawaitedTermination` in
     `packages/drivers/src/driver-process-tree.ts`, which contains a
     termination that fails. `child.kill()` could not throw, and a rejection
     there would be unhandled and end the whole command. A stop is unchanged:
     a cancel whose termination fails still rejects.
  3. At the end of a Codex run the termination is asked for only while the
     provider has not been seen to exit, as `child.kill()` was. A provider
     that exited by itself is not swept.
  4. **A Claude Code run that ends normally is not ended by the driver.** In
     print mode the provider exits by itself and its exit code is part of the
     result. A provider that reports its result and never exits keeps its
     session waiting until a stop. Ending it would need a grace period and a
     rule for the exit code of a provider the driver killed, which is a
     decision of its own.
  5. **The OpenCode server factory is not changed.** Terminating the tree of
     `opencode serve` needs the server to lead its own process group, which
     takes it out of reach of the terminal's signals, so the composition that
     runs it must also stop it on a hang-up, as AD-049 item 6 does for
     `vestra task`. No composition runs that factory: the Self-Test scenario
     injects its own. Changing the spawn alone would trade a descendant that
     survives for a server that survives a closed terminal.
- **Alternatives rejected:** a signal to the one process beside the tree
  termination (it can end the provider while the tree routine is still
  reading its descendants from the process table; with it a stream-failure
  case failed in some runs of the discrimination and not in others);
  awaiting the termination at the end of a run (the run already waits for the
  provider's output to close, and a terminator that never returns would hold
  it); a tree termination for a provider that has already exited (its process
  id is no longer its own); the OpenCode spawn change without a composition
  (item 5); a watchdog for a Claude Code provider that does not exit (item 4);
  a bound in the driver on the write of the prompt (it sees only a prompt
  larger than the pipe holds, it can cut a provider that starts slowly, and a
  provider that does not read is a provider that hangs, which the
  compositions already bound and stop).
- **Consequence:** `pnpm qualify:claude` and `pnpm qualify:codex` each prove,
  for a provider with a descendant that left its process group, that nothing
  of its tree is left when its stream breaks, when it exceeds its output
  limit, when it closes its input (Claude Code, on macOS and Linux), and when
  its turn completes without it exiting (Codex). The input case is not proven
  on Windows: the labeled fake cannot close its input there, the platform
  matrix showed the driver waiting as before, and the cases assert on win32
  that such a session is still ended by a stop. A provider that keeps its
  input open and does not read it is not noticed on any platform. An operator can notice one thing:
  under `vestra task` the verifier's App Server is killed with `SIGKILL` at
  the end of every verification, with whatever it started, where it received
  `SIGTERM`. No event sequence changed. Whoever first composes the OpenCode
  driver with its own server factory owes it the process group, the injected
  terminator and the interrupt handling together. Evidence is in
  `.specs/features/architecture-deepening/validation-cancel-order.md` and in
  `docs/qualification/claude-code-driver-provider-ends.md` and
  `docs/qualification/codex-driver-provider-ends.md`.

### AD-055 — A run has one account of usage: the verifier's usage is recorded on the run's ledger as it is metered

- **Status:** proposed (ratified by reviewing the pull request that carries
  `fix/verifier-usage-recorded`).
- **Context:** A governed task meters two providers against one set of
  ceilings. The repair loop saves the implementer's budget ledger in its repair
  state when an attempt ends. `TaskRunComposition#verify` built the verifier's
  meter from that ledger, and `meterUsage` in `task-codex.ts` recorded every
  Codex usage event on it and stopped the verifier at a ceiling. Nothing saved
  that meter's ledger afterwards. `task status` and the Run Capsule therefore
  reported the implementer's usage alone; a run with the implementer on a
  subscription and the verifier on an API key reported no cost; a run the
  verifier's usage stopped failed with a ledger that named no ceiling; and a
  verification repeated by `resume` started again from the implementer's
  total, so what the interrupted one had spent no longer counted against the
  ceilings. The end-to-end journeys pinned 18 tokens for a run whose two
  labeled fakes report 18 and 8.
- **Decision:**
  1. **The ledger stays where it is.** A run's account of usage is the
     `budgetLedger` of its latest repair state, a `repair` checkpoint in the
     runtime store. It is the run's ledger, not the repair loop's alone. No
     second store, no file in the Run directory, no checkpoint kind and no
     migration are added.
  2. `RunCheckpoints#recordBudgetLedger` in `task-run-record.ts` records usage
     metered after the repair loop ended. It keeps the stage, the attempt count
     and the attempt chain the loop left and moves only the ledger. A run
     whose loop saved no state (it was interrupted after its task commit and
     before the loop recorded it) has its ledger filed under `converged` with
     no attempt recorded.
  3. **The ledger only grows.** A ledger with fewer tokens, usage events or
     unbilled tokens, or with less cost, than the recorded one is refused with
     `VES_TASK_STATE_INVALID`, reason `VES_TASK_STATE_MISMATCH`, and nothing is
     stored. The duration is not compared: a clock measures it. No error code
     is added.
  4. `meterOnRunLedger` in `task-budget.ts` is the one place that meters work
     outside the repair loop. It builds the meter from the run's ledger, hands
     the work a meter that records its ledger back when each usage event is
     metered, and records it once more when the work ends, however it ends.
     `TaskRunComposition#verify` runs verification inside it.
  5. **The record is synchronous.** A usage event is metered inside a driver's
     stream handling, where nothing can be awaited. `RuntimeCheckpointStore`
     gains `inspectRepair` and `recordRepair`, the repair state without a
     promise; the `repairState` port now calls them, so both forms apply the
     same checks.
  6. A failure to record is not a budget stop. It leaves `recordUsage` as the
     error it is, the session runner ends the session on it (AD-048), and the
     run fails with that error's code.
  7. **The Run Capsule keeps its shape.** `budgetEvidence` has the same
     members, the capsule schema version and every digest rule are unchanged,
     and capsules sealed before this change verify as they did. What changes
     is what `consumed` (`tokens`, `durationMs`, `usageEvents`, `costUsd`,
     `unbilledTokens`), `billing` and `stopReason` cover: the whole run, where
     they covered the implementer's attempts. A capsule sealed before this
     change understates its run by the verifier's usage, and nothing in a
     capsule says which of the two it holds.
- **Alternatives rejected:** a sealed ledger file in the Run directory (a
  second store beside the repair state: a reader would add two ledgers, and a
  resumed meter built from their sum would be added again; it also moves the
  layout ADP-2 recorded); a checkpoint kind of its own (the kinds are a
  constraint of migration 012, so it needs a thirteenth migration); an
  executor checkpoint (the executor owns that sequence, and `resume` reads its
  latest stage); a verifier ledger kept apart and added when it is read (the
  ceilings would need the sum too, and the two could disagree); recording once
  when verification ends (a process killed during the mutation runs, the long
  part of verification, would lose the verifier's tokens); a record that is
  awaited later (a failure would be found after the session had gone on); a
  repair stage that names verification (it would replace `converged` in
  `status`); a new member in `budgetEvidence` that says what it covers (a
  change to the shape of signed evidence; left to the owner, below).
- **Consequence:** `task status` and the Run Capsule report one total for the
  run. With the labeled fakes that is 26 tokens in two usage events where it
  was 18 in one, and 34 in three after a verification that was killed and
  resumed. A run on API keys reports the price table's cost for both
  providers. A run with one provider on a subscription now reports
  `billing: mixed`, with the billed provider's cost beside the unbilled token
  count; it reported `not billed (subscription)` or a plain cost before. A run
  the verifier's usage stops now names the ceiling in its ledger. A
  verification repeated by `resume` spends from what the interrupted one left.
  Evidence is in `.specs/features/verifier-usage-recorded/validation.md`.
  **Open points for the owner:** (a) the implementer's usage is still saved
  only when a gate attempt ends, so a run killed during an attempt reports,
  after `resume`, a total without what that attempt had spent; (b) a verifier
  is still started when the run's ceiling was already reached, and stopped on
  its first usage event; (c) a run the verifier's budget stops ends with
  reason `VES_TASK_FAILED`, not `VES_EXECUTOR_BUDGET_EXCEEDED`; (d) whether
  `budgetEvidence` should say what it covers; (e) the live pilot
  pre-registration (`.specs/features/live-task-pilot/spec.md`) records
  `status.checkpoints.budget` as "Implementer usage" and the verifier's as
  unavailable, which is no longer what that field holds.

### AD-056 — The run's account of usage is complete: the implementer's usage is recorded as it arrives, a verifier does not start on a spent budget, and a budget stop names itself

- **Status:** proposed (ratified by reviewing the pull request that carries
  `fix/run-usage-complete`). It closes open points (a), (b) and (c) of AD-055
  and replaces the second half of its decision 2.
- **Context:** AD-055 recorded the verifier's usage on the run's ledger and
  left three gaps. The repair loop saved the ledger only when an attempt
  ended, so a run killed during an attempt lost what the implementer had
  reported: a run killed at its implementation gate and resumed reported 8
  tokens where 26 were spent. A verifier was started when the run's ceiling
  had already been reached and stopped on its first usage event, which Codex
  reports when its turn ends. And a run the verifier's budget stopped failed
  with reason `VES_TASK_FAILED`, where the implementer's budget stop is
  `VES_EXECUTOR_BUDGET_EXCEEDED`.
- **Decision:**
  1. **Every meter of a run records on the run's ledger.** `recordingMeter`
     in `task-budget.ts` wraps a meter so that each metered usage event is
     recorded through `RunCheckpoints#recordBudgetLedger` before the next is
     read. The composition hands the repair loop that meter, and
     `meterOnRunLedger` hands the same to verification. The repair loop, the
     executor and `packages/application` are unchanged: the loop still saves
     its state when an attempt ends, with the same meter's ledger.
  2. **The stage of a run whose loop has saved no state is what its gate
     checkpoint proves.** `repair` while an attempt is in flight, `converged`
     once the task is committed; no attempt is recorded in either case. AD-055
     filed every such run under `converged`, which was right only for
     verification. A resumed loop reads that state as it reads its own: no
     attempt has ended, and the ledger is what the run has spent.
  3. **What was never reported is not recorded.** Claude Code reports usage
     when its session ends and Codex when its turn ends. A session killed
     before that has reported nothing, so the run's total leaves out what it
     spent. `docs/quick-start.md` says so.
  4. **A verifier does not start on a budget that is already gone.**
     `runCodexVerifier` asks the meter before anything of the session exists
     and refuses with the reason the meter's verdict has,
     `VES_EXECUTOR_BUDGET_EXCEEDED`, as the executor refuses an attempt. No
     Codex process, session directory or identity directory is created.
  5. **A budget stop names itself.** `meterOnRunLedger` rethrows a task
     failure whose reason is the budget's (`VES_EXECUTOR_BUDGET_EXCEEDED`, or
     a `VES_BUDGET_*` code for usage the meter refused) under that code, with
     the task failure as its cause, so the run fails with it. Both codes
     exist and are the ones the implementer's path already reports
     (`.specs/features/governed-task-cli/spec.md`: budget exhausted is
     `FAILED` with `VES_EXECUTOR_BUDGET_EXCEEDED`). Every other verification
     failure keeps the code it had. No code is added.
- **Alternatives rejected:** recording inside the repair loop or the executor
  (the application would save on every usage event of every caller, and the
  loop's state port is asynchronous where the usage event is not); a stage
  passed by the caller (two callers would have to agree on what the gate
  checkpoint already says); estimating the usage of a session that was killed
  (a number the provider did not report); refusing the verifier in
  `meterOnRunLedger` (the session is the module that owns the verifier's
  failure reasons, and it must refuse a spent meter whoever calls it);
  changing the code of the verifier session's own failure (its envelope and
  `reason` are its tested interface, and only the run's outcome needed the
  budget's code); giving every verification failure its reason as the run's
  code (it would publish `VES_TASK_VERIFIER_FAILED` as a new outcome reason,
  which nobody asked for); a new error code for the verifier's budget stop
  (the existing one is the documented reason for this situation).
- **Consequence:** `status.checkpoints.budget` is no longer `null` during a
  first attempt once the implementer has reported usage, and
  `checkpoints.repair` then reads `repair` where it read `none`. A run killed
  at its gate and resumed reports 26 tokens with the labeled fakes (18 before
  the kill, 8 for the verifier) where it reported 8; a run killed after the
  implementer reported usage and before its gate reports 44 after `resume`,
  because the implementer runs again. A run whose ceiling was reached before
  verification fails without a verifier session; it failed after one before.
  A run a ceiling stops in verification prints
  `reason: VES_EXECUTOR_BUDGET_EXCEEDED` where it printed `VES_TASK_FAILED`.
  The Run Capsule is unchanged in shape and digest rules. Evidence is in
  `.specs/features/verifier-usage-recorded/validation.md`.

### AD-057 — A protected path is compared by what it names, in any letter case

- **Status:** proposed (ratified by reviewing the pull request that carries
  the fix).
- **Context:** The executor and the gate tested a target against the task's
  protected paths by the strings as written. The macOS default volume is
  case-insensitive, and the request grammar admits an entry spelled with a
  trailing `/`, a doubled `/` or a `.` segment. A case variant of a protected
  path absent at the base revision (`src/generated/out.js` against
  `src/Generated`) and a target under `src/vendor/` were written and
  committed; a case variant of an existing protected file was written before
  the inspection caught it. The bridge's read view and the worktree tool
  already folded case, each for its own list.
- **Decision:** A target is protected when the segments a protected entry
  names, letter case folded, are a prefix of the segments the target names.
  A path names its segments with empty and `.` segments dropped, so
  `src/vendor/`, `./src/vendor` and `src//vendor` name `src/vendor`, and `.`
  names the worktree. The executor applies the test before every tool effect
  and to every inspected change, and the gate to every inspected change,
  with the codes each already uses (`VES_EXECUTOR_PROTECTED_PATH`,
  `VES_GATE_PROTECTED_PATH`). Folding is for comparison only: the request,
  the Execution Package, the review surface and the Run Capsule keep every
  path as written.
- **Alternatives rejected:** asking the volume whether it is case-sensitive
  (a repository moves between volumes, and a commit made on one is checked
  out on the other); folding only on macOS (the same commit reaches a
  case-insensitive checkout from Linux); refusing a non-normal entry at
  intake (the schema admits it, and a protected entry should protect what it
  names rather than fail a request a human already reviewed); relying on the
  inspection after the effect (the protected file has already been written).
- **Consequence:** A case variant of a protected path is refused on a
  case-sensitive volume too, where it is a different file; that refusal is
  the price of one rule for every volume. `.VERCHESTRA/x` against protected
  `.verchestra` is now refused as protected, `VES_EXECUTOR_PROTECTED_PATH`,
  where it was refused for scope. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t1.md`.

### AD-058 — One task-path module in the domain owns the grammar, containment, the protected test and the case rule

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/scoped-path-rule`).
- **Context:** The grammar of a task path (a scope entry, a protected path, a
  target the implementer writes), its containment test and the protected
  test were written at the executor, the gate, verification, the scheduler,
  the MCP bridge, the worktree tool, both Git adapters and two CLI task
  modules, in three variants. Only the bridge and the worktree tool folded
  case; the bridge had replaced its pattern with a linear scan after a
  backtracking finding and the others had not. The protected half of the
  case rule is the previous decision.
- **Decision:**
  1. **One module.** `packages/domain/src/primitives/task-path.ts` owns
     `isTaskPath` (the grammar), `taskPathSegments` (what a path names),
     `isWithinTaskPath` and `isWithinTaskScope` (containment),
     `isProtectedTaskPath` (the protected test), `namesGitMetadata` (Git
     metadata at any depth) and `taskPathsOverlap` (two scopes that
     conflict). Every caller can reach the domain: application by the
     inward rule, agent-runtime and platform-node as adapters, the CLI as
     the composition root.
  2. **The grammar is the schema's.** `isTaskPath` accepts exactly what the
     path pattern of `schemas/task-request/1.schema.json` accepts, by a
     linear scan; a test compares the two on every short input. The schema
     does not change. The domain's `LogicalPath` is not the same rule and
     neither contains the other: it refuses spellings the task path admits
     (`.`, a trailing or doubled separator, a segment ending in `.`, a
     Windows reserved name such as `aux.c`) and admits characters the task
     path refuses (a space, a non-ASCII letter), so the two stay apart.
  3. **One case rule: a letter-case variant never widens what is
     admitted.** A case variant of a protected path is protected, a case
     variant of a scope entry is outside the scope, and two scopes that
     differ only in case overlap. Each answer is the worse of the two
     volume kinds.
  4. **A path compares as what it names.** Empty and `.` segments are
     dropped for every comparison, so `src/`, `./src` and `src//` all name
     `src`, and `.` names the worktree. A stage still decides which
     spellings it accepts from its own input and keeps its own refusal
     codes: the bridge refuses a doubled separator or a `.` segment in a
     target, the worktree tool collapses separators and refuses `.`, the
     executor collapses separators.
  5. **Stage limits stay with the stage.** The verifier's cited file keeps
     its 1024-character bound in `task-codex.ts`; the composition root
     still gives the worktree tool its own protected roots.
- **Alternatives rejected:** merging with `LogicalPath` (a stricter grammar
  would refuse requests the schema and every approved package admit);
  folding scope as well (on a case-sensitive volume it would admit a file
  the human did not approve); a shared regular expression (the
  backtracking finding, and CodeQL `js/polynomial-redos`); refusing a
  non-normal entry at intake (a schema change for a spelling the
  comparison can read by what it names).
- **Consequence:** Behaviour changes only where the stages disagreed. A
  scope entry spelled `src/`, `./src` or `src//` now admits what it names
  in the executor, the gate and the context source, and `src/` in the read
  view; the bridge still refuses to open a read scope spelled with a `.`
  segment or a doubled separator, so a mediated run with such a scope
  fails closed as before. `.` now admits the worktree in the executor and
  the gate, as the read view and the context source already read it.
  Before, such an entry admitted no write at all. A protected entry in such a spelling now hides what it
  names from the read view. The scheduler serializes two tasks whose
  scopes differ only in case, or one of whose scopes is `.`. No error
  code, message, stored path or digest changes.
  `tests/architecture/task-path-locality.test.mjs` fails when a second
  copy of the rule appears. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t1.md`.

### AD-059 — One module writes what a T76 candidate build seals; the workflow runs it from the dispatched commit, not the candidate (ADR2-2)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/candidate-evidence-writers`).
- **Context:** `.github/workflows/t76-candidate-build.yml` wrote
  `gate-evaluations.json`, `target-build-evidence.json` and
  `t76-target-index.json` through three programs embedded in the workflow. No
  test ran them. The publisher, the materializer, the builder and the
  publication fixture each restated what they wrote, and a change to one was
  proven only by a real five-target dispatch (architecture review of
  2026-10-02, card 3).
- **Decision:**
  1. **One module.** `scripts/t76-candidate-evidence.mjs` states the fleet,
     the gate profiles, the members of every sealed record, the build-info,
     gate evidence and index digest rules, and the three sealing steps
     `seal-gate`, `seal-target` and `reconcile`. The workflow calls them with
     the inputs the programs read, in the same sealing steps, and embeds no
     program that serializes, hashes or writes. The publisher and the
     materializer take the members and the digest rules from it. The builder
     writes `build-info.json` from its record and admits its gate profiles.
     `t76-signing-custody.mjs` re-exports its fleet, so the publisher and the
     refresh keep one binding.
  2. **The same bytes, or a refusal.** For every input the programs accepted,
     the module writes the same bytes or refuses. It refuses what they sealed
     without looking: a target or a release identity the build output does
     not record (they took the target from the matrix and a typed Node
     version, and the release from the dispatch), an unknown or repeated gate,
     a status that is not a decimal exit status, and a record of the wrong
     shape.
  3. **The reference is frozen.** `tests/fixtures/t76-inline-evidence-writers/`
     holds main's workflow at `23f29e1` byte for byte, pinned by its sha256.
     The golden test runs its programs and the module on the same inputs. The
     fixture is never refreshed: it is the reference for the bytes the
     published candidates were sealed with.
  4. **The sealing program is the dispatched commit's.** Each job checks out
     the commit the workflow was dispatched from (`github.sha`, depth 1,
     credentials not persisted), moves it out of the candidate tree to
     `$RUNNER_TEMP/t76-evidence-tooling`, proves its `HEAD` is `$GITHUB_SHA`,
     and runs the module, with its domain encoder, from there; the candidate
     checkout is only its input. The reason is custody: the program that
     seals a candidate's evidence is the reviewed one on the dispatched ref,
     as the embedded programs were, never one the candidate carries.
  5. **A run is checked by replay.**
     `node tests/helpers/t76-inline-evidence-writers.mjs replay` re-seals a
     downloaded candidate run with both the programs and the module and
     compares every sealed file. The candidate runs of `.3`, `.4` and `.5`
     replay with 33 of 33 files identical.
- **Consequence:** any revision can be built, one without the module
  included, and a candidate cannot change how its own evidence is sealed.
  Each job gains two steps (the tooling checkout and its move) before its
  first seal. The builder and the gates still run from the candidate, as
  before; the builder's own use of the module's build-info record is the
  candidate's build, and `seal-target` holds its output to the dispatched
  commit's shape. The published `.3`, `.4` and `.5` candidates are unchanged.
  Evidence is in `.specs/features/architecture-deepening-2/validation-t2.md`.
- **Alternatives rejected:** keeping the programs in the workflow and
  asserting on their text (the friction the review named); running the module
  from the candidate checkout (a candidate could change the program that seals
  its own evidence, and no revision before the module could be built); leaving
  the tooling checkout inside the candidate tree (the gates, and the replica
  the build tests copy from the working tree, would see a nested repository);
  taking the Node version from the build output alone
  (it would seal whatever the build recorded instead of refusing a stale
  input); checking release identity across targets in the reconciliation (the
  publisher already refuses it, and it would state that rule twice).

### AD-060 — One provider child run for Claude Code and Codex: the first end of a run decides its report, and only a provider that exits by itself has its exit read after its result

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/provider-child-run`).
- **Context:** The Claude Code and Codex drivers each wrote the spawn of
  their provider in its own process group, the output limit, the line and
  JSON framing, the stop through the one termination per child (AD-049,
  AD-054) and the end-of-run rule. AD-045 and AD-046 kept child-process
  handling per driver, for two reasons: the drivers share bookkeeping and not
  a run protocol, and the child-process handling must stay in the two files
  the census excludes by path. Reading the two copies again on `main`, after
  #476 and #477, found that they no longer agreed on three rules and were
  wrong together on two more. Claude Code reported the last of several stream
  failures where Codex reports the first, and let a failure that followed a
  stop replace the stop's report, which AD-053 item 4 rules out. A provider
  that died before its result was `VES_CLAUDE_STREAM_INCOMPLETE` whatever its
  exit and `VES_CODEX_PROCESS_FAILED` for the same exit, although both
  qualified spikes read the exit first. Neither driver contained a
  termination that failed on the start signal's stop, which every other end
  no caller awaits does (AD-054 item 2). And both ended the host process with
  an uncaught exception when a provider wrote the line `null`, and Claude Code
  took a line that parsed to a string for its run's error code.
- **Decision:**
  1. **One module runs a provider child to its end.**
     `packages/drivers/src/provider-child-run.ts` (`runProviderChild`) spawns
     the provider in a process group of its own, holds its output and error
     streams to one limit (1 MiB unless the execution states one), reads one
     JSON object per line, writes one frame per line, stops it through one
     termination of its tree whoever asks, brackets the run in the session,
     and reports how it ended. Each driver keeps its protocol translation as
     a function (`claudeProtocol`, `codexProtocol`) that receives every
     object line, converses with the provider through a channel (write a
     frame, write the last frame and close the input, fail the stream, say the
     result arrived), and may interrupt it. It is composition: there is no
     base class, and AD-045's objection to one stands.
  2. **A profile carries what differs.** The error-code prefix and the noun
     (the scheme of AD-046), the name of what failed in the stream-failure
     message ("Claude Code stream failed", "Codex protocol failed"), and how a
     provider ends after its result. Each driver names the codes its run
     reports beside its profile, and the lifecycle matrix asserts them
     literally. The start signal's grace period, during which Codex is asked
     to interrupt its turn, is a parameter of the launch.
  3. **The first end of a run decides its report.** A stop or a stream failure,
     whichever came first. Every later failure still asks for the one
     termination and changes nothing in the report; an input failure after the
     first end is ignored. Codex already followed this rule; Claude Code now
     does.
  4. **One end-of-run rule.** With no end before it: a run whose result never
     arrived failed, as `…_PROCESS_FAILED` when the provider ended with a
     non-zero code or a signal and as `…_STREAM_INCOMPLETE` when it exited
     cleanly. What counts as the result is the protocol's: a Codex
     `turn/completed`, and a Claude Code `result` event once the session was
     announced by its `init` event.
  5. **The exit after a result stays a parameter, and is not unified.** A
     print-mode Claude Code provider exits by itself, and its exit status is
     part of its result. The App Server keeps serving after its turn, so the
     driver ends it once its run has settled (AD-054 kills it, with
     `SIGKILL` under `vestra task`); the status that follows says how the
     driver ended it, and on Windows a terminated process exits with code 1.
     Reading it would turn every completed verification into a failure, as
     the discrimination in the evidence shows. The parameter, `afterResult`, decides
     both whether the driver ends the provider after its run and whether the
     exit after a result is read.
  6. **Every line is a JSON object.** A line that parses to `null`, a string,
     a number, a boolean or an array is the driver's `…_STREAM_INVALID`, as a
     line that does not parse already was.
  7. **An end no caller awaits is contained, the start signal's stop
     included.** A cancel still awaits its stop, and still rejects when the
     termination fails.
  8. **A spawn that fails ends the run as a failed process.** The child's
     `error` event is listened for, and the close that follows ends the run
     as any provider that died.
  9. **The census scans the module.** It serializes nothing: each protocol
     serializes its own frames, in the two driver files the census still
     excludes by path for exactly that. The module carries no census signal
     and is not excluded, so a serialization or digest added there later is
     caught.
  10. Not changed, and recorded: environment construction (Claude Code
      removes its session variables by their exact spelling, Codex in any
      letter case), the floor of the output limit (Claude Code refuses 0,
      Codex admits it), the `--version` probe spawn (AD-046), and a start
      signal that aborts while the probe or the resolution is awaited, which
      the run does not notice and the session runner covers by cancelling the
      session once it is announced.
- **Why the evidence now outweighs AD-045 and AD-046:** their reasons were a
  shared run protocol that did not exist and the census exclusion. The first
  is answered by composition: the module owns how a child runs, and the
  protocol stays with each driver. The second does not apply, because what
  the census excludes (frame serialization) stayed in the excluded files. Two
  copies of one run had meanwhile become five differences, two of them
  defects that ended the host process, and only review had kept them close.
- **Alternatives rejected:** a base class (AD-045); one end rule that reads
  the exit after a result for both providers (item 5); keeping both rules for
  a run that died before its result, or for several failures, as parameters
  (no protocol asks for either; each is a copy that drifted); moving the frame
  serialization into the module (the module would then need a census
  exclusion of its own); noticing a start signal that aborted before the run
  (it stops a provider before its session is announced, which changes the
  cancel order sequences of AD-053); moving environment construction into the
  module (each list is the provider's own).
- **Consequence:** A caller of the Claude Code driver can notice four things,
  each in a run that no qualification sequence pins: a provider that dies
  before its result is `VES_CLAUDE_PROCESS_FAILED` where it was
  `VES_CLAUDE_STREAM_INCOMPLETE`, unless it exited cleanly; a result that
  came before the `init` event, with a clean exit, is
  `VES_CLAUDE_STREAM_INCOMPLETE` where it was `VES_CLAUDE_PROCESS_FAILED`; of
  several stream failures the first is reported; and a stop is reported as
  `VES_CLAUDE_ABORTED` and closes as `cancelled` even when a broken line
  follows it. For both drivers: a line that is not a JSON object fails the
  stream where it ended the host process, was taken for an error code, or was
  ignored; a spawn that fails ends the run where it ended the host process;
  and a terminator that rejects on the start signal's stop no longer leaves
  an unhandled rejection. No message changed and no code was added. The
  pinned qualification sequences of both drivers pass unmodified; the runs
  that changed are pinned by new suites and requalified in
  `docs/qualification/claude-code-driver-child-run.md` and
  `docs/qualification/codex-driver-child-run.md`.
  `tests/integration/provider-child-run.test.mjs` is the
  module's contract, the child run axis of
  `tests/contract/driver-lifecycle-matrix.test.mjs` proves each driver's
  wiring, and `tests/architecture/provider-process-tree-termination.test.mjs`
  fails when a driver spawns or ends its provider outside the module. The
  change is platform-specific in what it runs and needs a platform matrix run
  on the branch before merge. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t3.md`.

### AD-061 — The Run record's readers return declared records, validated as they are read; a grant or outcome marker of another shape is refused in both forms (ADR2-9)

- **Status:** proposed (ratified by reviewing the pull request that carries
  `refactor/typed-run-record-readers`).
- **Context:** AD-047 gave the Run record module the layout, the seal and
  the validation of a Run's durable record, but four of its readers still
  returned untyped rows: the grant and outcome markers, the verification
  report (also through `verifiedCommit`), and the review record. `status`,
  `review`, the review surface and `start`/`resume` read their members by
  name and decided for themselves what a missing or mistyped member meant:
  `start` issued a new writer capability over a legacy grant marker whose
  `grantId` was not text, `status` printed whatever a marker held, and
  `review` bound it into the Run Capsule. A sealed Run's marker reader checked
  one member as text; a legacy Run's checked none (architecture review of
  2026-10-02, card 2).
- **Decision:**
  1. **One declared type per artifact a command reads a member of,** in
     `apps/vestra-cli/src/task/task-run-record.ts`: `GrantMarker`
     (`grantId`), `OutcomeMarker` (`TaskRunOutcome` by status, plus the time
     `at` it was filed), `VerificationReportRecord` (`verdict` `PASS` or
     `FAIL`, `commitId` an object ID) and `HumanReviewRecord` (`outcome`
     `accepted` or `rejected`). The commit record and the plan record keep
     the types they had.
  2. **Validated, then returned whole.** Each reader validates its record as
     it reads it and returns the record as the file holds it, every member
     kept. The Run Capsule digests the grant marker and the review surface
     digests the report as they are read, so a member the declared type does
     not name is still bound (AD-047's rejected alternative stands). A record
     of another shape is refused as `VES_TASK_STATE_MALFORMED`, the code the
     module already raises for one; no code is added.
  3. **Both marker forms are validated alike.** The form still comes from
     the sealed plan record and the seal is checked first (AD-052); then the
     same reader validates either form. A legacy Run's grant or outcome
     marker of another shape is now refused instead of read as whatever the
     file held. The one exception is the one the ADP-2 suite pins: a legacy
     worktree marker that names no worktree reads as none, so an idle cancel
     of that run still ends it. The active and cancel markers keep their
     rules.
  4. The report and review types name only the members the task path reads.
     Their schemas belong to the verification module, which builds them from
     inputs it has validated, and the ADP-2 and hardening suites pin records
     that carry only these members.
- **Alternatives rejected:** projecting each record to its declared members
  (the capsule's grant digest and the surface's report digest would move for
  a record with a member the type does not name); declaring the verifier's
  report and the review record whole (a second statement of schemas the
  verification module owns, refused by the pinned suites' fixtures); leaving
  a legacy Run's markers unchecked (a reader would return a type it had not
  checked, and a resume would mint a second writer capability over a damaged
  marker); validating the legacy worktree marker too (the ADP-2 suite pins
  that one naming nothing reads as none); a new error code (the existing
  reason names the case and its recovery).
- **Consequence:** no record Verchestra writes changes; bytes, paths, seals,
  the marker-seal rule and every golden are unchanged, and the ADP-2 and
  hardening suites pass unmodified. An operator can notice one thing: a
  legacy Run whose grant or outcome marker was edited into another shape now
  stops `start` and `resume` (grant), `status` (both) and `review` (grant)
  with `VES_TASK_STATE_INVALID` (`VES_TASK_STATE_MALFORMED`), as a sealed
  Run's already did for a missing member, and a sealed Run's outcome marker
  is now checked member by member, not only its status. Out of scope, each
  for a reason recorded in the evidence: the gate evidence store's `load`
  (the gate coordinator's entry, digested whole), the review coordinator's
  receipt in `task review`, and the runtime store's rows (ADR2-7).
  `tests/unit/task-run-record-readers.test.mjs` is the readers' contract,
  `tests/integration/task-status-records.test.mjs` the command's, and
  `tests/architecture/task-run-record-readers.test.mjs` fails when a reader
  returns a row or a command reads a member of one by name. The change
  touches the task path and needs a platform matrix run on the branch before
  merge. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t9.md`.

### AD-065 — A failed write to a provider's input is weighed after what the provider had already done; a provider that delivered its result or exited is decided by them

- **Status:** proposed (ratified by reviewing the pull request that carries
  `fix/provider-input-after-result`).
- **Context:** The platform matrix of a later branch failed a case of the
  provider child run (AD-060) on macOS x64: a provider that writes its result
  and exits by itself ended as `…_STDIN_FAILED`, `failed`, and its terminator
  was asked to end it. On a loaded host the run can be descheduled between the
  spawn and its first write long enough for a fast provider to finish and
  exit; the write then fails with `EPIPE` before the run has read the result
  and the exit already waiting for it, and any failed write ended the run at
  once. Both drivers had this rule before AD-060 (a failed write always failed
  the run, and AD-054 made it end the provider too), so a completed Claude
  Code print session could be failed this way.
- **Decision:**
  1. An error of the provider's input is weighed after at least one poll of
     the event loop, once the output and the exit that were waiting have been
     read (two immediates in a row, because one runs before the next poll when
     the run was spawned from a poll-phase callback).
  2. It then fails the run, as `…_STDIN_FAILED`, and ends the provider, only
     if no end came first, the result has not arrived, and the provider still
     runs. A provider that delivered its result, or that exited, is decided by
     its result and its exit: an input that fails after the result changes
     nothing, and a provider that died before the first write is reported by
     its exit.
  3. AD-060's rules stand: the first end decides, and only a provider that
     exits by itself has its exit read after its result.
- **Alternatives rejected:** ignoring input failures after the result only
  (the failure that was observed comes before the result is read); letting a
  result that arrives later withdraw an input failure already decided (by
  then the provider has been asked to end); a timer before weighing the
  failure (it would bound nothing a poll does not, and delay every input
  failure by a guess); dropping writes after the result (neither driver makes
  one: Claude Code writes once at the start, and Codex writes nothing after
  `turn/completed`).
- **Consequence:** A completed print session whose provider finished before
  the driver wrote its prompt closes as `completed`, and the terminator is not
  asked to end it. A provider that closed its input and still runs is ended
  one poll later than before. No Codex completion could meet the order: an App
  Server answers nothing before it reads `initialize`, and every later write
  is one it waits for; an App Server that dies before the first write is now
  always `VES_CODEX_PROTOCOL_FAILED`. No pinned qualification sequence and no
  recorded transcript changed. `docs/qualification/claude-code-driver-input-failure.md`
  corrects, without editing them, the statement of two Claude Code reports
  that the driver ends nothing at a normal end. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t3-input.md`.

### AD-062 — A runtime store read returns a declared record; the adapter that encodes a record decodes it

- **Status:** proposed (ratified by reviewing the pull request that carries
  the first range of `refactor/runtime-store-records`).
- **Context:** Seven reads of `RuntimeStore` returned records of no declared
  shape and six callers cast them. The policy view, the Workspace sync state
  and the authority records are text an adapter encodes, but the store
  parsed it on read, and for the policy view also verified a digest the
  view's own encoding defines: the encoding sat in one module and its
  inverse in another (ADR2-7).
- **Decision:**
  1. Every read of the store returns a declared type. A record the store
     owns column by column is declared by the store (`RunEvent`,
     `RunCapsuleSeal`).
  2. A record an adapter encodes comes back as the stored text plus the
     columns the store bound it to (`StoredAuthorityRecord`,
     `StoredPolicyView`, `StoredSyncState`). The adapter that encodes it
     decodes it, verifies what its encoding defines, and refuses a text
     bound to another identity or digest with `VES_RUNTIME_CORRUPT`. The
     store keeps the integrity it can prove without the encoding (the
     authority record digest).
  3. Writes are unchanged. The store still checks that the text it is
     given binds to its columns, and the policy and sync writes still parse
     it to do so. Moving those statements into the adapters is the split by
     aggregate, which stays deferred: the casts go without it, the policy
     and sync adapters have no production composition, and the store's
     suites exercise its statements directly.
- **Alternatives rejected:** declaring the adapters' types in the store
  and casting there (the cast moves, the encoding stays split); a full
  shape validator per adapter (it repeats checks the application already
  makes: the approval's signature and binding, the sync state's content
  digest); the split by aggregate.
- **Consequence:** Three states that were accepted or escaped untyped are
  now `VES_RUNTIME_CORRUPT`: an authority record filed under another
  identity, a sync state rewritten with the digest of its own content, and
  stored policy or sync text that is not JSON. No stored byte, sealed byte,
  schema, migration or error code changes. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t7.md`.

### AD-063 — A Driver event is one closed type stated in the domain, and every driver reads usage through one rule (ADR2-6)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the event type range of `refactor/typed-driver-event`).
- **Context:** A Driver event was an open record
  (`Readonly<Record<string, unknown>>` with a type and a sequence). Its fields
  were stated nowhere; the mock alone listed the keys of five types. Claude
  Code, Codex and OpenCode each wrote the same usage check, Pi had none and
  emitted its runtime's counts as relayed, and the mock checked scripted
  counts its own way and admitted a negative one. agent-runtime declared a
  second, structural event, and the execution adapter and the Codex verifier
  cast the counts to numbers. OpenCode emitted three counts and a list of
  patterns, and Pi an `api`, that no product source reads.
- **Decision:**
  1. **One module states the event.**
     `packages/domain/src/driver-event/driver-event.ts` holds the field table
     (`DRIVER_EVENT_FIELDS`): the eight event types, every field each may
     carry, and the kind of value it holds, a kind ending in `?` marking a
     field some drivers set. `DriverEventOf<T>`, `DriverEventBody` and
     `DriverEvent` are derived from the table, so the type is closed and
     discriminated: a field written outside its row does not compile. The
     session ledger, the mock and the provider child run emit the typed body,
     and every emitter names its fields, because a spread is not checked
     against the row.
  2. **It lives in the domain.** Both sides of the Driver seam already depend
     on `packages/domain`: the drivers emit the event, and agent-runtime,
     which may not import a sibling adapter, reads it. No dependency edge is
     added. `packages/drivers` re-exports the types for its interface, and
     `DriverSessionPort` stays structural for the driver and types its sink
     with the domain's event.
  3. **One usage rule.** `usageCount` reads a count as a number, takes an
     absent count as 0, and refuses one that is then not a non-negative safe
     integer; `usageUpdated` builds the usage event from two counts or
     refuses it. It is the rule Claude Code, Codex and OpenCode each wrote, so
     their emitted bytes did not change. Each driver refuses with its own
     code. OpenCode passes its reasoning and cache counts through the same
     rule.
  4. **Pi reads its counts through the rule.** A stop, which the agent
     reports as the stop reason `aborted`, comes first, as the first end
     decides for every driver (AD-053 item 4, AD-060 item 3). Otherwise a
     refused count is `VES_PI_RUNTIME_FAILED`, the code a run with no
     assistant message already reports, with no usage event, and a provider
     error with such a count reports it too, as a refused count outranks the
     provider's report for Claude Code and Codex. A count the rule reads is
     emitted as the number it reads.
  5. **The mock reads its scripted fields from the table and its counts
     through the rule**: a scripted count must be one the rule reads as
     itself, which refuses the negative count it admitted. The mock is no
     qualified provider driver, so this is recorded here and pinned by its
     contract suite, without a report.
  6. **Fields only some drivers set are kept and typed as optional.**
     OpenCode's reasoning and cache tokens are part of its qualified control
     profile, which normalizes them, and no consumer prices them; removing
     them changes every OpenCode usage event, needs a requalification, and
     depends on whether those tokens are ever priced, which is the owner's
     decision. OpenCode's `patterns` are the request its controller
     authorizes, and Pi's `api` is part of the identity its Passport binds.
  7. **Consumers read typed fields.** The session runner, the execution
     adapter and the Codex verifier read the event's fields with no cast and
     no open-record index; agent-runtime's `DriverSessionEvent` and the event
     generic of the runner and its port are removed.
- **Alternatives rejected:** the type in `packages/drivers` with a
  structural copy in agent-runtime (the fields stated twice); the type in
  `packages/application` (a dependency edge the drivers do not have, and the
  event is not a port of a use case); a schema in `packages/contracts` (an
  in-process value with no serialized form); validating every emitted event
  at run time in the ledger (the type proves it at build time, and a check
  per event would change what a test double may emit); removing OpenCode's
  three counts, its patterns or Pi's `api` (item 6); a new
  `VES_PI_STREAM_INVALID` (a code added for a run an existing code already
  names); reporting a refused Pi count from the run's error handler (a
  refused count would then turn a stop into a failure); keeping the mock's
  own check (a fourth copy that admits a count no driver emits); a builder
  for all five counts (the two every driver reports are the event's; the
  three OpenCode adds go through the rule one by one).
- **Consequence:** `tests/unit/driver-event.test.mjs` is the module's
  contract, the usage axis of `tests/contract/driver-lifecycle-matrix.test.mjs`
  proves each driver's wiring, and
  `tests/architecture/driver-event-locality.test.mjs` fails when a source
  declares a second event, a consumer reads a field by name or casts one, a
  driver builds a usage event or checks a count outside the module, or an
  event is spread from a record. 178 of 188 recorded scenarios of the four
  drivers and the mock are byte-identical to `main`; the ten that differ are
  nine Pi runs with counts the rule changes and the mock's negative scripted
  count. A caller can notice two things, each in a run no qualification
  sequence pinned: a Pi session whose runtime relays a count as text, `null`,
  a boolean or a one-element array, or leaves it out, emits the number the
  rule reads; and a Pi session whose runtime relays a negative, fractional or
  unsafe count fails with `VES_PI_RUNTIME_FAILED` and emits no usage event,
  unless it was stopped. No code or message was added. The Pi driver is
  requalified in `docs/qualification/pi-driver-usage.md`. The change touches
  the drivers and needs a platform matrix run on the branch before merge.
  Evidence is in `.specs/features/architecture-deepening-2/validation-t6.md`.

### AD-066 — One resolution of a worktree handle, the scratch checkout in the worktree module, and one gate verdict (ADR2-4)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the T4 range of `refactor/worktree-resolution-and-child-run`).
- **Context:** AD-043 gave `task-worktree.ts` the handle encoding, but turning
  a handle into a contained directory was still written twice: in the
  worktree adapter, and in the gate and commit adapters, whose copy admitted
  the root itself as contained, never qualified the repository root, and (in
  the commit adapter) never asked Git whether the directory was registered.
  Verification registered and removed its scratch checkouts itself in the
  composition root, swallowing every Git failure of the removal, and knew
  that a handle's ID is the checkout's directory name (AD-043 item 3,
  `scratchWorktreeHandle`). The verdict of a gate run was written twice, and
  the verifier's copy ignored the summary's total, cancelled and todo tests,
  and a test-summary gate that returned no summary (architecture review of
  2026-10-02, card 5).
- **Decision:**
  1. **One resolution.** `resolveWorktreeHandle` in
     `packages/platform-node/src/task-worktree.ts` reads the handle (bound to
     a base commit when one is given) before any effect, qualifies both roots
     (canonical, a non-bare repository, a worktrees root that is a real
     directory and not the repository), requires Git to list the directory,
     and requires it to be a real directory contained in its root. One
     containment test (`isWithinDirectory`) serves the resolution and the
     gate's working directory. The refusals are named once (handle,
     repository, root, escape, unregistered, missing) and each adapter
     answers them with public codes it already reported: the worktree
     adapter with `VES_GIT_WORKTREE_*`, the gate runner and the commit
     adapter with `VES_GATE_ADAPTER_*`. No code is added or retired. The gate
     runner keeps one rule of its own on top: the worktree is still at its
     handle's commit.
  2. **The scratch checkout is the worktree module's.**
     `NodeGitWorktreeAdapter#withScratchCheckout({ name, commitId }, use)`
     checks the commit out below the adapter's root in a directory it derives
     from the name, replaces one a killed verification left under the same
     name, hands `use` the directory and a handle the gate runner accepts,
     and removes the checkout whatever `use` did. The removal is judged by
     its outcome: a checkout Git still lists afterwards is
     `VES_GIT_WORKTREE_COMMAND_FAILED`, and a link in the checkout's place is
     refused before a recursive delete could follow it. When `use` and the
     removal both fail, the removal is reported: a verification can run
     again, a checkout left registered in the user's repository needs a
     person. This replaces item 3's `scratchWorktreeHandle`, which is gone;
     the derived directory is the one the mutation sensor used to name
     itself.
  3. **The composition reaches scratch checkouts through one checked
     function,** `scratchCheckouts` in `apps/vestra-cli/src/task/task-workspace.ts`,
     which refuses a link from the verification root down to the run's
     scratch root. The review checkout lives only as long as the verifier
     session, so a removal failure stops the run before any verdict is
     recorded. The mutation sensor is a module of its own
     (`task-mutation-sensor.ts`) and runs in a temporary repository.
  4. **One gate verdict.** `taskGateVerdict` in
     `packages/application/src/execution/gate-commit.ts` is the rule: a zero
     exit with no timeout or overflow, and for a test-summary gate a summary
     whose parts add up to its total, that meets the minimum, and has no
     failed, skipped, cancelled or todo test. The gate records it in its
     evidence as before; the mutation sensor counts a mutant killed exactly
     when it fails.
- **Alternatives rejected:** answering the gate adapters' refusals with the
  worktree adapter's codes (the run records an adapter's code as its failure
  reason, and the codes callers read would change for no gain); a resolution
  that returns an unregistered directory with no HEAD (a caller that ignores
  the HEAD would act on a directory nothing checked); moving only the removal
  and keeping `scratchWorktreeHandle` (the caller would still name the
  directory a handle points at); a random scratch directory (a checkout a
  killed verification left would never be replaced and would accumulate as a
  registered worktree in the user's repository); failing on each Git command
  of the removal (Git refuses a directory it does not list, and on Windows a
  file a gate process still holds; the delete and prune that follow recover
  both, so only what remains is a failure); naming a failed removal on stderr
  instead (the composition root has no channel outside a provider session,
  and the state needs a person); keeping the verifier's laxer verdict (it
  counted as surviving a mutant the gate would have refused to commit).
- **Consequence:** an operator can notice five things, all on paths a run
  only meets after a hand edit or a Git failure: a scratch checkout Git
  keeps registered after its removal now fails the run
  (`VES_GIT_WORKTREE_COMMAND_FAILED`) where it was left behind in silence; a
  link at a scratch checkout's own entry is `VES_GIT_WORKTREE_ESCAPE` where it
  was `VES_STATE_ROOT_ESCAPE` (a link at or above the run's scratch root is
  still `VES_STATE_ROOT_ESCAPE`); a registered worktree whose directory is
  gone is `VES_GIT_WORKTREE_NOT_FOUND` from `inspect` and `resolvePath` and
  `VES_GATE_ADAPTER_HANDLE_INVALID` from the gate and commit adapters, where
  it was a bare `ENOENT`; the gate and commit adapters refuse a missing or
  bare repository root (`VES_GATE_ADAPTER_INPUT_INVALID`) and the commit
  adapter a directory Git does not list (`VES_GATE_ADAPTER_HANDLE_INVALID`);
  and a mutant whose gates end with a cancelled or todo test, a summary that
  does not add up, or no summary is killed. The review checkout moves below
  `verification/<run>/review/`. Gate evidence bytes and digests are
  unchanged (`tests/unit/task-gate-verdict.test.mjs` pins the coordinator's
  digests taken on `main`); the runtime error catalog (19) and migrations
  (12) are unchanged. `tests/architecture/task-worktree-locality.test.mjs`
  fails when a source other than the worktree adapter adds, removes or prunes
  a worktree. The change touches the task path and needs a platform matrix
  run on the branch before merge. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t4.md`.

### AD-067 — One bounded child run in platform-node; the gate runner and the activation health gate keep only their verdicts (ADR2-5)

- **Status:** proposed (ratified by reviewing the pull request that carries
  the T5 range of `refactor/worktree-resolution-and-child-run`).
- **Context:** the gate runner and the activation health gate each wrote the
  same loop: spawn the child in a process group of its own off Windows,
  capture both streams to a limit, run a timer, end the group once on a
  timeout or an overflow, and settle after the close and the termination.
  The launcher's copy of the termination had already drifted once and was
  fixed on its own (#480); after that fix the two loops agreed rule for rule,
  so what remained was the second copy (architecture review of 2026-10-02,
  card 6).
- **Decision:**
  1. **One routine.** `runBoundedChild` in
     `packages/platform-node/src/bounded-child-run.ts` runs a child to a
     time and an output bound: no shell, a hidden window, its input ignored,
     a process group of its own off Windows, both streams captured in arrival
     order up to the limit, every chunk handed to an optional observer, one
     termination through `terminateProcessGroup` on the timeout or the first
     overflow, and a result only after the child closed and the termination
     finished. The caller names the refusal for a group that outlives its
     termination, so each keeps its public code.
  2. **An observation of how the child ended.** A child that started reports
     its exit status and signal, whether the run stopped it at its timeout or
     its output limit, what it printed up to the limit, and how many bytes
     each stream carried. A child that could not be started is reported as
     `spawn-failed`, not thrown, so a caller tells it apart from a
     termination that failed.
  3. **Each caller keeps only its verdict.** The gate runner digests each
     stream through the observer, records a child that reports no status as
     -1, reads its test summary from the captured output, and rethrows a
     spawn failure as before. The activation health gate maps the
     observation to its `VES_LAUNCHER_*` refusals and its health report, and a
     spawn failure to `VES_LAUNCHER_PROCESS_FAILED`.
  4. **Not folded in, each for a reason.** The probe host
     (`SpawnedProbeWorker`) is a long-lived duplex transport: it writes frames
     to the child's input, streams its output to a listener with separate
     limits that raise faults, has no timeout, and ends the tree with the
     escapee sweep; it is a different loop. The verified launcher handoff
     inherits the terminal and has no bound. The OS credential tool runner
     (`os-secret-backends/credential-tool.ts`) has a timeout and a capture
     cap, but it writes a credential to the child's input, zeroes what it
     captured, keeps reading past its cap instead of stopping the child, and
     stops one process rather than a group; its spawn is the one the
     qualified credential reports observed on three stores (AD-034, AD-041),
     and moving it would need those requalified on real stores. It is left as
     it is and named as an open decision for the owner.
- **Alternatives rejected:** a routine that throws on a spawn failure (the
  launcher could tell it apart from a failed termination only by the error's
  class); per-stream captures (neither caller reads a stream on its own
  except to digest it, which the observer does without a second buffer); a
  routine that also builds the child's environment (each caller's
  environment is its own contract); folding the probe host in (a transport,
  not a run to a bound).
- **Consequence:** no behaviour, error code or message changes. The gate's
  results and the launcher's health evidence are pinned by digests taken on
  `main` before the change (`tests/integration/gate-commit-adapters.test.mjs`,
  `tests/integration/activation-health-gate.test.mjs`).
  `tests/architecture/process-group-termination-locality.test.mjs` fails when
  a source other than the routine calls the group termination, or when either
  caller runs a timer or a detached spawn of its own. The published launcher
  bundle stays self-contained (the routine imports only Node built-ins and the
  terminator). The gate runner and the launcher run on Windows, so the change
  needs a platform matrix run on the branch before merge. Evidence is in
  `.specs/features/architecture-deepening-2/validation-t5.md`.

### AD-068 — Strands coordination runs behind the executor's driver port, through one SDK subpath, never as a model

- **Status:** proposed (ratified by reviewing the pull request that carries
  `.specs/features/strands-subscription-integration/`; the owner approved the
  SDK and Zod, and decides D1 and D5 there).
- **Context:** The owner wants single-agent, Graph, and Swarm coordination with
  `@strands-agents/sdk` 1.19.0 while every governed control stays in force.
  The SDK constructs a Bedrock model when an `Agent` has none, its root entry
  cannot enter a sealed release, and its `./multiagent` subpath runs any object
  shaped like an agent (`research.md` F1, F4).
- **Decision:**
  1. A task still makes one `TaskExecutionCoordinator.execute` call. Its driver
     port is filled by a coordinated driver in `packages/application` that
     runs a coordination plan and executes each node through a per-node driver
     port built from the existing Claude Code and Codex drivers.
  2. The SDK is imported only as `@strands-agents/sdk/multiagent`, only under
     `packages/agent-runtime/src/coordination/strands/`, exported only as
     `@verchestra/agent-runtime/strands-coordination`, and loaded only by a
     literal dynamic import for `graph` and `swarm` plans. Mode `agent` runs on
     a native engine.
  3. Nodes are structural agents; the adapter never constructs a Strands
     `Agent`, model, MCP client, session manager, sandbox, tool, or telemetry
     exporter.
- **Alternatives rejected:** one executor run per node (several worktrees,
  leases, and gate checkpoints per task); Strands as the outer orchestrator (a
  second authority path); the SDK root entry (unprefixed built-ins in the
  sealed bundle); routing single-agent runs through the SDK (no coordination to
  gain, and the SDK would load on every v2 run).
- **Consequence:** Gates, repair, verification, and review are unchanged.
  Architecture tests pin the subpath, the bans, and the main entry free of the
  SDK; a child-process probe proves no Bedrock client, credential read, network
  call, or process.

### AD-069 — Task Request v2 binds the whole normalized execution descriptor; v1 is frozen

- **Status:** proposed (same pull request).
- **Context:** A topology the owner did not approve must never run, and every
  existing v1 request and Run record must keep its meaning.
- **Decision:** `schemas/task-request/2.schema.json` adds a closed `execution`
  member (mode, nodes with driver, model, description, instructions, read and
  write scopes, inputs; edges or start and handoffs; limits). Normalization
  rejects cycles, unknown references, unreachable nodes, scopes outside the
  task, writes from Codex nodes, unordered writers, and plans without a writer,
  then fills every limit at its effective value. The normalized request is the
  execution contract sealed in the Execution Package, so its digest binds every
  field. Authentication, credentials, billing, executables, and endpoints have
  no member. The v1 schema, normalizer, digests, and records are unchanged; the
  contract generator learns to read every `<n>.schema.json`.
- **Alternatives rejected:** an optional member in v1 (changes v1's closed
  shape and its digests); binding only a topology summary (fields outside the
  summary could change unapproved); limits left implicit (a default change would
  silently alter approved runs).
- **Consequence:** Per-field discrimination tests show the binding digest moves
  with every descriptor field; golden v1 fixtures keep their digests.

### AD-070 — Verchestra, not the SDK, enforces swarm destinations, node results, and limits

- **Status:** proposed (same pull request).
- **Context:** Swarm 1.19.0 offers every other node as a destination and trusts
  a custom agent's `structuredOutput`; Graph accepts cycles and defaults every
  limit to `Infinity` (`research.md` F5, F6).
- **Decision:** Each node's structured result is a closed draft-07 object owned
  by the application (`outcome`, bounded `summary`; for swarm nodes also a
  required `next` enum of that node's declared targets plus `<complete>`, and a
  bounded `message`). Both CLIs receive the same schema; the adapter checks the
  same shape in Zod, with a parity test. Results are bounded per node and per
  run before persistence, and an invalid result fails the node with no repair
  cycle. The SDK receives only a payload-reference token, never provider text,
  and always finite concurrency, steps, and timeouts.
- **Alternatives rejected:** the SDK's open `context` record (not accepted by
  strict structured output, and an injection channel); trusting the SDK's
  schema (it lists every node); repair prompts (the plan forbids automatic
  cycles).
- **Consequence:** A forbidden destination ends the swarm FAILED; an endless
  handoff loop ends with `VES_COORDINATION_HANDOFF_LIMIT`.

### AD-071 — Suspension is an executor checkpoint stage, not a workflow state

- **Status:** proposed (same pull request; the reconciliation form is owner
  decision D4).
- **Context:** Quota exhaustion must stop a run without losing completed nodes,
  and `INTERRUPTED` is terminal in the workflow machine.
- **Decision:** On a trusted quota signal the coordinated driver stops
  scheduling, cancels running nodes, and returns a `suspended` driver status.
  The executor saves a `suspended` checkpoint with the change digest and the
  node-ledger digest, keeps the worktree, and releases the writer lease; the run
  coordinator records outcome `SUSPENDED` and applies no workflow command, so
  the run stays `IMPLEMENTING`. `vestra task resume` revalidates approval,
  policy, subscription preconditions, and the worktree digest, replays
  completed nodes from the Run record, re-runs effect-free failed nodes, and
  refuses an uncertain or partial node until the owner types back its
  uncertainty digest.
- **Alternatives rejected:** a new workflow state (changes the domain machine
  and every consumer of it); reusing `INTERRUPTED` (terminal by design);
  cleaning the worktree and replaying writers (repeats effects); automatic
  resume at the reported reset time (resumption is the owner's decision).
- **Consequence:** The workflow machine is unchanged; suspended time is not
  charged to the duration budget because a resumed ledger already counts only
  active time.

### AD-072 — A coordinated run uses subscriptions only, proven per session and confirmed by the owner for extra usage

- **Status:** proposed (same pull request; the confirmation format is owner
  decision D3).
- **Context:** A subscription login alone does not prove that no paid usage
  follows the allowance: Claude usage credits and Codex credits continue
  consumption when enabled, and no local read of either setting exists
  (`research.md`, subscription billing).
- **Decision:** Every provider of a v2 run, verifier included, must be
  `subscription` in `task-providers.json`, and a machine-local
  `task-billing.json` must hold the owner's per-provider statement that extra
  usage is disabled, naming the authentication method (and the Codex plan
  type) and nothing personal. Each Claude Code session must report
  `apiKeySource: "none"`; each Codex session must report a `chatgpt` account,
  no credit balance, and no unlimited credits. Claude `rate_limit_event`
  `rejected` and Codex `usageLimitExceeded` or a usage-limit
  `rateLimitReachedType` suspend the run. The Codex client sends only an
  allowlist of App Server methods, never one that buys, consumes, or advertises
  credits.
- **Alternatives rejected:** trusting the login mode alone; reading account
  web settings (no local interface, and it would read personal data); treating
  any rate limit as transient and retrying (spends allowance and can cross into
  paid usage).
- **Consequence:** The residual risk — a server-side setting changed after the
  confirmation — is stated in the threat model; a billing-regime change at a
  provider requires re-confirmation.

### AD-073 — Two Driver event types carry structured results and quota exhaustion

- **Status:** proposed (same pull request). Extends AD-063.
- **Context:** Node results must travel from the driver to the coordinated
  driver as bounded data, and a quota stop must be a typed fact rather than an
  error string.
- **Decision:** `DRIVER_EVENT_FIELDS` gains `result.structured { value, bytes }`
  and `quota.exhausted { scope, resetsAt? }`. A driver bounds the provider's
  structured output before emitting it; the driver execution adapter turns it
  into a payload reference in `outputRefs`. Only the Claude Code and Codex
  drivers emit them.
- **Alternatives rejected:** returning results through `close()` (outside the
  numbered event order the ledger keeps); encoding quota in an `error` code
  (loses the reset time and invites string matching).
- **Consequence:** The closed table stays the single statement of driver
  events; drivers that never emit the new types are unchanged.

### AD-074 — The Windows bridge runs over a named pipe owned by a pinned PowerShell 7 helper

- **Status:** proposed (same pull request; owner decision D6). It supersedes the
  Windows clause of AD-039 and item 7 of AD-040 only when the Windows transport
  passes its qualification on a Windows runner.
- **Context:** AD-039 scoped the bridge channel to Unix sockets. Node cannot
  set a named pipe's DACL, first-instance, or remote-client options; .NET's
  `NamedPipeServerStream` can.
- **Decision:** The bridge controller takes its channel through a transport
  interface. On Windows a PowerShell 7 helper, launched from a pinned path with
  a constant script and only the validated pipe name, owns a
  `CurrentUserOnly | FirstPipeInstance` single-instance pipe with a random
  per-run name and relays bytes over its standard streams; authentication,
  framing, and dispatch stay in the controller. The per-run directory's ACL is
  set and read back as owner-only; the Claude Code policy directory, the HKLM
  key, and the HKCU key are refused when present; transcription and script-block
  logging are refused. The three Windows refusals are lifted in the last commit,
  after qualification.
- **Alternatives rejected:** loopback TCP (reachable by every local user); a
  Node-only pipe server (no access control); a native addon (a build-time
  dependency on every platform).
- **Consequence:** PowerShell 7 becomes a prerequisite of the Windows profile;
  without it the run is `not configured`.

### AD-075 — The sealed build asserts self-containment from the bundle metafile

- **Status:** proposed; owner decision D2, because it changes a release gate.
- **Context:** The sealed build's check scans the bundle text with a regular
  expression; the SDK's MCP module carries a string literal that the scan reads
  as an import of `@strands-agents/sdk` (`research.md` F2).
- **Decision:** `bundleSealedLauncher` requests esbuild's metafile and fails on
  any external import of the output that is not a `node:` built-in, whatever
  its kind (static, dynamic, or `require`). The require-guard banner check stays.
- **Alternatives rejected:** an exception list for the literal (a textual check
  with holes); excluding the adapter from sealed releases (Graph and Swarm would
  be unusable for npm users) — kept only as the fallback if the owner declines.
- **Consequence:** The check becomes exact rather than textual; tests cover a
  real external of each kind. Each launcher grows by about 1.45 MiB.

### AD-076 — The Codex floor rises only for the sessions that use the newer App Server protocol

- **Status:** proposed (T4 of `.specs/features/strands-subscription-integration/`;
  refines the "Codex minimum version" default in its `spec.md`).
- **Context:** Structured output (`turn/start` `outputSchema`) and the account
  checks (`account/read`, `account/rateLimits/read`) are confirmed in the
  protocol that the installed `codex-cli 0.159.3` generates
  (`codex app-server generate-ts`); no older build was available to prove the
  first version that has them. The v1 verifier uses the driver's default floor,
  0.115.0, and `vestra task` probes no Codex version before a run, so raising
  that default would fail every v1 run on a build from 0.115.0 to 0.159.2 only
  at verification, after the implementer had already spent its allowance, and
  would break SSI-83 (v1 behaves as before).
- **Decision:** `CODEX_STRUCTURED_MINIMUM_VERSION` is `0.159.3`, the lowest
  build observed to have all three. A Codex session whose execution asks for a
  structured answer or for the subscription-only account checks is refused with
  `VES_CODEX_VERSION_UNSUPPORTED` before any process starts on a build below it,
  within the same major line. The T04 conversation keeps its default floor of
  0.115.0, as the Claude Code driver keeps its T03 floor beside the mediated one.
- **Alternatives rejected:** raising the default floor (the late v1 failure
  above); guessing an earlier first version (unproven, so not a qualification).
- **Consequence:** An owner with Codex below 0.159.3 sees v1 runs unchanged and
  every coordinated Codex node refused before spawn; T6's preflight reports it
  as `not configured`. The fleet's pinned 0.115.0 keeps qualifying the T04
  profile; moving that pin is a separate, owner-approved change.

### AD-077 — A later release-decision round supersedes a reject by binding to its exact bytes, never by editing it

- **Status:** proposed (ratified by reviewing the pull request that carries
  `.specs/features/release-decision-rounds/`).
- **Context:** `release-decision-1.0.0.md` is a signed reject (a recorded
  hold) that says a future promote round decides on a fresh candidate with its
  own decision file. The contract allowed at most one decision file per
  version, and `readReleaseDecisions` refused a second one, so the only way to
  record a later decision was to replace the signed hold and lose accountable
  history.
- **Decision:**
  1. Round 1 stays `release-decision-<version>.md` with no round fields, so the
     signed 1.0.0 hold validates byte for byte. Round *n* ≥ 2 is
     `release-decision-<version>.round-<n>.md` and carries `round`,
     `supersedes` (the immediately previous round's file), and
     `supersedesDigest` (sha256 of that file's exact bytes). The existing
     signature covers every field except `signature`, so the round fields are
     signed.
  2. A round fails closed on a name or `round` that disagree, round fields on
     round 1, a gap or duplicate, a round after a promote, a `supersedes` that
     skips a round, a `supersedesDigest` that no longer matches, a `decidedAt`
     not strictly later, or a candidate equal to the previous one or not
     descending from it (`git merge-base --is-ancestor`, the seam reachability
     already uses). Every round also passes every existing per-file rule.
  3. A version's effective decision is its highest round whose whole
     predecessor chain is valid; the full round history is kept beside it.
- **Alternatives rejected:** replacing the signed hold (erases accountable
  history); a free-form `supersededBy` in the earlier file (edits a signed
  file); taking the highest round that is valid on its own as effective (a
  round above a broken chain would take effect); per-round directories (a
  second naming convention for one artifact).
- **Consequence:** Rounds do not make a promote easier: each round needs its
  own reviewers, gate, and signature, and cannot rewrite why an earlier round
  rejected. Editing an earlier round breaks the round after it. Deleting the
  most recent round is visible only in Git history and review.

### AD-078 — A coordinated run's repair attempt is a new ledger round, and a node that reports itself blocked ends the run

- **Status:** proposed (T5 of `.specs/features/strands-subscription-integration/`;
  refines AD-068 and AD-070 where `spec.md` is silent).
- **Context:** The gate repair loop runs the executor once per attempt, and a
  coordinated run keeps a node ledger whose completed visits a resumed run
  replays. Replaying a finished plan on a repair attempt would skip every node,
  so the attempt could never act on the gate's feedback. The node-result schema
  has an `outcome` of `done` or `blocked`, and the spec does not say what
  `blocked` does.
- **Decision:**
  1. The node ledger is kept in rounds. A run's first execution is round 1; an
     execution that finds a `running` round resumes it and replays its
     completed visits; one that finds a finished round starts the next, which
     is a repair attempt, and every node of it receives the gate feedback as
     untrusted data. The per-run result limit counts the results of every
     round.
  2. A node that answers `outcome: "blocked"` has its result persisted as
     evidence and ends the run with `VES_COORDINATION_NODE_BLOCKED` (as the
     `reason` of `VES_TASK_FAILED`); no further node starts.
  3. Until T6 adds reconciliation, a resumed round with any visit that is not
     completed fails closed with `VES_TASK_NODE_UNCERTAIN` and runs nothing.
- **Alternatives rejected:** one ledger for the whole run (a repair attempt
  replays the finished plan and changes nothing); continuing after a blocked
  node (it spends allowance on a plan its own node said cannot proceed);
  re-running a started node on resume (repeats effects, AD-071).
- **Consequence:** Repair attempts behave for a coordinated run as for a
  single-session run; status and the Run Capsule can name the round of every
  visit.

### AD-079 — The owner's billing statement is hand-written and pinned to each provider's billing regime, Codex credits suspend a run, and a resume refuses before it changes anything

- **Status:** proposed (T6 of `.specs/features/strands-subscription-integration/`;
  refines AD-071, AD-072, and AD-078's third item where `spec.md` and
  `design.md` leave the form open).
- **Context:** D3 makes the extra-usage confirmation the owner's own
  machine-local statement, and D9 asks for it again when a provider's billing
  regime changes; no local read can tell a regime apart.
- **Decision:**
  1. The statement is a hand-written `task-billing.json`, not a command
     (SSI-31 adds none): per provider exactly `auth` (the method the session
     proves: `subscription` for Claude Code, `chatgpt` for Codex),
     `extraUsage: "disabled"`, `confirmedAt`, and for Codex `planType`. Each
     provider's current regime is a start instant pinned in the build; a
     statement dated before it, or after the clock that reads it, is `not
     configured`. A regime change is a build that moves the instant, which
     asks every owner to confirm again. The plan type is the owner's record:
     nothing compares it with the account, because the Codex driver keeps no
     account field beyond the type it checks.
  2. Credits on a Codex account (D3b) are seen where the driver checks them,
     at each Codex session's start before its turn, and stop the run the way a
     quota signal does: it is suspended, not failed, and the command reports
     `not configured` (`codex-credits`), so the owner loses nothing and resumes
     once the credits are gone. A suspension record keeps the provider's limit
     window (`scope`, a closed vocabulary) beside its code, provider, instant,
     and reset, and the executor's `suspended` checkpoint holds the change
     digest but no node-ledger digest: the ledger is sealed in the Run record.
  3. `vestra task resume` revalidates before any node starts and a refusal
     changes nothing: a suspended run needs its approval valid against the
     policy in force and its worktree as it left it (`VES_EXECUTOR_WORKTREE_DRIFT`
     otherwise), and every unsettled node of a coordinated run is settled. The
     run stays `IMPLEMENTING` for a corrected resume or `vestra task cancel`
     rather than failing. A visit settles on its own only when it ended
     failed with no receipt on an unchanged change digest; any other is run
     again only when `--reconcile` names the digest of its uncertainty record
     (its run and facts, without its state), one per resume. A re-run visit
     records `rerunOf`, that digest, and replaces the visit for replay and
     settlement; this supersedes AD-078's third item. A resume of a suspended
     run renews a writer grant that only expired, against the approval it
     just proved valid; a revoked grant is never renewed.
- **Alternatives rejected:** a `vestra task` subcommand that writes the
  statement (a new command, and a statement Verchestra writes is not the
  owner's); an expiry (D3 says none); a regime name the owner copies into the
  file (a member the design does not list, and one an owner would copy without
  reading); a preflight Codex account probe for credits (an account-only Codex
  session the driver does not have); failing the run on credits (the owner
  could not resume it once they are gone); failing the run on drift or an
  expired approval (it removes the worktree the owner may want to restore or
  inspect); a reconcile list in one resume (the parser refuses a repeated
  option, and each digest is one owner decision).
- **Consequence:** A Workspace confirmed before a regime change stops at
  `not configured` (`extra-usage-confirmation`) on its next `start` or
  `resume`, before anything is read or changed. Two nodes that may both have
  landed effects (a crash under concurrency above 1) refuse each other's
  reconciliation and leave only `task cancel`.

### AD-080 — The governed task path runs on Windows over the qualified named pipe, with every Windows prerequisite proven before the run

- **Status:** proposed (T7 commit 4 of
  `.specs/features/strands-subscription-integration/`; owner decision D6). The
  Windows leg of the platform matrix passed the eight real named-pipe cases of
  T7 commits 1 to 3 (run 37162941507), so this commit, and only this commit,
  supersedes the Windows clause of AD-039 ("Windows reports not configured")
  and the Windows limit AD-040 records in its consequence (AD-074 calls it item
  7), as AD-074 provides.
- **Context:** Three refusals kept the Windows path closed (SSI-77): the
  bridge without a transport, the mediated Claude Code profile, and every
  `vestra task` command. The transport's own `not configured` and the
  driver's managed-policy refusal surfaced only inside the run, after its
  first transition and its worktree.
- **Decision:**
  1. `vestra task` no longer refuses Windows, and the mediated profiles no
     longer refuse it at construction. The bridge still opens on Windows only
     over the transport the composition hands it; a caller that brings none is
     refused with `VES_BRIDGE_TRANSPORT_REQUIRED`, since Windows has no Unix
     socket.
  2. Before a Windows run's first transition, and only when the plan runs a
     Claude Code session, the CLI opens and closes one pipe channel (PowerShell
     7, its logging policy, and its directory's ACL), proves a probe directory
     under the sessions root owner-only, and, for the subscription profile,
     reads the managed-policy directory and both policy keys. Each missing
     prerequisite is `VES_TASK_NOT_CONFIGURED` naming it (`powershell-7`,
     `powershell-logging-off`, `owner-only-acl`, `claude-managed-policy`).
     The transport, the driver, and the policy check still refuse at their own
     place, so a change made after the check is still refused.
  3. The per-run Claude Code isolation directory, which holds the bridge token
     in `config/mcp.json`, is made owner-only through its ACL by the same
     `windows-acl.ts` routine as the pipe's directory, while it is still empty;
     on Windows a mediated profile without that proof is refused at
     construction, and a failed proof is `VES_CLAUDE_ISOLATION_INSECURE` before
     Claude Code starts.
  4. A provider child on Windows gets `PATH`, `SystemRoot`, `TEMP`, `TMP`, and
     `TZ`, its per-run home in both `HOME` and `USERPROFILE`, and nothing of
     the Unix list; the relay's MCP-config environment carries `SYSTEMROOT`
     beside the bridge variables. Only a native `<name>.exe` on `PATH` is
     taken as a provider, never a `.cmd` or `.ps1` shim. macOS and Linux keep
     every list and lookup as they were.
  5. Every worktree the task path asks Git to add fits Git's own limit: Git
     refuses an explicit `GIT_DIR` longer than PATH_MAX - 40 bytes, and
     `git worktree add` passes `<directory>/.git`, so a worktree directory is
     at most 215 bytes on Windows (979 on macOS, 4051 on Linux). The worktree
     module owns that rule and refuses a directory past it with
     `VES_GIT_WORKTREE_PATH_TOO_LONG` before it asks Git to add or remove
     anything; `task start` and `task resume` measure the run's worktree and
     both scratch roots on the real path before they read the run, ahead of
     every other check, and refuse a state root too deep for them as `not
     configured` (`state-path-length`): its location is what an owner fixes
     first, since every Workspace file moves with it. The verification scratch
     checkouts move from `verification/<run ID>/<purpose>/` to
     `verification/<16 hex of the run ID's digest>/<r or m>/`, 22 characters
     below the run's own worktree instead of 51 to 54, on every platform; this
     supersedes the scratch path AD-066 names. The run's worktree keeps its
     layout, since its ID is in the handle the Run record keeps.
  6. On Windows every Git command of the task path runs with
     `-c core.longpaths=true`, so a repository that checks out in place also
     checks out in a worktree below the state root; the paths past 260
     characters exist only inside Verchestra's worktrees and scratch
     checkouts. The user's Git configuration is never changed.
- **Alternatives rejected:** keeping `VES_BRIDGE_PLATFORM_UNSUPPORTED` for a
  caller without a transport (Windows is supported; what such a caller lacks is
  the transport); a default pipe transport inside agent-runtime (it may not
  import platform-node); checking the prerequisites only inside the run (a
  missing prerequisite would cost a transition and a worktree); trusting the
  inherited ACL of the sessions root (a user's profile ACL also admits SYSTEM
  and Administrators, and a relocated state root may admit more); starting a
  `.cmd` shim through `cmd.exe` (a shell between Verchestra and the provider's
  arguments); relying on libuv, which adds `SYSTEMROOT`, `TEMP`, and the other
  variables Windows needs to a child spawned from Node when they are absent
  (the relay is started by Claude Code, not by Node, and the list stays
  explicit); a shorter worktree handle ID (the Run record keeps handles of
  32 digits); a scratch layout on Windows only (two layouts, one of them
  never exercised by the macOS and Linux journeys); leaving `core.longpaths`
  to the user (a repository the user checks out fine would fail inside
  Verchestra's deeper worktrees, mid-run); writing it into the user's
  configuration (a change outside Verchestra's state the user did not ask
  for).
- **Consequence:** PowerShell 7 at its pinned path, an ACL-capable volume, and
  native `claude.exe` and `codex.exe` on `PATH` are prerequisites of a Windows
  run. A Windows run pays one PowerShell 7 start for the check and one per
  Claude Code session. On Windows libuv adds the variables Windows needs
  (among them `USERNAME`, `USERDOMAIN`, `HOMEDRIVE`, `HOMEPATH`) to a child
  started from Node when they are absent; none is a credential. A Windows
  Workspace state root (`<state root>/workspaces/<workspace ID>`) longer than
  150 bytes (`LOCALAPPDATA` longer than 75 bytes, a user name past 52 bytes in
  the default location) is `not configured` before any effect. On an upgraded
  macOS or Linux Workspace, a scratch checkout a verification killed under
  the earlier build left registered is no longer replaced and needs
  `git worktree remove`. The live Windows pilot (D6) stays owner-run.

### AD-081 — A Codex node reads a read-only copy of its read scope, never the worktree

- **Status:** proposed (T9 remediation R2 of
  `.specs/features/strands-subscription-integration/`; finding 4, SSI-42,
  TM-004).
- **Context:** A Claude Code node reads through the bridge's read view
  (`WorktreeReadView`), held to its read scope. A Codex node reads through
  Codex's own read-only sandbox, which the bridge cannot hold, and ran with
  the run's worktree as its working directory, so its read scope was a prompt
  line. The driver's thread parameters name `sandbox: "read-only"` and no
  readable root; by Codex's documented modes that sandbox withholds writes and
  network, not reads.
- **Decision:**
  1. The bridge's read view gains `materialize(target)`: it writes the view
     out under a directory the caller owns, exactly the text files a bridge
     read reaches (the read scope minus protected paths and Git metadata,
     every path component lstat-checked, links never followed, binary files
     left out), files `0400` and directories `0500`.
  2. It is bounded as the bridge's search is: a listing the bridge would
     truncate (over 1,000 entries), more than 5,000 files, or a file over
     1 MiB refuses the whole view with `VES_BRIDGE_VIEW_LIMIT` before the
     session starts; nothing is copied in part.
  3. A Codex node's session runs in its own view,
     `<sessions root>/codex-node-<run ID>-<node ID>-<visit>/scope`, never in
     the worktree; `removeMaterializedView` makes the view writable for its
     owner and removes it, with the node's HOME, when the node ends.
- **Alternatives rejected:** recording the unconfined read as an accepted
  risk alone (the view confines every read relative to the working
  directory); hard links into the worktree (a mode change would reach the
  worktree's own files, and a link across volumes fails); copying part of an
  oversized scope (the node would read a scope other than the approved one
  without knowing it); a readable-root policy in the Codex driver (not
  verified against 0.159.3 without a provider call).
- **Consequence:** A Codex node no longer works in the worktree, and two Codex
  nodes of one run no longer share a working directory. Codex's sandbox still
  permits a read by absolute path outside the view: an accepted residual,
  recorded for TM-004, whose reach into the Run record is limited by the node
  result screen (SSI-49). Each Codex node holds one copy of its read scope on
  disk for its lifetime, at most 5,000 files of at most 1 MiB.

## Handoff

- **Feature:** `subscription-provider-auth` (ADP-A, tasks TA1 and TA2) on
  `feat/subscription-provider-auth`.
- **Completed:** see `.specs/features/subscription-provider-auth/handoff.md`.
- **Next:** independent review; then the owner's one-time setup and the first
  supervised live run, which decide the gaps G1–G3.


- **Feature:** `governed-task-cli` E6–E9 (#405) on
  `feat/405-governed-task-cli`, stacked on `feat/405-governed-task-foundations`
  (#409 and #379 are already on `main`).
- **Completed:** `TaskRunCoordinator`, the `vestra task` commands and their
  composition root, the sealed bridge relay, the child-process journeys and
  security suite, and `docs/quick-start.md`. See
  `.specs/features/governed-task-cli/handoff.md`.
- **Next:** independent review; then the supervised live pilot (#406).

- **Feature:** `init-probe-scaffold` (#234) on `feat/234-init-probe-scaffold`,
  based on local `feat/os-secret-backend` at `e281ba9`.
- **Completed:** deterministic probe scaffold for all eight engines through
  `vestra init` (AD-035). See `.specs/features/init-probe-scaffold/handoff.md`.
- **Next:** independent review of AD-035, then rebase onto `main` after #379
  merges.

- **Feature:** `os-secret-backend-cross-platform` (#379) on
  `feat/379-linux-windows-credential-stores`.
- **Completed:** qualified Linux Secret Service and Windows Credential Manager
  credential backends (AD-041), proven against the real stores in CI on all
  three platforms. See
  `.specs/features/os-secret-backend-cross-platform/handoff.md`.
- **Next:** independent review of AD-041.

- **Feature:** `os-secret-backend` (#379) on `feat/os-secret-backend`.
- **Completed:** qualified macOS keychain credential backend (AD-034),
  `vestra secret set|status|delete`, and deep doctor's presence-only
  `anthropic-api-key` check. See `.specs/features/os-secret-backend/handoff.md`.
- **Next:** independent review; the owner binds the credential on a
  provisioned macOS machine and records a `doctor --deep` verdict.
- **Reconciliation (2026-09-29, #407):** The feature handoffs were audited
  against their source reports. The per-file evidence is in
  `.specs/features/handoff-reconciliation/validation.md`.
  - **Marked `complete`, with evidence:**
    - `release-decision`: T7 `9d5d6e3`; T8 `62ccde4`, a signed reject (a
      recorded hold).
    - `t75-evidence-signing`: `84ae20a`, `11f9318`.
    - The four T76 slices, superseded by `docs/qualification/t76-validation.md`.
  - **Still open, each with its owner:**
    - `milestone-2-completion`: blocked on #408.
    - `deep-doctor-live-probes`: T22 blocked, with no tracking issue; see #379.
    - `live-activation-matrix`: blocked on #387 and #393. A single `.3` does
      not close J02.
    - `tuf-role-separation`: blocked on the owner's online key; #382 is still
      open.
    - `canonical-json-t4-completion`: T21 ratchet repair, with no tracking
      issue.
    - `agent-ready-repository`: the repository topics.
  - **The entries below are historical.** "T75 remains next" and "#58 remains
    open" are superseded: T77 is complete, and #16, #17, #18, and #58 are
    closed.

- **Feature:** `milestone-2-completion` P0 on `codex/milestone-2-p0-sync`,
  based on `origin/main` `190e06f50e5a0b014013bda4dd7618104db3182a`.
- **Completed:** Reconciled the programme to the current remote state. #16
  and #36 remain open; #207 implementation is merged through PR #302/#306;
  #294 implementation is merged through PR #303 but owner key custody is still
  blocked. T74 remains the highest verified task and T75 remains next.
- **Next:** Run `agent:check` and `gate:quick`, then submit the documentary PR
  for independent human review. After merge, start #58 T4j/T4k on a fresh
  issue branch.
- **Blockers:** T75 still lacks an immutable candidate rerun, signed evidence
  index, and `docs/qualification/t75-validation.md`. The owner-only protected
  signing secret/public reference and the T75 fleet dispatch cannot be
  fabricated or provisioned by automation.

- **Feature:** `deep-doctor-live-probes` (#207), merged through
  [PR #306](https://github.com/accd/verchestra/pull/306) at `b6c6201`.
- **Completed:** Live read-only observations, async sentinel-safe collection,
  source-mode `blocked`, and path-hardening gates are merged. The remaining
  T22 platform-matrix dispatch is evidence work for T75, not a reason to
  claim the qualification report exists.
- **Next:** Human-trigger the exact T75 fleet workflow and bind its outputs to
  the independent T75 report.

- **Feature:** `canonical-json-t4i-signed-evidence` (#58), merged through
  [PR #307](https://github.com/accd/verchestra/pull/307) at `190e06f`.
- **Completed:** Version-gated Execution Package ordering, V1/V2 regression
  coverage, census reclassification, and required checks are merged. The T4i
  handoff is not a claim that #58 is closed.

- **Also completed:** [PR #310](https://github.com/accd/verchestra/pull/310)
  fixes a pre-existing macOS path-validation bug in
  `scripts/provision-doctor-fixtures.mjs` that rejected legitimate
  `mkdtemp(tmpdir())` roots because `/var` resolves through `/private/var`.
  The fix keeps the independent real-containment check and restores the nine
  integration fixtures on macOS.

- **Feature:** `canonical-json-t4j-release-identity` (#58) on
  `feat/canonical-json-t4j-release-identity`, rebased onto the current
  `main` after #308.
- **Completed:** T4j direct migration of `hermetic-bundle.ts` and
  `transactional-activation.ts` to `canonicalizeJsonV2`, code-unit component
  ordering, cross-locale regression coverage, a discrimination sensor,
  census reclassification, and the approved `@verchestra/domain` workspace
  dependency. Local `pnpm gate:full`, `test:security`, and
  `test:architecture` pass with zero failures, skips, or todos. The work is
  submitted for independent review in PR #311; #58 remains open pending
  review, merge, and T4k census close-out.
- **Next:** after PR #311 merges, continue the portable-owner verticals
  (registries, connectors, extension host, drivers, memory, and policy
  bundles) in the documented order.
- **Blockers:** independent human review and merge of PR #311; no release
  secret or owner-only custody is involved in this T4j slice.

- **Historical handoffs:** `live-doctor-probes` is marked `complete` and
  explicitly superseded by `deep-doctor-live-probes`; `t75-evidence-signing`
  remains blocked on owner-only custody rather than treated as a pass.
