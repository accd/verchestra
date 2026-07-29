# Policy Hardening Design

## Components

```text
packages/policy/
  ├── cedar-policy.ts        (existing engine wrapper — preserved)
  ├── policy-activation.ts   (existing)
  ├── policy-test.ts         (NEW: declarative case runner)
  ├── explanation.ts         (NEW: attribute-level decision explanation)
  └── policy-bundle.ts       (NEW: versioned, signed bundle build/verify)

apps/vestra-cli
  └── "policy test" command  (NEW: manifest entry, JSON + human output)
```

## `vestra policy test` (POL-01)

- Case format (tracked JSON, e.g. `.verchestra/policy/tests/*.json`):
  `{ name, principal, action, resource, context, expect: "allow" | "deny",
  expectCode? }`.
- The runner evaluates each case through the same
  `CedarPolicyEngine` path used in production — never a parallel evaluator —
  so tests measure real behavior including the diagnostic-deny paths at
  `cedar-policy.ts:326-335`.
- CLI registers through the existing command manifest
  (`apps/vestra-cli/src/cli.ts:79-89`), supports `--output json`, and exits
  non-zero on mismatch. `scripts/gate.mjs` gains the command in the quick
  gate.

## Explanations (POL-02, POL-05)

- Cedar diagnostics already return `reason` policy IDs
  (`cedar-policy.ts:330`). The explanation layer maps each determining
  policy ID to its source statement and extracts the failing attribute
  binding from the request context: `{ policyId, statement, attribute,
  expected, actual }`.
- Rendering for humans: `denied: egress to api.example.com is not in the
  lease allowlist (forbid policy egress-allowlist)`.
- Explanations pass through `DataEgressFirewall.authorize` before entering
  evidence or CLI output; secret-shaped values are redacted and the
  redaction is recorded (POL-05).

## Signed Policy Bundle (POL-03, POL-04)

- Bundle = versioned manifest `{ version, policies: [{ id, sourceDigest,
  cedar }], createdAt, bundleDigest }` signed under the trust root via
  `KeyProviderPort`.
- `ExecutionPackage` gains `policyBundleDigest` through the schema
  generator; sealing records it, verification re-checks it.
- Mismatch/unknown/invalid-signature → new fail-closed code
  `VES_POLICY_BUNDLE_INVALID`.

## Test Strategy

- Unit: case parsing, mismatch reporting, explanation extraction, bundle
  digest stability.
- Contract: generated types match the schema for `policyBundleDigest`.
- Security: explanations cannot leak secrets (redaction sensors).
- Mutation: swapped expect decision, dropped fail-closed code — killed.
