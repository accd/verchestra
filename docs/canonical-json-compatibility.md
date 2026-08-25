# Canonical JSON compatibility matrix

Issue: #58

## Contract decision

Every new structured value used for a portable digest, signature, idempotency
key, or persistent verification uses **V2 canonical JSON**: RFC 8785 JSON
Canonicalization Scheme (JCS), with deterministic Unicode code-unit member
ordering and strict JSON-value validation.

The public contract type and version live in `packages/contracts`; the pure
encoder and validation implementation live in `packages/domain`. Application
packages consume the domain primitive. Adapters consume only inward packages.
`packages/evidence/src/integrity/canonical.ts` remains the qualified V1
implementation until it is replaced by a domain-backed facade in a separately
reviewed migration. No application package may import evidence to canonicalize
input.

Reusing the already-qualified `canonicalize@3.0.0` implementation in
`packages/domain` is blocked by the architecture boundary itself, not only by
dependency approval: `scripts/architecture.mjs:67-69` rejects any non-relative,
non-`ajv` import in `contracts`, `domain`, or `application` as
`VES_ARCH_THIRD_PARTY_IMPORT`, and domain packages take no third-party
dependencies by design. Widening that control would
itself need explicit human approval and a lockfile update under the repository
change rules. The owner instead approved an independently implemented,
zero-import RFC 8785 encoder in `packages/domain`, with its own published
vector review (2026-08-01) — `canonicalize@3.0.0` stays qualified and in place
in `packages/evidence` for V1.

V2 rejects undefined object values, sparse arrays, accessors, cycles,
non-finite numbers, invalid Unicode, excessive nesting, and excessive node
counts before encoding. Arrays remain ordered unless the owning domain
normalizes a declared set before calling the encoder. Ambient
`localeCompare` is forbidden for a V2 digest input or its semantic ordering.

## Compatibility rules

| Existing form | V2 migration rule | Backward verification |
| --- | --- | --- |
| A signed artifact or persisted record has an explicit schema/version | Keep its V1 bytes and verifier; add a new schema/version for V2 output. | Select the verifier from the recorded schema/version. |
| An idempotency or plan identity is durable but not externally versioned | Add a `canonicalizationVersion` field and retain the existing identity on reload. | Recompute V1 for records without the field; compute V2 only for new records. |
| A transient, recomputable in-memory value | Migrate in one vertical slice after cross-locale tests. | No historical byte compatibility is required. |
| Presentation sort or closed-field validation | Keep the local operation if it does not influence a digest, signature, stored identity, or emitted portable bytes. | Not applicable. |

No migration may silently rewrite a digest, re-sign an artifact, or reinterpret a
V1 value as V2. A feature-specific migration must prove an old persisted value
still verifies, a new value emits the declared version, and a mixed V1/V2
comparison fails closed where identities are not interchangeable.

## Current mechanical census

The source-derived, reviewed inventory is
[`docs/canonical-json-census.json`](canonical-json-census.json). It scans every
TypeScript and module-JavaScript product source under `packages/`, `apps/`, and
`scripts/` for local canonicalizers, structured `JSON.stringify`
serializations, ambient `localeCompare`, and SHA-256 digest producers. The
serialization signal is deliberately conservative: the reviewed classification
separates raw bytes from portable or persistent identities. The associated
security test requires the detected and inventoried path sets to be exactly
equal, and rejects a duplicate, stale, signal-mismatched, unreasoned,
exception-invalid, or unclassified entry. The current 86-source census has no
unclassified group.

Only the inventory's closed `presentation-or-fixture` entries may retain an
ambient-locale ordering exception. A structured trust or persistent identity
cannot use that classification. A raw-byte digest is not a canonical JSON
exception: it hashes already-defined bytes or a fixed primitive rather than a
locally canonicalized structured value.

The scanner keeps only the following closed scope exclusions for serializations
that are not product identities: build-time diagnostics, test and fake-driver
fixtures, an ephemeral Self-Test child handoff, driver protocol frames, and
diagnostic command output. Each path and reason is declared in
`scripts/canonical-json-census.mjs` and asserted by the census security test;
no trust, persistence, or portable-identity source can enter that exclusion.

### Pending migration order

1. The **signed-evidence vertical** versions the V1 facade and the Execution
   Package, Run Capsule, Recovery Bundle, Support Bundle, and their persisted
   DSSE payload verification before changing any evidence ordering.
2. The **release vertical** versions hermetic bundle material first and
   transactional activation second, retaining V1 verification for release and
   durable activation records.
3. The **portable-owner verticals** then proceed independently for registries,
   connectors, extension host, drivers, memory, and policy bundles. Each is
   classified in the census but remains pending until its own compatibility
   design, tests, gate evidence, and review are complete.

The historical rows below record previous slice decisions. The mechanical
census, not a historical ceiling or duplicate transition row, is the complete
current classification source.

## Trust and persistence inventory

