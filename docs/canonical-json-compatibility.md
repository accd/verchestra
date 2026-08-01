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

## Trust and persistence inventory

| Owner and current path | Current material / consumer | Classification | Current byte contract | Required migration slice |
| --- | --- | --- | --- | --- |
| Evidence: `packages/evidence/src/integrity/canonical.ts` | Artifact IDs, payload digests, signatures, execution packages, capsules, recovery and support bundles | signed + persistent | Qualified JCS-like V1 with strict validation | Preserve V1 verification; introduce V2 facade only with envelope/schema versioning. |
| Application authority: `authority.ts` | Approval bindings and capability-grant binding digests | persistent authority | Recursive serializer with ambient locale member order | Version approval/grant bindings; verify old stored binding digests with V1. |
| Application coordination: `work-claims.ts` | Claim scope digest and claim equality | persistent authority | Recursive serializer plus locale target sort | Version claim scope; preserve claim reload and expiry behavior for V1. |
| Application execution: `gate-commit.ts` | Gate plan, evidence, request, and idempotency digests | persistent authority | Recursive serializer plus locale member order | Add canonicalization version to plan/checkpoint/receipt records; retain V1 resume verification. |
| Application egress: `trust-egress.ts` | Egress manifest and revision digests | signed-adjacent authority | Recursive serializer plus locale member order | Version manifest digest and reject mixed-version approval binding. |
| Application handoff: `handoff/validation.ts` | Portable handoff validation digests | portable persistent | Recursive serializer plus locale member order | Version handoff artifact before changing bytes; receiver chooses recorded version. |
| Application sync: `workspace-reconcile.ts` | Persisted sync state, plan and rebuild identities | persistent | Recursive serializer and locale sorting of semantic collections | Add state/plan canonicalization version; retain V1 reload and conflict detection. |
| Application effects: `effect-contract.ts` | Durable effect idempotency keys | persistent effect identity | Fixed-shape `JSON.stringify` material without a canonicalization version | Add a versioned effect identity material and retain V1 key lookup for existing intents and receipts. |
| Agent runtime context: `context-compiler.ts` | Snapshot ID, recipe, semantic-obligation, serialized-meaning and manifest digests | portable persistent | Recursive serializer and locale ordering of fragment/source IDs | Version context snapshot/manifest material; normalize declared sets with code-unit order before V2. |
| Agent runtime discovery: `source-snapshots.ts` | Context source snapshots, fact alternatives and selector material | portable persistent | Recursive serializer and locale ordering | Migrate together with context compiler; prove old snapshot verification and cross-locale reproduction. |
| Policy: `cedar-policy.ts` | Policy view/evidence material and normalized layer order | authority | Recursive serializer and locale ordering | Version policy-view evidence; policy decisions never compare V1 and V2 digests as equal. |
| Data probe: `database-knowledge.ts` | Source, fact-value, knowledge-package and promotion-plan digests | portable persistent | Recursive serializer and locale ordering of entities/facts | Version knowledge package and promotion-plan schemas; adapter outputs normalize domain sets before V2. |
| Distribution: `hermetic-bundle.ts` | Release manifest/release digest | signed + persistent release identity | Recursive serializer and locale component ordering | Highest-risk slice: publish a new bundle schema/release format and retain V1 verification. |
| Distribution: `transactional-activation.ts` | Transaction identity material and durable activation records | persistent local state | Recursive serializer for transaction identity; ordinary JSON writes for local journals | Migrate only after hermetic bundle V2; version durable receipt/pointer records. |
| Distribution: `tuf-update-client.ts` | Staged receipt bytes | persistent local state | Ordinary `JSON.stringify`, no structured digest at write | Keep bytes as a versioned local receipt; classify separately from canonical digest migration. |
| Workspace: `scanner/scanner-primitives.ts`, consumed by `workspace-scanner.ts`, `init/safe-init.ts`, and `placement/artifact-placement.ts` | Repository IDs, discovery keys, inventory fingerprints, init/recovery plan IDs, and write-plan IDs | portable + persistent plan identity | **Migrated (T3).** `buildInventoryFingerprintV2` (RFC 8785, `v2:sha256:` prefix) for repository IDs, discovery keys, inventory fingerprints, write-plan IDs, and new init preview/recovery journal plan IDs; `buildInventoryFingerprint` (V1, byte-identical, `sha256:` prefix) stays exported and is still the only verifier for a `schemaVersion: 1` init recovery journal. | Done. `init/safe-init.ts`'s recovery journal envelope carries an explicit `schemaVersion` (1 or 2) and dispatches its verifier on that recorded version, failing closed on any version/prefix disagreement — see `packages/workspace/src/init/safe-init.ts:parseRecoveryJournal`. |
| Platform Node: `git-worktree-adapter.ts` | Worktree `changeDigest`, committed and verified as `Verchestra-Change` by the gate-commit flow | persistent gate authority | SHA-256 of `JSON.stringify(manifest)` | Version change-digest material with the gate plan/checkpoint/receipt migration; retain V1 resume verification. |
| Platform Node: `runtime-store/runtime-store.ts` | Persisted active policy-view digest verification | persistent local authority | Recursive serializer with ambient locale ordering | Migrate with policy-view schema/versioning; retain V1 stored-view verification and fail closed across versions. |

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

## Explicit exclusions

`apps/site`, CLI display formatting, source/document loaders, tests, and
closed-field checks such as `Object.keys(value).sort()` are presentation or
validation-only unless a future audit proves their output feeds one of the
identities above. They are not evidence that V2 has been adopted.

## Required proof for each migration PR

1. Cross-locale output and digest equality for Unicode member names and
   semantic identifier ordering.
   Satisfied for T3 (Workspace): `tests/unit/canonical-json-v2.test.mjs:86`
   ("the same input produces byte-identical output under two different
   ambient locales").
2. Equivalent rejection at the call boundary for undefined values, sparse
   arrays, accessors, cycles, non-finite numbers, depth and node limits.
   Satisfied for T3 (Workspace): `packages/domain/src/canonical/canonical-guard.ts`,
   exercised by `tests/unit/workspace-fingerprint-v2.test.mjs:41,45` and the
   guard's own unit suite.
3. A V1 persisted/signed fixture verifies unchanged; a V2 fixture has an
   explicit schema or canonicalization version.
   Satisfied for T3 (Workspace): `tests/integration/safe-init.test.mjs`
   ("a pinned schemaVersion 1 journal written before this slice still
   verifies and recovers", "a schemaVersion 2 journal verifies and recovers
   with V2"); `tests/unit/workspace-fingerprint-v2.test.mjs:22` (pinned V1
   byte-identity).
4. A discrimination mutation replacing code-unit/JCS ordering with ambient
   `localeCompare` is killed by the focused test.
   Satisfied for T3 (Workspace): `tests/security/canonical-json-sensor.test.mjs`
   (mutation A: locale ordering; mutation B: array-order sorting).
5. `pnpm gate:security` and the architecture boundary test pass.
   Satisfied for T3 (Workspace): `pnpm gate:security`,
   `tests/architecture/repository-boundaries.test.mjs`.
