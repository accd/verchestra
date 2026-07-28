---
schema: verchestra-feature-handoff/v1
feature: policy-hardening
issue: 54
status: planned
branch: main
baseRevision: 9029f3ee566d18fbf2c7ce5508cabe9459ade42f
lastCompletedTask: null
nextTask: T1
lastGate: null
updatedAt: 2026-07-28T23:41:40Z
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

# Next Exact Action

T1: define the declarative case format, explanation structure, bundle
manifest, and the `VES_POLICY_BUNDLE_INVALID` code through the schema
generator.

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
