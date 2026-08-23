# Canonical JSON T4 Completion Design

## Architecture

Three slices plus a close-out, sequenced by a scheduling constraint rather
than by risk alone.

```
  Phase 1  T4j  release identity      <-- must land BEFORE T76
  Phase 2  T4k  close the census      <-- independent, mostly reading
  Phase 3  T4i  signed evidence       <-- largest, gated on nothing
  Phase 4  close-out                  <-- ratchet repair + acceptance evidence
```

The matrix ordered T4i before T4j by risk. This design inverts them, because
the dominant constraint is not risk but a closing window.

### Why T4j goes first

The matrix rated release identity "highest risk — the highest-stakes surface
in the whole matrix", written on the assumption of an installed base of signed
release bytes whose digests a migration could invalidate. That installed base
does not exist:

- `resolveReleaseIdentity()` returns `releaseDigest: null`
  (`apps/vestra-cli/src/release-manifest.ts:19`); source mode has no verified
  release artifact.
- T76, the verified release candidate, has not shipped.
- The only consumers of the bundle digest are `transactional-activation.ts`,
  `tuf-update-client.ts`, and two test fixtures under `tests/helpers/`.

If nothing has ever produced a release manifest digest in the wild, there are
no V1 bytes to preserve, and T4j collapses to the same shape as T4a: a direct
swap plus a fixture re-pin. The moment T76 ships a candidate, that stops being
true permanently and the versioned facade becomes mandatory.

This is a claim, not an axiom, so **T1 turns it into an assertion** before any
byte changes: a test that `releaseDigest` is null and that no tracked fixture
pins a V1 release manifest digest. If T1 fails, the slice stops and re-plans as
a facade (CJ5-01, AC1, edge case 5). The cheap path is taken only if it is
provably cheap.

### T4k: the census is a claim, not a formality

Twenty-two files sit in `UNCLASSIFIED_CEILINGS` because the sensor's author
froze the 2026-08-09 discovery counts rather than expand that slice's scope.
Freezing catches a *new* occurrence; it proves nothing about the existing ones.
The matrix's Explicit exclusions clause permits presentation-only surfaces to
stay — but per-file, with proof.

Five of these are named trust-adjacent surfaces the original T2 inventory did
not reach: `evidence/recovery-bundle` (5 sites), `evidence/run-capsule` (3),
`evidence/support-bundle` (2), `policy/policy-bundle` (2), and
`application/bootstrap/machine-bootstrap` (6). Those are audited first. An
inconclusive audit leaves the ceiling untouched with the open question
recorded — never silently tightened (edge case 4).

Grouping is by package cohesion so each commit reviews as one argument.

### T4i: the only genuine facade

`execution-package.ts`'s eleven pre-sort sites order `artifactId`,
`requirementId`, `taskId`, `role`, `gateId`, `criterionId`, and `field` before
the qualified V1 canonicalizer sees them. Those values are validated only
against `/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u`, which permits mixed case,
and real fixtures use it (`taskId: "T-1"`). Mixed-case ASCII is exactly where
default locale collation and code-unit comparison disagree: collation commonly
treats case as a tertiary tie-break, code-unit puts every uppercase letter
before every lowercase one. Unlike the `StableId`-constrained owners migrated
in T4b–T4h, there is no charset-level guarantee here.

The payload is durably persisted through `FileRecordStore` and, since AD-014
(#217/#242), wrapped in a DSSE envelope. The facade is therefore built on the
current envelope shape, not the pre-#242 flat signature:

```
  read artifact -> envelope declares version -> select verifier
                                                  |
                            v1 -> canonicalizeJson  (unchanged, localeCompare sort retained)
                            v2 -> canonicalizeJsonV2 (codeUnitCompare sort)
```

The V1 path keeps its sort byte-for-byte. This means **T4i likely ends at a
non-zero ceiling by design**, exactly like `scanner-primitives.ts`. Saying so
up front matters: #58's acceptance box reads "no digest input is ordered with
default `localeCompare`", and the honest close is "no *unintentional* ordering
remains; residuals are named V1-compatibility paths" (CJ5-12, AC11).

### Close-out: repair the ratchet itself

`MATRIX_CEILINGS` has seven duplicate keys; the last value wins:

```
gate-commit.ts    0 -> 1   (effective 1, matrix says "tightened to 0")
cedar-policy.ts   0 -> 2   (effective 2, matrix says "tightened to 0")
```

The other five duplicates resolve to the intended tighter value by luck of
ordering. Both loose entries pass today because the real counts are zero, so
the sensor is currently reporting a stricter guarantee than it enforces. The
fix is the de-duplication plus a test that a duplicate key fails (CJ5-11,
AC10) — otherwise the same drift returns on the next slice.

## Components and responsibilities

| Component | Responsibility |
| --------- | -------------- |
| `packages/distribution/src/hermetic-bundle.ts` | Release manifest digest; the private `canonical()` is removed in favour of the domain V2 encoder. |
| `packages/distribution/src/transactional-activation.ts` | Transaction identity; migrated after the bundle. |
| `packages/evidence/src/integrity/canonical.ts` | Stays the qualified V1 implementation, untouched and still exported. |
| `packages/evidence/src/execution-package/execution-package.ts` | Version-dispatched V1/V2 facade over the DSSE envelope. |
| `docs/canonical-json-compatibility.md` | The matrix; every classification and residual is recorded here. |
| `tests/security/canonical-json-locale-allowlist.test.mjs` | The ratchet; de-duplicated and self-guarding. |
| `tests/security/canonical-json-sensor.test.mjs` | Discrimination sensor, extended to each new call site. |

## Dependency direction

contracts -> domain -> application; adapters depend inward only. `distribution`
and `evidence` consume `canonicalizeJsonV2` from `packages/domain`, which takes
no third-party imports. No new dependency and no lockfile change; the
architecture boundary in `scripts/architecture.mjs` is untouched.

## Security and trust boundaries

Release identity and signed evidence are the two highest-stakes digest
surfaces in the repository. The controls are: an assertion-backed
no-installed-base proof before any release byte changes (CJ5-01); a
recorded-version verifier that never guesses (CJ5-05, edge case 3); a pinned
V1 fixture that must keep verifying (CJ5-06); and a fail-closed mixed V1/V2
comparison (CJ5-08). No assertion is weakened to reduce a ceiling.

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The no-installed-base claim is wrong | T1 asserts it before any byte changes; failure aborts to the facade route (AC1, edge case 5). |
| T76 ships while T4j is in flight | Phase 1 is first and independently mergeable; the handoff records the window explicitly. |
| A V2 digest is silently accepted for a V1 artifact | Version selection from the recorded envelope value only; mixed comparison fails closed (AC9). |
| A census audit is rationalized rather than proven | Inconclusive audits keep their ceiling and record the open question (edge case 4). |
| Ceiling reduction achieved by weakening a test | Ceilings move only alongside a real count reduction; the sensor's mutation tests must still pass. |
| The duplicate-key drift returns | A test asserts key uniqueness, not just ceiling values (AC10). |
| T4i's residual non-zero ceiling reads as incomplete work | CJ5-12 requires each residual be named with its V1-compatibility reason in the matrix. |
