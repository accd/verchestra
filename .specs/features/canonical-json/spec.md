# Canonical JSON portability

Issue: #58

## Requirement

Every structured value that contributes to a portable digest, signature,
idempotency key, plan identity, or persistent verification must name a single,
locale-independent canonical JSON contract. Existing bytes remain authoritative
until a versioned migration proves backward verification.

## Inventory boundary

The first pass found local canonicalizers in application authority, coordination,
egress, execution, handoff, sync; agent-runtime context/discovery/models/skills;
policy; distribution; data-probe and its seven database adapters; workspace; and
platform adapters. The qualified existing primitive is
`packages/evidence/src/integrity/canonical.ts`.

## Migration rules

1. Classify each candidate as `trust`, `persistent`, or `presentation`.
2. Trust and persistent paths must state their current byte contract and every
   persisted schema/version before replacement.
3. A changed byte contract requires a new schema/version plus backward
   verification; it never silently rehashes prior records.
4. Array order is semantic unless a domain-specific normalization explicitly
   declares it a set.
5. Ambient `localeCompare` is prohibited for trust ordering; presentation-only
   sorting is outside this migration.

## Compatibility matrix

`docs/canonical-json-compatibility.md` is the canonical T2 matrix. It records
the contract placement, every trust/persistent serializer group, existing byte
consumer, V1 preservation rule, and required V2 migration boundary. No
production serializer changes in T2.

---

# T3 slice — V2 primitive and the Workspace identity vertical

This section scopes the third task only. T4 (the remaining ~15 owners in the
compatibility matrix) is out of scope and stays gated on its own per-slice
persisted-byte review.

## Corrections to the T2 matrix

The T2 matrix stated that placing the encoder in `packages/domain` was blocked
only on a dependency approval and a lockfile update. That is incomplete.
`scripts/architecture.mjs:67-69` fails **any** non-relative import in
`contracts`, `domain`, and `application` with `VES_ARCH_THIRD_PARTY_IMPORT`;
the single carve-out is `contracts` + `ajv` at line 65. Verified:

```
inspectSource("domain", 'import canonicalize from "canonicalize";')
  -> [{ code: "VES_ARCH_THIRD_PARTY_IMPORT", detail: "canonicalize" }]
inspectSource("domain", 'import { createHash } from "node:crypto";')
  -> [{ code: "VES_ARCH_DOMAIN_NODE_IMPORT", detail: "node:crypto" }]
```

Two consequences bind every design option:

1. `canonicalize@3.0.0` cannot be added to or moved into `packages/domain`
   without widening an architecture control. The owner chose instead to
   implement an internal RFC 8785 encoder with zero imports, leaving the
   architecture rule untouched and `canonicalize@3.0.0` in `packages/evidence`
   for the qualified V1 path (decision recorded 2026-08-01).
2. `node:crypto` is equally barred, so the domain primitive is **encode-only**.
   SHA-256 hashing stays in `packages/workspace`, which already depends on
   `@verchestra/domain` and may import Node modules.

`docs/canonical-json-compatibility.md` is corrected in this slice (T12).

## Scope

| In scope | Out of scope |
| --- | --- |
| V2 contract type/version in `packages/contracts` | Any other owner in the T2 matrix (T4) |
| Pure RFC 8785 JCS encoder + input guard in `packages/domain` | Replacing `packages/evidence`'s qualified V1 primitive |
| Workspace scanner identities, placement `planId`, safe-init journal `planId` | Signed evidence, release bundles, policy views |
| Journal `schemaVersion` 1→2 migration with V1 backward verification | Changing what the journal records or how recovery behaves |
| Discrimination sensors for locale ordering and array ordering | Presentation-only sorts outside digest input |

## Backward-compatibility surface

Exactly one identity in this slice survives a process boundary: the interrupted
init recovery journal, written to `transaction.json`
(`packages/workspace/src/init/safe-init.ts:317`) and re-verified on recovery at
line 145 (`buildInventoryFingerprint({ changes }) !== value.planId` →
`journal plan digest mismatch`). It already carries `schemaVersion: 1`, which is
the version hook the migration uses.

Every other identity in the slice — `repositoryId`, `discoveryKey`,
`remoteFingerprint`, the inventory `fingerprint`, and the placement `planId` —
is recomputed in memory on each run and is never compared against a stored
value. Under compatibility-matrix row 3 these are transient recomputable values
requiring no historical byte compatibility.

## Requirements