| Owner and current path | Current material / consumer | Classification | Current byte contract | Required migration slice |
| --- | --- | --- | --- | --- |
| Evidence: `packages/evidence/src/integrity/canonical.ts` | Artifact IDs, payload digests, signatures, execution packages, capsules, recovery and support bundles | signed + persistent | Qualified JCS-like V1 with strict validation | Preserve V1 verification; introduce V2 facade only with envelope/schema versioning. |
| Application authority: `authority.ts` | Approval bindings and capability-grant binding digests | persistent authority; classified transient (T4b) — see rationale below | **Migrated (T4b).** `canonicalizeJsonV2` replaces the recursive serializer with ambient locale member order. | Done. `tests/security/authority-binding.test.mjs` (cross-locale test), 86 existing authority/capability cases unchanged. |
| Application coordination: `work-claims.ts` | Claim scope digest and claim equality | persistent authority; classified transient (T4b) — see rationale below | **Migrated (T4b).** `canonicalizeJsonV2` replaces the recursive serializer; `compareTargets`'s two-field target sort (feeding a dedup/subsumption pass whose adjacency the sort must reproduce) now uses code-unit `<`/`>` instead of `localeCompare`. | Done. `tests/unit/change-scope.test.mjs` (cross-locale test), 41 existing coordination/scope cases unchanged. |
| Application execution: `gate-commit.ts` | Gate plan, evidence, request, and idempotency digests | persistent authority; classified transient (T4c) — see T4b/T4c rationale below | **Migrated (T4c).** `canonicalizeJsonV2` replaces the recursive serializer with locale member order (9 call sites). | Done. `tests/integration/gate-commit.test.mjs` (cross-locale test), 42 existing gate-commit cases plus the 29-case Self-Test crash-recovery suite (including the production crash matrix) unchanged. |
| Qualification evidence: `scripts/t75-evidence-index.mjs` | T75 evidence index body digest | persistent verification (new; no installed base) | **V2 from birth.** `canonicalizeJsonV2` over the index body, with `canonicalizationVersion: 2` recorded in the artifact so a downstream verifier recomputes it without guessing. | None. Introduced after this document, so no V1 bytes exist to preserve. |
| Application egress: `trust-egress.ts` | Egress manifest and revision digests | signed-adjacent authority | Recursive serializer plus locale member order | Version manifest digest and reject mixed-version approval binding. |
| Application handoff: `handoff/validation.ts` | Portable handoff validation digests | portable persistent | Recursive serializer plus locale member order | Version handoff artifact before changing bytes; receiver chooses recorded version. |
| Application execution: `gate-commit.ts` | Gate plan, evidence, request, and idempotency digests | persistent authority | Recursive serializer plus locale member order | Add canonicalization version to plan/checkpoint/receipt records; retain V1 resume verification. |
| Application egress: `trust-egress.ts` | Egress manifest and revision digests | signed-adjacent authority; classified transient (T4f) — see rationale below | **Migrated (T4f).** `canonicalizeJsonV2` replaces the recursive serializer; the manifest's optional `declassificationEvidenceId` field is now omitted rather than set to `undefined` (V2 rejects `undefined` object values, AD-009). | Done. `tests/security/data-egress-firewall.test.mjs` (cross-locale test), 63 existing trust-envelope/firewall cases unchanged. |
| Application handoff: `handoff/validation.ts` | Portable handoff validation digests | portable persistent; classified safe-to-swap (T4f) — see rationale below | **Migrated (T4f).** `canonical()` (exported name kept for its many call sites) now delegates to `canonicalizeJsonV2` instead of the recursive serializer. | Done. `tests/integration/portable-handoff.test.mjs` (cross-locale test), 126 existing handoff/egress cases unchanged. |
| Application sync: `workspace-reconcile.ts` | Persisted sync state, plan and rebuild identities | persistent | Recursive serializer and locale sorting of semantic collections | Add state/plan canonicalization version; retain V1 reload and conflict detection. |
| Application effects: `effect-contract.ts` | Durable effect idempotency keys | persistent effect identity | Fixed-shape `JSON.stringify` material without a canonicalization version | Add a versioned effect identity material and retain V1 key lookup for existing intents and receipts. |
| Application sync: `workspace-reconcile.ts` | Persisted sync state, plan and rebuild identities | persistent; classified safe-to-swap (T4g) — see rationale below | **Migrated (T4g).** `canonicalizeJsonV2` replaces the recursive serializer; every ID sort (project, projection, manifest, operation, effect) now uses code-unit `<`/`>` instead of `localeCompare`. | Done. `tests/integration/workspace-reconcile.test.mjs` (cross-locale test), 44 existing sync/reconcile cases unchanged, including the SQLite-backed restart and tamper-detection cases. |
| Application effects: `effect-contract.ts` | Durable effect idempotency keys | persistent effect identity | **Migrated (T4i).** V1 keeps its frozen fixed-shape material and bare `sha256:` key; V2 emits explicit `canonicalizationVersion: 2`, canonical JSON material, and `v2:sha256:`. The runtime reads pre-existing rows as V1 and converges both forms by logical identity before application. | Done. `tests/unit/effect-kernel.test.mjs` pins V1 bytes and V2 emission; `tests/integration/effect-kernel.test.mjs` migrates a real V1 SQLite row and proves one application; `tests/fault-injection/effect-kernel-faults.test.mjs` proves cross-runtime V1/V2 convergence; `tests/security/canonical-json-sensor.test.mjs` kills a V2-to-`JSON.stringify` mutant. |
| Agent runtime context: `context-compiler.ts` | Snapshot ID, recipe, semantic-obligation, serialized-meaning and manifest digests | portable persistent | Recursive serializer and locale ordering of fragment/source IDs | Version context snapshot/manifest material; normalize declared sets with code-unit order before V2. |
| Agent runtime discovery: `source-snapshots.ts` | Context source snapshots, fact alternatives and selector material | portable persistent | Recursive serializer and locale ordering | Migrate together with context compiler; prove old snapshot verification and cross-locale reproduction. |
| Agent runtime backend: `backend-serializers.ts` | `SerializedContext.meaningDigest`, the `SemanticEquivalenceOracle`'s cross-run tree-equality comparison, and the `ContextCapacityEstimatorPort` surface named alongside it | portable persistent | Private `canonicalJson()` (`backend-serializers.ts:59-65`), a second, independent recursive serializer with ambient `localeCompare` member order — not the same function as `context-compiler.ts`'s | **Understated by the original T2 inventory**, which covered `context-compiler.ts` and `source-snapshots.ts` but not this file; routed here by AD-015 (`.specs/STATE.md`: "each carry a private `canonicalJson()` that orders keys with ambient `localeCompare`"). Migrate together with T4e — same portability property (two independently provisioned runs' semantic-equivalence comparison must not diverge by machine locale), same package. |
| Policy: `cedar-policy.ts` | Policy view/evidence material and normalized layer order | authority; classified transient with a discard migration (T4d) — see rationale below | **Migrated (T4d).** `canonicalizeJsonV2` replaces the recursive serializer; the per-layer policy-key sort (which also fixes `#compile`'s validation-iteration order, not just digest input) uses code-unit comparison instead of `localeCompare`. | Done. `tests/unit/policy-hardening.test.mjs`'s "policy digest is independent from insertion order", 35 existing policy cases unchanged. |
| Agent runtime context: `context-compiler.ts` | Snapshot ID, recipe, semantic-obligation, serialized-meaning and manifest digests | portable, in-memory only; classified transient (T4e) — see rationale below | **Migrated (T4e).** `canonicalizeJsonV2` replaces the recursive serializer; `rank()`'s tie-break and every collection sort now use code-unit `<`/`>` instead of `localeCompare`. | Done. `tests/unit/context-compiler.test.mjs`, `tests/security/context-compiler-security.test.mjs` (53 cases, including 24 permutation-invariance properties and the `rank()` stability case). |
| Agent runtime discovery: `source-snapshots.ts` | Context source snapshots, fact alternatives and selector material | portable, in-memory only; classified transient (T4e) — see rationale below | **Migrated (T4e).** `canonicalizeJsonV2` replaces the recursive serializer; selector, fragment, claim, and contradiction sorts now use code-unit `<`/`>` instead of `localeCompare`. | Done. `tests/unit/context-recipe.test.mjs`, `tests/contract/context-source-ports.test.mjs`, `tests/security/confluence-readonly-security.test.mjs` (63 cases, including a cross-locale recipe-digest test). |
| Agent runtime backend: `backend-serializers.ts` | `SerializedContext.meaningDigest`, the `SemanticEquivalenceOracle`'s cross-run tree-equality comparison, and the `ContextCapacityEstimatorPort` surface named alongside it | portable, in-memory only; classified transient (T4e) — see rationale below | **Migrated (T4e).** Private `canonicalJson()` (was `backend-serializers.ts:59-65`) removed; `canonicalizeJsonV2` used for both the outbound serialization and the Oracle's cross-run comparison. | Done. `tests/contract/context-serializers.test.mjs`, `tests/security/context-serializer-security.test.mjs` (42 cases, including 6 cross-backend Oracle-equivalence tests). |
| Policy: `cedar-policy.ts` | Policy view/evidence material and normalized layer order | authority | Recursive serializer and locale ordering | Version policy-view evidence; policy decisions never compare V1 and V2 digests as equal. |
| Data probe: `database-knowledge.ts` + `index.ts` + `sqlserver-adapter.ts` + `sqlite-adapter.ts` + `sap-ase-adapter.ts` + `postgresql-adapter.ts` + `oracle-adapter.ts` + `mysql-family-adapter.ts` + `mongodb-adapter.ts` | Source, fact-value, knowledge-package, promotion-plan, and per-engine parsed-operation digests | classified transient (T4h) — see rationale below | **Migrated (T4h).** `canonicalizeJsonV2` replaces each file's independent recursive serializer; every functional sort (columns, entities, sources, facts, scenarios, per-engine parsed objects) now uses code-unit `<`/`>` instead of `localeCompare`. | Done. `tests/unit/database-knowledge.test.mjs` (cross-locale test) plus the full per-engine contract/security/integration suites, 523/528 cases unchanged (5 pre-existing Node-version-gap failures on this machine's `node:sqlite`, unrelated to this change and reproduced on `upstream/main` before it). |
| Connectors: `confluence/architecture-source.ts` + `confluence/delivery-projection.ts` + `jira/jira.ts` | Confluence revision and fragment identities, delivery section/content digests and plan equality, Jira projection digest and idempotency key | portable boundary identities; no installed base (verified byte-identical before and after) | **Migrated (#58 connectors slice).** `canonicalizeJsonV2` replaces all three private recursive serializers; the eight ordering sites that feed a digest or an observable read order use `normalizeDeclaredSet`. Raw-string digests (page bodies, attachment content) stay raw-byte digests. Ordering that mirrors the provider API (pagination, remote page order) is untouched. | Done. Six cross-locale cases across `tests/contract/confluence-readonly-contract.test.mjs`, `confluence-delivery-contract.test.mjs`, and `jira-connector-contract.test.mjs`. Discrimination verified for architecture-source and jira; the delivery pair are regression guards only, because that file encoded both sides of its comparison with the same serializer so ambient collation cancelled out. |
| Memory: `memory-lifecycle.ts` + `memory-retriever.ts` + `memory-store.ts` + `memory-vector-index.ts` | Promotion and GC plan identities, managed object ids, ingestion generation and manifest identities, retrieval and fragment identities, vector generation digest and persisted row order | persistent; no installed base | **Migrated (#58 memory slice).** `canonicalizeJsonV2` replaces four private recursive serializers across 27 sites; all 10 `localeCompare` sites replaced with explicit code-unit comparison. The fragment sort key was doubly broken: ICU treats its ` ` field separator as completely ignorable, so the old key collapsed the field boundary as well as varying by locale. | Done. Nine cross-locale cases across memory security and integration suites, each pinning code-unit order explicitly so coincidental agreement cannot pass. Discrimination verified: reverting the four sources fails exactly those nine. |
| Agent runtime: `discovery/discovery-router.ts` + `models/model-router.ts` + `models/passport-registry.ts` + `skills/governed-skill-registry.ts` | Intake, decision and packet digests; model-selection rank order; Passport endpoint identity, candidate and drift digests; Skill lock digest and plan id | portable; no installed base (no durable Passport, Skill-lock, or packet store exists) | **Migrated (#58 agent-runtime slice).** `canonicalizeJsonV2` replaces three private serializers; all 8 `localeCompare` sites replaced. `model-router.ts` had no canonicalizer at all — its ordering *is* the selection decision, since the string tiebreak is rank's final component, so ambient collation could route the same roles to a different provider from the same Machine Profile. The V1 leniency of dropping `undefined` members is preserved explicitly through the new domain primitive `dropUndefinedMembers` rather than three private copies. | Done. Six cross-locale cases across discovery, model-router, passport-registry, governed-skill-registry and skill-lifecycle suites, plus five cases pinning the new domain primitive. Discrimination proven with per-file mutants: discovery digests diverge, model-router picks a different Passport, capability order flips, and a sealed Skill lock fails `VES_SKILL_LOCK_TAMPERED`. |
| Distribution: `hermetic-bundle.ts` | Release manifest/release digest | signed + persistent release identity | Recursive serializer and locale component ordering | Highest-risk slice: publish a new bundle schema/release format and retain V1 verification. |
| Distribution: `artifact-inputs.ts` | File-backed component content digests | raw bytes; resulting bundle is V2 | SHA-256 over build bytes; structured closure delegated to `hermetic-bundle.ts` | T76 T4 input collector; source/root paths are never emitted. |
| Distribution: `release-candidate.ts` | T76 candidate closure digest | signed + persistent candidate identity | Candidate body canonicalization | Uses the V2 contract and binds all four views, evidence kinds, and rollback proof. |
| Distribution: `supply-chain-evidence.ts` | Unsigned T76 license, SBOM, provenance, and evaluation documents | portable release evidence inputs | Canonical V2 bytes plus SHA-256 content digests | Deterministic generator/verifier; signatures and TUF publication remain separate T76 tasks. |
| Distribution: `tuf-publication.ts` | TUF root, delegated metadata, snapshot/timestamp metadata, and target identities | external TUF repository integrity | TUF's external canonical JSON for signed metadata plus raw SHA-256 byte identities | Deliberately follows the `tuf-js` standard; it does not create a second Verchestra portable-digest contract. |
| Distribution: `transactional-activation.ts` | Transaction identity material and durable activation records | persistent local state | Recursive serializer for transaction identity; ordinary JSON writes for local journals | Migrate only after hermetic bundle V2; version durable receipt/pointer records. |
| Distribution: `tuf-update-client.ts` | Staged receipt bytes | persistent local state | Ordinary `JSON.stringify`, no structured digest at write | Keep bytes as a versioned local receipt; classify separately from canonical digest migration. |
| Workspace: `scanner/scanner-primitives.ts`, consumed by `workspace-scanner.ts`, `init/safe-init.ts`, and `placement/artifact-placement.ts` | Repository IDs, discovery keys, inventory fingerprints, init/recovery plan IDs, and write-plan IDs | portable + persistent plan identity | **Migrated (T3).** `buildInventoryFingerprintV2` (RFC 8785, `v2:sha256:` prefix) for repository IDs, discovery keys, inventory fingerprints, write-plan IDs, and new init preview/recovery journal plan IDs; `buildInventoryFingerprint` (V1, byte-identical, `sha256:` prefix) stays exported and is still the only verifier for a `schemaVersion: 1` init recovery journal. | Done. `init/safe-init.ts`'s recovery journal envelope carries an explicit `schemaVersion` (1 or 2) and dispatches its verifier on that recorded version, failing closed on any version/prefix disagreement — see `packages/workspace/src/init/safe-init.ts:parseRecoveryJournal`. |
| Platform Node: `git-worktree-adapter.ts` | Worktree `changeDigest`, committed and verified as `Verchestra-Change` by the gate-commit flow | persistent gate authority | SHA-256 of `JSON.stringify(manifest)` — an **array** of `[path, hash]` tuples, not an object | **No change required (T4c).** `manifest` is an array, and its element order already derives from `changedPaths`'s plain `.sort()` (default UTF-16 code-unit order, not `localeCompare`) — `JSON.stringify` on an array preserves index order and never reaches the object-key-ordering branch that makes `canonicalJson`/`localeCompare` risky. Confirmed zero `.localeCompare(` sites; this file was never the risk the T2 inventory named — `gate-commit.ts`'s own serializer was. | Verified, no commit needed; `tests/security/canonical-json-locale-allowlist.test.mjs`'s existing ceiling (0) for this file is unchanged. |
| Platform Node: `runtime-store/runtime-store.ts` | Persisted active policy-view digest verification | persistent local authority | Recursive serializer with ambient locale ordering | Migrate with policy-view schema/versioning; retain V1 stored-view verification and fail closed across versions. |
| Platform Node: `git-worktree-adapter.ts` | Worktree `changeDigest`, committed and verified as `Verchestra-Change` by the gate-commit flow | persistent gate authority | SHA-256 of `JSON.stringify(manifest)` | Version change-digest material with the gate plan/checkpoint/receipt migration; retain V1 resume verification. |
| Platform Node: `runtime-store/runtime-store.ts` | Persisted active policy-view digest verification | persistent local authority; classified transient with a discard migration (T4d) — see rationale below | **Migrated (T4d).** `canonicalizeJsonV2` replaces the recursive serializer in `getActivePolicyView`'s reverification. Migration `010_policy_view_digest_reencoding` discards rows saved under the old encoding. | Done. `tests/integration/policy-view-digest-reencoding-migration.test.mjs`, 5 existing `policy-activation-runtime.test.mjs` cases unchanged. |
| Application promotion: `promotion-gate.ts` | `canonicalizeOracle`'s sealed `holdoutDigest`; the `evaluatePromotion` `blocks` ordering feeding the report `bodyDigest` | signed persistent identity | **Migrated (T4a).** `canonicalizeJsonV2` + `normalizeDeclaredSet` for both the oracle entries and the accumulated blocks; no persisted fixture pinned the prior bytes, so this required no schema/version bump. | Done. Commit `75dab72`; `tests/unit/promotion-gate.test.mjs` (cross-locale + declaration-order tests), `tests/security/canonical-json-sensor.test.mjs` (owner mutation). |
| Application regression: `campaigns.ts` | Campaign ordering inside `canonicalizeCorpus`/`buildCampaignSummary`, validated against `regression-campaign-summary@1` | persistent (schema-validated release evidence) | **Migrated (T4a).** `buildCampaignSummary` normalizes results with `normalizeDeclaredSet` before assembly; `canonicalizeCorpus` (the actual `corpusDigest` input) already had zero locale dependency. | Done. Commit `7f1adc4`; `tests/unit/regression-campaigns.test.mjs`, `pnpm test:release` (28 cases, frozen 22-campaign corpus unaffected). |
| Application doctor: `doctor.ts` | `sortedUnique` orders capability/check lists inside the sealed, signed `doctor-report` payload | signed persistent identity | **Migrated (T4a).** `sortedUnique` now normalizes through `normalizeDeclaredSet`. | Done. Commit `6ccb1c7`; `tests/unit/doctor-rules.test.mjs` (cross-locale test), all 62 existing doctor cases unchanged. |
| Application self-test: `self-test.ts` (`semanticFingerprint`, line ~292) | Ordered `checkId:status` pairs, compared directly by `assertConvergence` across two independently provisioned runs; not itself hashed or sealed in this file | presentation (direct list comparison, not a digest input) — migrated anyway, see resolution | **Migrated (T4a).** Classified presentation by the matrix's own digest/signature test, but migrated regardless: locale-dependent order could make two genuinely convergent runs compare as non-convergent (`VES_SELFTEST_NONCONVERGENT`) under different ambient locales — a portability defect even without a signed digest at stake. | Done. Commit `4cd6afa`; `tests/unit/self-test-scenario-rules.test.mjs` (cross-locale test). |
| Evidence: `execution-package/execution-package.ts` | Declared package sets, payload digest, artifact ID, DSSE statement, and persisted envelope | signed + persistent authority | **Migrated (signed-evidence Execution Package slice).** New packages emit `schemaVersion: 2`, the declared V2 in-toto predicate, RFC 8785 bytes through the domain facade, and code-unit ordering for every set-like package list. Schema V1 keeps its V1 digest and predicate, and AD-018 normalizes its set ordering from ambient `localeCompare` to an explicit UTF-16 code-unit comparator; no ambient locale remains. That normalization changes rebuilt V1 ordering for identifier sets that differ only by case, which stored-artifact verification does not depend on. A V1 artifact cannot be reinterpreted as V2. Run Capsule, Recovery Bundle, Support Bundle, and release artifacts remain separate pending slices. |

## T4 slice ordering

T4 (issue #58's remaining ~15 owners) is executed as ten independently
reviewed slices, sequenced by risk and by whether the owner's bytes are
already qualified/persisted. Constraints below are the matrix's own
migrate-together and migrate-after rules.

| Slice | Owners | Risk | Rationale |
| --- | --- | --- | --- |
| T4a | `promotion-gate.ts`, `campaigns.ts`, `doctor.ts`, `self-test.ts` | Low | **Done.** Merged by T72–T74 (2026-08-07); no `docs/qualification/t72\|t73\|t74-validation.md` existed at migration time, so these bytes had never been frozen — zero backward-compatibility work required. Added `formatCanonicalDigestV2` (the shared `v2:sha256:` prefix authority) to domain and a repo-wide ambient-locale ceiling sensor (`tests/security/canonical-json-locale-allowlist.test.mjs`) as reusable infrastructure for every remaining T4 slice. |
| T4b | `authority.ts`, `work-claims.ts` | Medium (reclassified transient, see below) | Persistent authority bindings, migrated as a direct swap. |
| T4c | `gate-commit.ts` + `git-worktree-adapter.ts` `changeDigest` | Medium-high (reclassified transient, see below) | Durable resume path, migrated as a direct swap; `git-worktree-adapter.ts` needed no change (already locale-safe). |
| T4d | `cedar-policy.ts` + `runtime-store.ts` | Medium | Matrix requires migrating together (policy-view schema/versioning). |
| T4c | `gate-commit.ts` + `git-worktree-adapter.ts` `changeDigest` | Medium-high | Durable resume path; migrate together per the matrix. |
| T4d | `cedar-policy.ts` + `runtime-store.ts` | Medium (reclassified transient with a discard migration, see below) | Migrated together as required; a discard migration replaces schema/versioning. |
| T4e | `context-compiler.ts` + `source-snapshots.ts` + `backend-serializers.ts` | Medium | Matrix requires migrating together; `backend-serializers.ts` added to the slice by the T2 re-inventory above (AD-015). |
| T4e | `context-compiler.ts` + `source-snapshots.ts` + `backend-serializers.ts` | Medium (reclassified transient, see below) | **Done.** Matrix requires migrating together; `backend-serializers.ts` added to the slice by the T2 re-inventory above (AD-015). |
| T4f | `trust-egress.ts`, `handoff/validation.ts` | Medium | Portable persistent identities. |
| T4f | `trust-egress.ts`, `handoff/validation.ts` | Medium (reclassified, see below) | **Done.** Portable persistent identities. |
| T4g | `workspace-reconcile.ts`, `effect-contract.ts` | High | Durable idempotency keys. |
| T4g | `workspace-reconcile.ts`, `effect-contract.ts` | High | **Done.** The effects part was completed as the reviewed T4i versioned-identity vertical rather than an unsafe direct swap. |
| T4h | `database-knowledge.ts` + 7 adapters | Medium | Wide fan-out, uniform pattern. |
| T4h | `database-knowledge.ts` + 7 adapters | Medium (reclassified transient, see below) | **Done.** Wide fan-out, uniform pattern. |
| T4i | `canonical.ts` V1 facade + `execution-package.ts` | Highest | **In progress.** The Execution Package slice is migrated with version-gated V1 verification; the remaining signed-evidence owners are separate follow-up slices. |
| T4j | `hermetic-bundle.ts` then `transactional-activation.ts` | Highest | Release identity; matrix requires this order. |
| T4i | `canonical.ts` V1 facade + `execution-package.ts` | Highest | **In progress.** The Execution Package emits schema V2 with code-unit set ordering; its V1 envelope remains verifiable by recorded schema. |
| T4j | `hermetic-bundle.ts` then `transactional-activation.ts` | Highest | **Deferred, see below.** Release identity; matrix requires this order. |
| T4j | `hermetic-bundle.ts` and `transactional-activation.ts` | Highest | **Done — direct swap, not the versioned facade this row previously prescribed.** See "Completed vertical slice (T4j)" below: re-verified fresh that no installed base exists (`releaseDigest: null`, no pinned digest fixture anywhere), the same bar T4b already used. | 
| T4i | `execution-package.ts` | Highest | **Done — narrower than deferred, see "Completed vertical slice (T4i)" below.** `canonical.ts`/`ArtifactSealer` needed no change; the fix is entirely local to `execution-package.ts`'s own pre-sort comparators, gated by widening its `schemaVersion` field to `1 \| 2`. |

`tuf-update-client.ts` stays classified separately (no structured digest at
write) and is not a T4 slice.

### T4b classification: transient, not archival

`authority.ts`'s `bindingDigest`/`CapabilityGrant` digests and
`work-claims.ts`'s `scopeDigest` are genuinely persisted (a real SQLite
`claims` table keyed by `scope_digest`; `RuntimeAuthorityStore` for approval
records) — measured, not assumed. That alone would put them under
compatibility rule 1 (versioned dual-verification, matching T3's init
journal). They were migrated instead as a direct swap (rule 3, transient)
because, unlike T3's init journal or T4i's Execution Packages:

- every record type declares `expiresAt` — approvals, capability grants, and
  work claims are short-lived working authorization state, not archival
  evidence meant to outlive a session;
- no test or fixture anywhere pins a specific digest byte value for either
  file (confirmed by search: every digest in every test is computed live,
  never compared against a literal string);
- this is pre-1.0 local developer state with no installed base — the same
  "no installed base, regenerable content" reasoning AD-014 used for the
  DSSE migration.

The practical consequence of getting this wrong in either direction is
bounded: a record created just before the algorithm changed would fail its
next verification until it naturally expires (minutes to hours, per
`validTtl`'s bound), not a permanent loss of archival evidence.

This classification was not made unilaterally by the implementing agent: the
row-1-vs-row-3 ambiguity was raised explicitly and the transient
classification was chosen by brunomjanuario (WS-C) before implementation
(2026-08-11), following the AD-009/AD-014 pattern that a boundary-widening
call on trust-critical code should not be assumed silently. It is **not**
an owner (accd) decision recorded as an AD — flagged here for human review
alongside the code change, not asserted as settled.

### T4c classification: transient, traced not assumed

`gate-commit.ts`'s plan/checkpoint/idempotency digests are also genuinely
persisted — a checkpoint saved via `#save()` is later reloaded and
re-verified by `#normalizePrior()` on resume, and the same mechanism is
exercised by the Self-Test full-profile crash-recovery matrix through a real
durable `FileRecordStore`. This is a materially different case from T4b:
approvals and claims are short-lived tokens; a gate checkpoint represents
in-progress task-execution work, and the matrix's own text already called
this slice "Medium-high — durable resume path" (higher than T4b's "Medium").

The classification was not reused from T4b by analogy — it was re-derived by
tracing every comparison in `#normalizePrior` and `normalizeInput` line by
line: `planDigest`/`gateEvidenceDigest`/`checkpointRef` values are always
compared **within the same `execute()` call**, between a value freshly
recomputed by the currently-running code and either (a) a caller-supplied
value from the same call (never a problem — both sides use the same running
canonicalizer) or (b) a checkpoint loaded from storage and compared by plain
string equality against a fresh recomputation (`row["gatePlanDigest"] !==
input.gatePlan.planDigest`, `#normalizePrior`). Case (b) is the real risk: a
checkpoint saved under the old canonicalizer, reloaded after the algorithm
changed, produces a byte-different fresh digest and the equality check
fails — but `#normalizePrior` fails **closed**
(`VES_GATE_CHECKPOINT_INVALID`, caught by its caller as `resumed ===
undefined`), which forces the gate sequence to re-run from the top rather
than silently accepting stale or incorrectly-verified state. No exported
function (`canonicalTaskGatePlan`) is called anywhere to pre-compute and
durably cache a digest that crosses a deploy boundary before being replayed
against a later release — confirmed by finding every call site.

The consequence of getting this wrong is therefore bounded to "redo the gate
run" at the exact moment of an algorithm change, not a security or
correctness failure — worse than T4b's "re-approve a token" (real test gates
may be expensive to re-run) but still fail-closed, still bounded to a single
transition point, and confirmed empirically: `tests/integration/
gate-commit.test.mjs`'s "gates-passed checkpoint is durable before the
commit effect" test and the full 29-case Self-Test crash-recovery suite
(including "the production crash matrix satisfies the closed application
verdict") both pass unchanged after the swap. Also chosen by brunomjanuario
(WS-C) before implementation (2026-08-11); flagged for accd's review, not
asserted as settled.
**Correction learned during T4d:** after this slice's PR (#259) merged, review
found that "transient, not archival" alone was insufficient — a claim written
under the old encoding was not *invalidated* by the transition, it was
*orphaned*: silently unmatchable forever, breaking the mutual exclusion
`scopeDigest` exists to provide. The fix (`ed60005`) added migration
`008_claim_digest_reencoding` (`DELETE FROM claims;`) to discard pre-existing
rows. The same gap existed in `authority.ts` (fixed separately, PR #268,
migration `009_authority_binding_digest_reencoding`) and is applied
pre-emptively in T4d below, rather than discovered after the fact a third
time: **a transient classification is only complete once paired with a
discard migration for any table the digest is persisted in** — the
classification alone does not make old rows safe, only invalidating them does.

### T4d classification: transient, with a discard migration from the start

`cedar-policy.ts`'s `policyViewDigest` and `runtime-store.ts`'s
`active_policy_views.view_digest` are genuinely persisted, and
`getActivePolicyView` recomputes the digest **on every load** (not just
resume-after-crash) and compares it by equality against the stored value —
higher-frequency exposure than either T4b or T4c. Applying the correction
above from the start: this slice pairs the canonicalizer swap with migration
`010_policy_view_digest_reencoding` (`DELETE FROM active_policy_views;`) in
the same commit, rather than shipping the swap alone and waiting for a
review to find the gap.

Nothing in the product wires `RuntimePolicyViewStore` into a composition root
yet (confirmed by search, same as `RemoteClaimPort` in T4b and the
checkpoints port in T4c) — this is workspace-local cache state with no
installed base, the same "no installed base, regenerable content" reasoning
AD-014 used for the DSSE migration and T4b/T4c used here. The classification
was chosen by brunomjanuario (WS-C) before implementation (2026-08-11);
flagged for accd's review, not asserted as settled.
### T4e classification: transient, no persistence adapter at all

`context-compiler.ts`, `source-snapshots.ts`, and `backend-serializers.ts` all
compute and consume their digests (`snapshotId`, `recipeDigest`, `findingId`,
`contradictionId`, `manifestId`, `semanticObligationsDigest`,
`serializedMeaningDigest`, `SerializedContext.meaningDigest`) within the same
call — either freshly recomputed and compared in-memory (the `snapshotId`
reverification in `context-compiler.ts`, the payload/meaning-digest checks in
`backend-serializers.ts`'s `SemanticEquivalenceOracle`), or returned directly
to the caller with no round-trip through storage.

Unlike T4b's `authority.ts`/`work-claims.ts` (measured to have a real SQLite
table keyed by the digest), this package has **no persistence adapter wired
at all**: `grep -rln "SourceSnapshot\|source-snapshots" packages/platform-node/src/`
and a search for `writeFile`/`readFile` under
`packages/agent-runtime/src/context/` both return nothing. There is no table
to orphan and no discard migration required — the T4b/`ed60005` gap (a
transient classification that turned out to have a persisted table, requiring
a follow-up discard migration; see the T4b section above) does not apply here
because there is no persisted table in the first place, not because the
consequence of a stale row was judged acceptable.

The classification was made following the same process as T4b/T4c/T4d: not
asserted unilaterally, chosen by brunomjanuario (WS-C) consistent with the
established row-3 (transient) criteria, and flagged here for human review
rather than settled as an owner (accd) decision.
### T4f classification: transient egress, provably locale-invariant handoff

`trust-egress.ts` has no persistence adapter wired at all (confirmed by grep
for `egressDigest`/`trust-egress` under `packages/platform-node/src/` and
`apps/vestra-cli/src/`; the one hit in `self-test-full-scenario.ts` is an
unrelated literal stub, not the real firewall computing a digest) — the same
"no adapter, no table to orphan" argument as T4e.

`handoff/validation.ts`'s `canonical()` is different in kind from every prior
T4 slice: its output genuinely is persisted to disk (`FileRecordStore`, wired
in `apps/vestra-cli/src/self-test-full-scenario.ts`), and handoff artifacts
are explicitly designed to be read back by a different, later process — the
whole point of a portable handoff (AGENTS.md: "the handoff lets a clean-clone
successor resume"). That is exactly the scenario compatibility rule 3
(transient) does not cover, and the matrix's own original row correctly
flagged this as "portable persistent," recommending versioning.

The migration was still done as a direct swap, not because the persistence
risk was judged acceptable (T4b's reasoning) but because the risk **cannot
materialize for this specific data shape**: `canonical()`'s only
locale-sensitive behavior is its object-member (key) sort order, and every
object canonicalized through this function — `PreparedArtifact`,
`PackageProof`, the publication idempotency-key material, the local-bindings
digest material — has a fixed, compile-time-known set of ASCII camelCase
schema field names as keys (`workspaceId`, `handoffId`, `packageDigest`, and
so on), never a dynamic or untrusted string. `localeCompare` and code-unit
comparison order identical ASCII identifier sets identically; there is no
input this function can receive, now or later, that would let the two orderings
diverge. (Values inside those objects are separately constrained to
`SAFE_VALUE`-pattern ASCII tokens or digests before being included, but that
constraint is not what makes this safe — arrays are never re-sorted by
`canonical()`, only object keys are, and those keys are the closed schema set
above regardless of what the values contain.) This is a stronger guarantee
than T4b's "no test pins a byte value" argument: T4b argued the consequence of
a mismatch was bounded and transient, T4f argues the mismatch is structurally
impossible for the data this function is ever called with.

This classification was not made unilaterally by the implementing agent, per
the same process as T4b/T4d/T4e: chosen by brunomjanuario (WS-C), flagged here
for human review, not asserted as an owner (accd) decision.
### Historical T4g classification: workspace-reconcile migrated, effect-contract deferred

`workspace-reconcile.ts`'s `stateDigest` is genuinely persisted and
reverified against a freshly recomputed digest on every `execute()` call
(`this.#digest.sha256(canonicalJson(stateMaterial)) !== recordedDigest`,
`packages/application/src/sync/workspace-reconcile.ts`) — a real durable
comparison, not a same-call round trip. It is still migrated as a direct swap
using the same argument as T4f's handoff case, extended to array sort order:
every object canonicalized here (`PersistedSyncState`, `ReconcileOperation`,
`PlannedEffect`, `LocalRebuildRequirement`) has fixed ASCII schema field names
as keys, and every ID used as a sort key (`projectId`, `projectionId`,
`manifestId`, `operationId`, `effectId`) is a `StableId` value
(`packages/domain/src/primitives/stable-id.ts`), constrained by regex to
lowercase ASCII letters, digits, and hyphens in a fixed `kind_uuid` shape.
Neither the member-key order nor the array-sort order this function produces
can diverge between `localeCompare` and code-unit comparison for this data
shape, so a digest recorded before this migration reverifies unchanged after
it.

At the time of this classification, `effect-contract.ts` was **not** migrated
in that slice, despite T4 slice
ordering originally grouping it with `workspace-reconcile.ts`. It is a
materially different case: `buildIdempotencyKey` uses plain `JSON.stringify`
on a fixed-order object literal, which has no ambient-locale dependency at
all — there is nothing for issue #58's actual contract (removing
`localeCompare`-driven nondeterminism) to fix here, and the ambient-locale
allowlist sensor already has this file at ceiling 0. Migrating it to
`canonicalizeJsonV2` anyway would be a *different* change — reordering the
serialized material to alphabetical — which would silently change the
`idempotencyKey` for every existing and in-flight effect intent. Unlike every
other owner migrated so far, `EffectIntent` has no `expiresAt`: it is durable
until completed, looked up by exact key string in a real SQLite table
(`createEffectRepository`'s `insertOrGet`/`readIntent`,
`packages/platform-node/src/runtime-store/runtime-store.ts`), and a key
mismatch does not fail closed — it silently inserts a second intent for the
same logical operation, defeating the at-most-once guarantee the mechanism
exists for. The matrix's own row already specifies the correct fix ("Add a
versioned effect identity material and retain V1 key lookup for existing
intents and receipts"), which is a distinct, larger unit of design and review
work, not a same-shape direct swap. It was left for the dedicated T4i
follow-up rather than folded into T4g's "no pauses" cadence. T4i now closes
that follow-up with an explicit V1/V2 discriminator, additive runtime
migration, logical-identity convergence, and discriminating tests; the
current matrix row above is authoritative for the resulting state.

Both historical classifications were made following the same process as prior
T4 slices: not asserted unilaterally, chosen by brunomjanuario (WS-C), and
flagged here for human review.
### T4h classification: transient, no persistence adapter anywhere in the package

`packages/data-probe` declared zero dependencies before this migration
(confirmed via its `package.json`) and has no real durable adapter for any of
its digest-bearing types (`DatabaseKnowledgePackage`, `DatabaseSchemaSource`,
`PromotedProbeEvidence`, `ProbePlan`, `DatabaseRegistration`, and each
engine's `*ConnectionPlan`) — confirmed by grep across
`packages/platform-node/src/` and `apps/vestra-cli/src/`: the only store
implementation for `DatabaseRegistrationStorePort` is
`MemoryDatabaseRegistrationStore`, an in-memory fixture, not a real adapter.
Every digest comparison in this package (`packageDigestOf(...) !==
packageValue.packageDigest`, `promotedEvidenceDigestOf(...) !==
evidence.evidenceDigest`, each adapter's `canonical(operation) !==
canonical(plan.operation)`) recomputes fresh from a value passed into the
same call, never from a value reloaded from storage after a time gap. Same
argument as T4e/T4f-trust-egress: no adapter, no table to orphan.

`packages/data-probe/package.json` had no dependency on `@verchestra/domain`
before this slice; it is added here (workspace protocol, `pnpm-lock.yaml`
updated) so all nine files can use the shared `canonicalizeJsonV2` primitive.

This classification was made following the same process as prior T4 slices:
not asserted unilaterally, chosen by brunomjanuario (WS-C), flagged here for
human review, not asserted as an owner (accd) decision.
### T4i versioned Execution Package; T4j remains deferred

T4b through T4h (this issue's other nine owners) were each migrated as a
direct swap after confirming, case by case, that either no persistence
existed or the exact character set of every sorted/keyed value made a
`localeCompare`-vs-code-unit divergence structurally impossible (fixed ASCII
schema field names, or `StableId`-constrained lowercase-only values). T4i and
T4j do not clear that bar. T4i therefore uses a versioned migration; T4j remains
deferred rather than being forced through the direct-swap pattern:

- `execution-package.ts` previously had 11 pre-sort `.localeCompare(` sites ordering
  `artifactId`, `requirementId`, `taskId`, `role`, `gateId`, `criterionId`,
  and `field` values before they are fed into the qualified V1
  `canonicalizeJson`/`sha256Digest` (`canonical.ts`, itself untouched and
  already `localeCompare`-free). These values are validated only against the
  broad `SAFE` pattern (`/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u`), which
  permits mixed case — and real fixtures use it (`taskId: "T-1"`). Mixed-case
  ASCII is exactly the case where default locale collation and code-unit
  comparison *can* disagree (locale collation commonly treats case as a
  tertiary tie-break; code-unit comparison puts every uppercase letter before
  every lowercase letter). Unlike T4h's `StableId` values, there is no
  charset-level guarantee here. This is signed evidence
  (`packages/evidence/src/integrity/canonical.ts`'s own row: "Preserve V1
  verification; introduce V2 facade only with envelope/schema versioning"),
  and the DSSE-wrapped payload (AD-014, #217/#242) is durably persisted via
  `FileRecordStore` in the real execution flow
  (`apps/vestra-cli/src/self-test-full-execution.ts`). A sort-order change
  that silently changes the payload digest for an existing signed package is
  exactly the kind of migration compatibility rule 1 exists to prevent. The
  Execution Package slice keeps schema V1 verification working against stored
  bytes, and AD-018 normalizes V1's rebuild ordering onto the same explicit
  UTF-16 code-unit comparator rather than preserving its ambient collation;
  new schema V2 packages use the domain RFC 8785 facade, code-unit ordering,
  and the declared V2 predicate. V1 and V2 cannot be reinterpreted as each
  other. That normalization is an accepted, recorded exception to rule 1 for
  this owner only, taken while no V1 artifact exists outside the fixtures.
- `hermetic-bundle.ts` has the same shape (a private recursive `canonical()`
  plus a `componentId` sort using the same broad, case-permitting pattern) for
  a release manifest digest — signed release identity, the highest-stakes
  surface in the whole matrix. `transactional-activation.ts` is explicitly
  ordered *after* `hermetic-bundle.ts` by the matrix and was not reached.

The remaining signed-evidence owners and T4j need the versioned-facade design
the matrix already specifies (preserve V1 verification, introduce a V2 facade
gated by an explicit schema or envelope version, never compare a V1 and V2
digest as equal) as their own reviewed units of work. The Execution Package
ceiling is now zero: V1 compatibility is expressed with an explicit UTF-16
code-unit comparator, so it does not require an ambient `localeCompare`
exception. T4j remains at its original ceiling.

The Execution Package V1 normalization was reviewed against git history before
landing, which is how the earlier "preserves the historical `Array#sort` bytes"
framing was found to be false and replaced by the AD-018 decision recorded in
`.specs/STATE.md`. Recording it as a normalization, not a preservation, is the
point: the compatibility rule it bends stays intact for every other owner.

## Completed vertical slice (T3)

T3 was the Workspace identity vertical: the scanner inventory, placement write
plan, and safe-init preview/recovery journal shared `buildInventoryFingerprint`
and were versioned together without changing signed evidence or release
formats. It retains V1 verification for existing journals and plans, emits an
explicit V2/canonicalization version only for new records, and proves
cross-locale equivalence plus the code-unit/locale-ordering discrimination
sensor (`tests/security/canonical-json-sensor.test.mjs`).

Before implementation, the owner had to explicitly approve either widening
`scripts/architecture.mjs:67-69`'s third-party import boundary to move or add
the qualified `canonicalize@3.0.0` dependency into `packages/domain` (with the
required lockfile update), or separately approve an equivalent internal RFC
8785 implementation and its vector review. This was a dependency, architecture
boundary, and qualification decision, not an implicit T3 implementation
detail. The owner approved the internal encoder, 2026-08-01 (see "Contract
decision" above and `.specs/features/canonical-json/design.md`, "Tech
Decisions").

## Completed vertical slice (T4i)

T4i was the signed-evidence vertical (`packages/evidence/src/execution-package/execution-package.ts`),
resumed under `.specs/features/canonical-json-t4i-signed-evidence/` after
issue #58 was reopened (it had been closed by an unrelated PR whose own
description said it did not intend to close #58). Its scope came out
substantially narrower than the "deferred, not attempted as direct swaps"
analysis above concluded, on two points discovered and verified — not
assumed — while implementing:

1. **`ArtifactSealer` needed no change.** The original assumption was that
   the shared sealing primitive (`packages/evidence/src/integrity/artifact-sealer.ts`)
   would need canonicalization-version awareness, since it is used by every
   sealed artifact type. Tracing its actual digest calls and testing directly
   (`canonicalizeJson({list:["banana","Apple","cherry"]})` sorts object keys
   by code unit but leaves array order untouched) confirmed RFC 8785 never
   reorders arrays — the locale dependency was entirely upstream, in this
   file's own 11 `.localeCompare()` pre-sort call sites, not in the
   canonicalizer they feed into.
2. **The V1 comparator was normalized, not preserved (AD-018).** This file's
   comparator-based sorts have ordered with `localeCompare` since the file's
   first commit (`867ce74`), so ambient collation — not default `Array#sort` —
   is what produced historical V1 ordering. The version-gated helper that kept
   `localeCompare` for V1 was therefore byte-faithful, and replacing it with
   UTF-16 code-unit comparison is a deliberate normalization that changes
   rebuilt V1 ordering for identifier sets differing only by case. It is taken
   because verification of a stored V1 artifact compares stored bytes to the
   stored digest and never re-sorts, because no V1 artifact outside the fixtures
   exists, and because #58 requires zero ambient-locale ordering on trust
   surfaces. The regression covers every versioned collection; the pinned V1
   artifact remains verifiable and the census/allowlist now record zero
   ambient-locale sites. What is *not* claimed: that rebuilding a historical V1
   payload reproduces its original byte order. `derivePendingTasks` still carries the recorded
   schema version at its call boundary, although unique task sequences make
   its task-id tie-break unreachable for valid packages.

`ExecutionPackagePayload.schemaVersion` widened from the literal `1` to
`1 | 2`; `ExecutionPackageBuilder.build()` defaults to `schemaVersion: 2`
when the caller omits it, `schemaVersion: 1` remains explicitly
constructible. Both corrections and the final scope are recorded as AD-021
in `.specs/STATE.md`, flagged for human review like every other slice in
this chain.

## Completed vertical slice (T4j)

T4j was the release-identity vertical (`packages/distribution/src/hermetic-bundle.ts`
and `packages/distribution/src/transactional-activation.ts`), taken up under
`.specs/features/canonical-json-t4j-release-identity/` immediately after
T4i. This section above classified T4j as needing the same versioned-facade
treatment as T4i ("T4i and T4j do not clear that bar"); re-verifying that
claim fresh, rather than carrying it forward, found T4j actually clears the
bar T4b already used for a direct swap:

- `resolveReleaseIdentity().releaseDigest` is still `null`
  (`apps/vestra-cli/src/release-manifest.ts`) — no release has ever shipped,
  T76 has not landed a candidate, so no installed base of signed release
  bytes exists to invalidate.
- No test or fixture anywhere pins a literal `releaseDigest` byte string;
  every check across `tests/build/hermetic-bundle.test.mjs`,
  `tests/security/hermetic-bundle-security.test.mjs`,
  `tests/integration/transactional-activation.test.mjs`,
  `tests/security/transactional-activation-security.test.mjs`,
  `tests/fault-injection/transactional-activation-faults.test.mjs`,
  `tests/e2e/tuf-update-client.test.mjs`, and the helper fixtures is a
  regex/computed comparison.
- `transactional-activation.ts`'s own `canonical()`/`equal()` (used for
  in-flight drift and journal-target checks) is a same-tick in-memory
  equality check, never compared against a value persisted from a previous
  run — the same shape T4e/T4f/T4h already treated as transient.

Both files' private recursive `canonical()` serializers (each with their own
`.localeCompare(` object-key sort) are replaced outright with the qualified
`canonicalizeJsonV2` from `@verchestra/domain`; `hermetic-bundle.ts`'s
`components` array sort switches from `.localeCompare(` to unconditional
code-unit comparison. No `schemaVersion` widening or dual-path comparator —
this is a same-shape swap, matching T4b/T4h, not T4i's shape.
`packages/distribution` had zero declared dependencies before this slice;
`@verchestra/domain` (workspace protocol) is added, explicitly approved
2026-08-23, `pnpm-lock.yaml` updated.

`tests/build/hermetic-bundle.test.mjs`'s "release digest is byte-identical
across two divergent locale collations, for a mixed-case componentId set"
proves cross-locale determinism directly (mocked hostile `localeCompare`,
mixed-case `componentId` fixture); a manual mutation reverting the
`components` sort to `.localeCompare(` was confirmed to fail that test, then
reverted. `tests/security/canonical-json-locale-allowlist.test.mjs`'s
ceilings for both files are tightened to 0.

## Explicit exclusions

Only sources recorded as `presentation-or-fixture` in the mechanical census
are ordering exceptions. Source/document loaders, tests, and closed-field
checks such as `Object.keys(value).sort()` require classification before they
are treated as presentation or validation-only. They are not evidence that V2
has been adopted.

## Required proof for each migration PR

1. Cross-locale output and digest equality for Unicode member names and
   semantic identifier ordering.
   Satisfied for T3 (Workspace): `tests/unit/canonical-json-v2.test.mjs:86`
   ("the same input produces byte-identical output under two different
   ambient locales").
   Satisfied for T4i (Signed Evidence): `tests/unit/execution-package.test.mjs`
   ("schemaVersion: 2 sealed bytes are byte-identical across two divergent
   locale collations").
2. Equivalent rejection at the call boundary for undefined values, sparse
   arrays, accessors, cycles, non-finite numbers, depth and node limits.
   Satisfied for T3 (Workspace): `packages/domain/src/canonical/canonical-guard.ts`,
   exercised by `tests/unit/workspace-fingerprint-v2.test.mjs:41,45` and the
   guard's own unit suite.
   N/A for T4i (Signed Evidence): this vertical's fix is comparator ordering,
   not a new canonicalizer boundary — every existing shape/bounds check in
   `execution-package.ts`'s own `normalize*` functions is unchanged.
3. A V1 persisted/signed fixture verifies unchanged; a V2 fixture has an
   explicit schema or canonicalization version.
   Satisfied for T3 (Workspace): `tests/integration/safe-init.test.mjs`
   ("a pinned schemaVersion 1 journal written before this slice still
   verifies and recovers", "a schemaVersion 2 journal verifies and recovers
   with V2"); `tests/unit/workspace-fingerprint-v2.test.mjs:22` (pinned V1
   byte-identity).
   Satisfied for T4i (Signed Evidence): `tests/unit/execution-package.test.mjs`
   ("a schemaVersion: 1 package built before this change still verifies
   unchanged"; "ExecutionPackageBuilder.build() defaults to schemaVersion: 2
   when the caller omits it").
4. A discrimination mutation replacing code-unit/JCS ordering with ambient
   `localeCompare` is killed by the focused test.
   Satisfied for T3 (Workspace): `tests/security/canonical-json-sensor.test.mjs`
   (mutation A: locale ordering; mutation B: array-order sorting).
   Satisfied for T4i (Signed Evidence): manual mutation of the `decisions`
   sort comparator back to `.localeCompare(`, recorded in
   `.specs/features/canonical-json-t4i-signed-evidence/validation.md`,
   killed by the cross-locale determinism test above.
5. `pnpm gate:security` and the architecture boundary test pass.
   Satisfied for T3 (Workspace): `pnpm gate:security`,
   `tests/architecture/repository-boundaries.test.mjs`.
   Satisfied for T4i (Signed Evidence): `pnpm gate:security`,
   `tests/security/canonical-json-census.test.mjs`.
