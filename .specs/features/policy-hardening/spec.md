# Policy Hardening Specification

## Problem Statement

The policy boundary decides whether an agent may act on the world, yet it is
the thinnest package in the repository: 449 lines in `packages/policy/src/`
(3 files) versus 3944 in `packages/evidence/src/`. Three concrete gaps make
policy the weakest link:

1. Policies are code governing everything else, but there is no declarative
   way to test them — no `vestra policy test` running principal/action/
   resource/expected-decision cases in a gate.
2. `PolicyDecision.determiningPolicies` (`cedar-policy.ts:50`) names policy
   IDs, but a human reviewer cannot see *which attribute* failed — "denied
   by forbid policy #3" instead of "egress to api.example.com not in the
   lease allowlist".
3. An Execution Package can be verified, but there is no way to prove under
   which rules it was authorized — policies are not bundled, versioned,
   signed, or referenced by digest.

The fail-closed core (`cedar-policy.ts:326-335`, distinct deny codes) is
genuinely good and must be preserved.

## Goals

- Declarative policy test cases runnable as `vestra policy test` in gates.
- Human-readable denial explanations naming the failing attribute and rule.
- A versioned, signed policy bundle referenced by digest in every Execution
  Package.
- Preserve every existing fail-closed behavior and error code.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Replacing Cedar or adding a second engine | Cedar is qualified (T01–T68); the gap is tooling around it. |
| Policy authoring UI or remote policy distribution | Bundles are tracked, reviewed artifacts; distribution is out. |
| Automatic policy repair or synthesis | Human-authored, human-reviewed policies only. |

## Acceptance Criteria

1. **POL-01** — WHEN `vestra policy test` runs THEN it SHALL evaluate
   declarative cases (principal, action, resource, context attributes,
   expected decision) against the workspace policy set and SHALL exit
   non-zero on any mismatch, wired into `pnpm gate:quick`.
2. **POL-02** — WHEN a decision denies an effect THEN the decision SHALL
   carry a structured, human-readable explanation identifying the
   determining policy, the failing attribute, and the expected versus
   actual value, while error codes and fail-closed semantics remain
   unchanged.
3. **POL-03** — WHEN an Execution Package is sealed THEN it SHALL reference
   the active policy bundle by content digest, and the bundle SHALL be
   versioned and signed under the trust root.
4. **POL-04** — WHEN verification or resume evaluates policy THEN a bundle
   digest mismatch, unknown bundle version, or invalid bundle signature
   SHALL fail closed with a distinct error code.
5. **POL-05** — WHEN explanations are constructed THEN they SHALL pass
   through the existing egress/redaction boundary so explanations never
   leak secrets into evidence or CLI output.

## Design Constraints

- Explanations are additive: `PolicyDecision` gains fields; no existing
  consumer or error code changes.
- Policy test cases are tracked, reviewable data (JSON or Cedar-adjacent
  declarative format), never executable code.
- Bundle signing uses the key lifecycle (`.specs/features/key-lifecycle/`);
  until T68a lands, bundle signing wires behind the same `KeyProviderPort`
  so the implementation order can swap.

## Requirement Traceability

| Requirement | Task | Status |
| --- | --- | --- |
| POL-01 | T2 | Pending |
| POL-02, POL-05 | T3 | Pending |
| POL-03, POL-04 | T4 | Pending |

## Success Criteria

- A reviewer reads a denial and knows exactly which attribute failed and why.
- `pnpm gate:quick` fails when a policy change breaks a declared case.
- Any sealed package provably names the exact policy bundle that governed it.