| ID | Requirement |
| --- | --- |
| CJ-01 | One V2 canonical JSON contract is named and versioned in `packages/contracts`, and is the only canonicalization contract this slice's new digests cite. |
| CJ-02 | The V2 encoder implements RFC 8785 JCS in `packages/domain` with zero third-party imports and zero `node:` imports. |
| CJ-03 | V2 output matches the published RFC 8785 test vectors for object ordering, number serialization, string escaping, and Unicode keys. |
| CJ-04 | V2 orders object members by UTF-16 code unit. Ambient `localeCompare` never determines a V2 digest's member order. |
| CJ-05 | V2 preserves array order. A collection that is semantically a set is normalized explicitly by its owning domain, in code-unit order, before encoding. |
| CJ-06 | V2 rejects `undefined` object values, sparse arrays, accessor properties, cycles, non-finite numbers, invalid Unicode, and exceeded depth/node limits, each with a typed error code. |
| CJ-07 | The same input produces byte-identical V2 output and digests under at least two different ambient locales. |
| CJ-08 | `buildInventoryFingerprint` (V1) remains byte-identical for any caller not migrated in this slice. |
| CJ-09 | Workspace transient identities emit V2 with a self-describing version prefix distinguishing them from V1 values. |
| CJ-10 | The recovery journal writes `schemaVersion: 2` with a V2 `planId`; a `schemaVersion: 1` journal still verifies with V1; a version/digest mismatch fails closed rather than being reinterpreted. |
| CJ-11 | A discrimination sensor replacing code-unit ordering with `localeCompare`, and one replacing array-order preservation with sorting, are each killed by a focused test that runs in a declared gate. |
| CJ-12 | `pnpm gate:security` and the architecture boundary test pass; no existing assertion is weakened, skipped, or deleted. |

## Requirement traceability

| ID | Tasks | Verified by |
| --- | --- | --- |
| CJ-01 | T1 | `tests/contract/canonical-json-contract.test.mjs` |
| CJ-02 | T2, T4 | `tests/architecture/repository-boundaries.test.mjs` |
| CJ-03 | T2 | `tests/unit/canonical-json-v2.test.mjs` (RFC 8785 vectors) |
| CJ-04 | T2, T7, T8 | `tests/unit/canonical-json-v2.test.mjs` |
| CJ-05 | T2, T6 | `tests/unit/canonical-json-sets.test.mjs` |
| CJ-06 | T3 | `tests/unit/canonical-json-guard.test.mjs` |
| CJ-07 | T2 | `tests/unit/canonical-json-v2.test.mjs` (locale sweep) |
| CJ-08 | T5 | `tests/unit/workspace-fingerprint-v2.test.mjs` |
| CJ-09 | T5, T7, T8 | `tests/unit/workspace-fingerprint-v2.test.mjs`, `tests/integration/workspace-scanner.test.mjs` |
| CJ-10 | T9, T10 | `tests/integration/safe-init.test.mjs`, `tests/fault-injection/safe-init-faults.test.mjs` |
| CJ-11 | T11 | `tests/security/canonical-json-sensor.test.mjs` |
| CJ-12 | T13 | `pnpm gate:security` |

## Success criteria

- [ ] CJ-01 — V2 contract declared and versioned in `packages/contracts`.
- [ ] CJ-02 — domain encoder has no third-party and no `node:` imports.
- [ ] CJ-03 — published RFC 8785 vectors pass.
- [ ] CJ-04 — code-unit member ordering proven; no `localeCompare` on a V2 path.
- [ ] CJ-05 — array order preserved; declared sets normalized explicitly.
- [ ] CJ-06 — every listed rejection has a typed error and a test.
- [ ] CJ-07 — cross-locale byte equality proven.
- [ ] CJ-08 — V1 bytes unchanged for unmigrated callers.
- [ ] CJ-09 — workspace identities emit a self-describing V2 prefix.
- [ ] CJ-10 — V1 journals verify, V2 journals verify, mixed fails closed.
- [ ] CJ-11 — both discrimination sensors killed inside a declared gate.
- [ ] CJ-12 — `pnpm gate:security` passes with no weakened assertion.

## Assumptions

| # | Assumption | Basis |
| --- | --- | --- |
| A1 | JavaScript's `Array.prototype.sort()` with no comparator is UTF-16 code-unit ordering, which is exactly what RFC 8785 requires for member names. | ECMAScript default sort compares via `<` on strings, i.e. code-unit order. `localeCompare` is the deviation, not the default. |
| A2 | `JSON.stringify` already emits RFC 8785-conformant numbers and string escapes for finite values, because JCS's number rule *is* ECMAScript `Number::toString`. | RFC 8785 §3.2.2.3 defers to ECMAScript. This is why an internal encoder is small: the risky part is delegated to the runtime, not reimplemented. |
| A3 | The scanner, placement, and journal identities are the complete set of `buildInventoryFingerprint` consumers. | `grep -rn buildInventoryFingerprint packages/workspace/src` returns `workspace-scanner.ts`, `artifact-placement.ts`, `safe-init.ts`, and the `index.ts` re-export only. |
| A4 | Moving the discrimination sensor to `tests/security/` makes it actually execute. | `tests/mutation/` is named only in `scripts/gate-selection.mjs:36` and is run by no declared test script; `tests/security/` is run by `test:security`, which `gate:security` includes. |
