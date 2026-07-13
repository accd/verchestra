# T31 Model Capability Passport Validation

## Scope

- Task: T31 — Implement Model Capability Passport registry and qualification records
- Requirements: VES-MDL-001…004, VES-BST-002, and VES-HOF-003…004
- Commit target: `feat(models): add capability passports`
- Focused evidence: 39 cases — 29 unit/property and 10 security
- Spec deviations: none

T31 creates immutable signed Passport histories over exact endpoint and resolved-model identity, requested aliases, provider revision, data handling, observed capabilities/evidence, verified context capacity, Driver/evaluation evidence, risk eligibility, independence, confidence, status, and expiry. Runtime observations produce a signed quarantine revision for unexpected model, provider-revision, or evidence drift. A local Machine Passport index persists only verified current eligible revision references.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/passport-registry.test.mjs tests/security/passport-drift-security.test.mjs` | PASS — 39 passed, 0 failed/skipped |
| `node scripts/gate.mjs security` | PASS — format, lint, typecheck, build, 1,375 unit, 10 architecture, 248 qualification, 225 security, and 39 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Closed qualification schema | `tests/unit/passport-registry.test.mjs:17–51` | Fifteen identity, endpoint, model, evidence, capability, capacity, risk, confidence, status, and expiry mutations fail | Yes |
| Signed revision | `tests/unit/passport-registry.test.mjs:53` | First qualification is signed, frozen, and revision one | Yes |
| Idempotency | `tests/unit/passport-registry.test.mjs:62` | Identical qualification returns the existing record with no history append | Yes |
| Revision history | `tests/unit/passport-registry.test.mjs:70–96` | Alias, provider revision, evaluation evidence, and expiry changes append signed ordered revisions | Yes |
| Machine Profile index | `tests/unit/passport-registry.test.mjs:98` | Verified current refs are persisted and reloadable by exact Machine identity | Yes |
| Property canonicality | `tests/unit/passport-registry.test.mjs:106` | All six risk-tier permutations plus reversed capability/evidence lists converge to one qualification | Yes |
| Drift quarantine | `tests/security/passport-drift-security.test.mjs:12` | Resolved model, provider revision, and evaluation evidence drift create signed quarantine revisions | Yes |
| No false drift | `tests/security/passport-drift-security.test.mjs:36` | Exact observation returns the current signed qualification | Yes |
| Identity non-impersonation | `tests/security/passport-drift-security.test.mjs:47–84` | Provider/endpoint/resolved-model changes cannot reuse another endpoint or Passport identity | Yes |
| Expiry | `tests/security/passport-drift-security.test.mjs:86` | Expired evidence is excluded without rewriting signed history | Yes |
| Tamper | `tests/security/passport-drift-security.test.mjs:95` | Modified stored revision is neither returned nor indexed | Yes |
| Alias semantics | `tests/security/passport-drift-security.test.mjs:102` | Marketing alias revision cannot change resolved endpoint-model identity | Yes |
| Minimum floor | Focused runner: 39 | At least 35 unit/property/security cases | Yes |

## Check B — non-shallow litmus

- Validation mutates fifteen independent Passport fields rather than relying on signature tests alone.
- All six permutations of the three risk tiers converge while capability and Driver-evidence arrays are reversed simultaneously.
- Alias, provider revision, evaluation campaign, and expiry each prove append-only revision behavior.
- Runtime drift distinguishes three causes and stores only a digest of the observation in a signed quarantine record.
- Endpoint metadata cannot be silently rewritten under an existing endpoint ID; a Passport cannot move endpoint or resolved model.
- Expiry is derived at eligibility time, preserving historical signature truth instead of mutating the old record.
- Store tampering is detected before current selection and Machine index publication.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `passport-registry.test.mjs:17–51` | Schema and evidence validity | Yes |
| `passport-registry.test.mjs:53–96` | Signing, idempotency, history | Yes |
| `passport-registry.test.mjs:98–119` | Machine index and canonical property | Yes |
| `passport-drift-security.test.mjs:12–45` | Drift versus unchanged observation | Yes |
| `passport-drift-security.test.mjs:47–84` | Endpoint/model identity isolation | Yes |
| `passport-drift-security.test.mjs:86–110` | Expiry, tamper, alias identity | Yes |

All 39 focused cases map to T31 requirements or done-when criteria. Model selection/ranking remains T32.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: tests preceded implementation, the 35-case floor is exceeded, and `gate:security` passes.
- Requested aliases are attributes; exact endpoint plus resolved model forms the semantic identity digest.
- Signed records are append-only and revisions are atomic through the store port; expiry does not rewrite history.
- Runtime drift quarantines rather than silently accepting changed model/provider/evaluation identity.
- Machine state stores only verified Passport IDs/revisions and no provider credentials or sessions.

## Adequacy verdict

PASS. T31 exceeds its test floor, preserves signed qualification history, prevents alias/endpoint/model impersonation, quarantines observed drift, excludes expiry/tamper, persists the local Machine index, and passes the security gate.
