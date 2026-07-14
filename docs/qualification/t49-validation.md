# T49 Database Knowledge and Synthetic Seeds Validation

## Scope

- Task: T49 — Implement Database Knowledge Package, schema contradiction, evidence, and seed planning
- Requirements: VES-DBP-004…006, VES-DSC-005, VES-SPC-001…003
- Commit target: `feat(data): add database knowledge and seeds`
- Focused evidence: 56 cases (22 unit, 10 integration, 24 security)
- Spec deviations: none

T49 adds structured ER, DDL, migration, ORM, and live-introspection importers; a content-addressed Database Knowledge Package; explicit side-by-side contradiction evidence with human-reviewed resolution; sanitized Probe evidence promotion; and acceptance-criterion-to-symbolic-synthetic-seed planning. The committed outputs contain no unrestricted rows, credentials, protected-result references, or materialized production values.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/database-knowledge.test.mjs tests/integration/database-knowledge.test.mjs tests/security/database-knowledge-security.test.mjs` | PASS — 56 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck/build, 1,518 unit/property, 10 architecture, 248 qualification, 539 security, and 55 fault cases |

## Adequacy matrix

| Done-when criterion / spec AC | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Five schema-source importers preserve provenance | `tests/unit/database-knowledge.test.mjs:24-26` — `source.kind === kind`, SHA-256 digest, frozen nested evidence | ER/DDL/migration/ORM/introspection remain explicit, immutable sources | PASS |
| Deterministic content identity | `tests/unit/database-knowledge.test.mjs:32-41,46-61` — sorted columns/sources and equal digest under permutation | Equivalent evidence produces one canonical identity | PASS |
| Every source remains side by side (VES-DBP-005/DSC-005) | `tests/unit/database-knowledge.test.mjs:46-54,112-117` — all five/three sources retained and alternative attribution preserved | No source is silently selected or discarded | PASS |
| Attribute contradictions require resolution | `tests/unit/database-knowledge.test.mjs:94-96` — two alternatives, `unresolved`, `requiredResolution === true` across type/nullability/PK/unique | Disagreement remains explicit and unresolved | PASS |
| Presence and entity-type contradictions | `tests/unit/database-knowledge.test.mjs:130-131,159` — exact `[false,true]` presence and `[table,view]` alternatives | Complete-source omissions and type conflicts are contradictions | PASS |
| Partial-source omission is not fabricated disagreement | `tests/unit/database-knowledge.test.mjs:143-146` — no `note.present` contradiction | Missing evidence from partial migrations is not converted into a false fact | PASS |
| Human resolution retains alternatives | `tests/unit/database-knowledge.test.mjs:178-181,193-205,222` — resolved status, two alternatives, generation/digest change, invalid selection rejection, idempotence | Resolution is explicit, reviewed, traceable, and non-destructive | PASS |
| Probe evidence required fields (VES-DBP-004) | `tests/integration/database-knowledge.test.mjs:24-41` — database/schema identity, bounds, classifications, redaction review, result digest, run, accepted/untrusted state | Accepted evidence records required provenance and sanitization | PASS |
| No unrestricted rows or protected result reference | `tests/integration/database-knowledge.test.mjs:27-28`; `tests/security/database-knowledge-security.test.mjs:227-228` | Promoted/seed artifacts contain no unrestricted production rows | PASS |
| AC-to-synthetic-seed scenarios (VES-DBP-006/SPC-001…003) | `tests/integration/database-knowledge.test.mjs:45-60` — nominal/required/unique cases, `synthetic-only`, `productionDataAllowed === false`, exact AC trace | Scenarios derive from ACs and schema constraints only | PASS |
| Factories, fixtures, and sanitized evidence are identity-bound | `tests/integration/database-knowledge.test.mjs:68-78` — factory/fixture refs, exact fixture/evidence digests, absent literals/redaction field | Only approved synthetic and sanitized references influence planning | PASS |
| Unresolved contradiction blocks seeds | `tests/integration/database-knowledge.test.mjs:84-99` — exact `VES_SEED_SCHEMA_UNRESOLVED`; reviewed package then yields scenarios | Seeds never guess through schema disagreement | PASS |
| Raw production clone impossible by default | `tests/security/database-knowledge-security.test.mjs:182-234` — rows/unsanitized evidence/production fixtures/literal factories/tampered evidence rejected; protected/real values absent | Raw production cloning has no accepted input or output shape | PASS |
| Content tampering fails closed | `tests/security/database-knowledge-security.test.mjs:90-112,234` — conflicting identity, forged source digest, and altered promoted evidence rejected | Content-addressed identities are recomputed at trust boundaries | PASS |

## Necessary-test reverse map

| Test group and assertion range | Maps to | Keep |
| --- | --- | --- |
| `tests/unit/database-knowledge.test.mjs:20-41` — kind/digest/freeze/sort/equality assertions | VES-DBP-005 source import and deterministic package identity | Yes |
| `tests/unit/database-knowledge.test.mjs:43-72` — source preservation/package permutation/agreed facts | VES-DBP-005 and VES-DSC-005 | Yes |
| `tests/unit/database-knowledge.test.mjs:75-159` — attribute/presence/coverage/entity alternatives | VES-DBP-005 contradiction and missing-evidence behavior | Yes |
| `tests/unit/database-knowledge.test.mjs:162-234` — resolution selection/idempotence/immutability | VES-DBP-005 required human resolution | Yes |
| `tests/integration/database-knowledge.test.mjs:22-41` — promoted evidence payload assertions | VES-DBP-004 | Yes |
| `tests/integration/database-knowledge.test.mjs:43-107` — scenario kinds/traceability/identity/no-row/blocking/determinism | VES-DBP-006 and VES-SPC-001…003 | Yes |
| `tests/security/database-knowledge-security.test.mjs:68-132` — source/package/resolution denials | VES-DBP-005 and VES-DSC-005 | Yes |
| `tests/security/database-knowledge-security.test.mjs:135-182` — Probe promotion denials | VES-DBP-004 | Yes |
| `tests/security/database-knowledge-security.test.mjs:185-234` — production clone/tamper denials | VES-DBP-006 | Yes |

Adequacy verdict: every T49 done-when criterion and applicable requirement outcome has exact assertion evidence; no assertion-free, call-count-only, skipped, deleted, or speculative tests exist. Existing repository naming and test-layer conventions were followed.

## Non-shallow checks

- Importer inputs are closed records. Credential, connection-string, raw-row, unsafe-reference, entity, column, and kind injection paths fail before packaging.
- Every source declares `complete` or `partial` coverage. Only complete coverage creates negative presence claims, preventing incremental migrations from becoming false contradictions.
- Source, knowledge-package, promoted-evidence, fixture, and final plan digests are recomputed or bound at their consumption boundaries.
- Contradictions preserve actual values, value digests, and every contributing source ID. Resolution adds a human-review record; it never deletes alternatives.
- Probe promotion requires successful read-only identity/session evidence, closed redaction metadata, a human review, and public/internal scalar claims. Protected result references are intentionally omitted from the promoted artifact.
- Seed outputs are symbolic plans: generator names and content-addressed fixture/evidence references only. No materialized values or database connection surface exists.
- Target contradictions block planning until resolved. Required and unique constraints generate explicit negative cases in addition to the nominal case.

## Verdict

PASS for T49. Database knowledge remains source-faithful, contradictions cannot be silently collapsed, Probe promotion is sanitized and provenance-complete, and seed planning is synthetic-only with raw production cloning structurally impossible by default.
