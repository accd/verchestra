---
schema: verchestra-feature-handoff/v1
feature: policy-hardening
issue: 54
status: verification
branch: feat/t68d-policy-hardening
baseRevision: f228e4ac331e843e340ff770141e768091b7bc7c
lastCompletedTask: T4
nextTask: Independent verification and human review of the T68d pull request
lastGate: pnpm gate:security
updatedAt: 2026-07-30T01:09:47Z
---

# Scope

Harden the thinnest trust boundary: declarative `vestra policy test` in the
quick gate, attribute-level denial explanations, and a versioned signed
policy bundle referenced by digest in Execution Packages (review item R4).
Roadmap task T68d.

# Completed Evidence

Specification, design, and tasks written from verified code reading:
`packages/policy/src/` is 449 lines; `PolicyDecision.determiningPolicies`
carries policy IDs only (`cedar-policy.ts:50,330`); no policy-test command
exists in the CLI manifest; packages carry no policy digest.

T1-T4 implemented in one pull request. Three new files in packages/policy:
policy-test.ts (declarative case runner), explanation.ts (attribute-level
explanations with recorded redaction), policy-bundle.ts (versioned, signed,
order-independent bundle). The Execution Package gains optional
policyBundleDigest (POL-04).

The case runner evaluates through the production CedarPolicyAdapter, never a
parallel evaluator, so a passing case measures real behavior including the
diagnostic-deny paths. The case format is closed: a typoed expectation fails
the format rather than silently reading as deny-and-pass, and an empty suite
is rejected because it proves nothing.

Explanations recover the layer from the compiled policy id and cross-check it
against the view; a determining policy the view cannot name is surfaced rather
than hidden. Every explanation string passes through secret-shape redaction and
the redaction count is recorded, so withholding is visible in evidence.

Bundle verification recomputes every source digest and the bundle digest from
the sources before checking the signature, so a tampered digest re-signed with
a valid key still fails.

Evidence: 19 unit tests. Discrimination sensor 5/5 KILLED after a gap was
closed: the first pass had only four kills because a swapped bundle digest was
caught by the signature check rather than by recomputation. Added a case that
re-signs the tampered digest with a valid key, which only recomputation can
catch. gate:full PASS, gate:security PASS, agent:check PASS.

# Next Exact Action

Independent verification and human review of the T68d pull request, then the
completion pull request with docs/qualification/t68d-validation.md.

# Blockers

Bundle signing (T4) prefers the `KeyProviderPort` from key-lifecycle T1;
if T68d starts first, wire behind the same port with the file adapter
following.

# Decisions

- `policy test` evaluates through the production Cedar path, never a
  parallel evaluator.
- Explanations are additive fields; no existing error code changes.
- Explanations and bundles pass the egress/redaction boundary.

# Files Intentionally Left Unchanged

- All product code and tests (specification-only so far).
- Cedar engine choice and the existing fail-closed deny codes.
