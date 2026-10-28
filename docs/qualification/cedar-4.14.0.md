# Cedar Policy Boundary Requalification (4.14.0)

**Maintenance scope:** qualification successor tracked in #563 (DSB-05)  
**Status:** Qualified for the existing T06 contract  
**Qualified package:** `@cedar-policy/cedar-wasm/nodejs` 4.14.0  
**Cedar engine / SDK:** 4.14.0  
**Cedar language:** 4.6 (was 4.5)  
**Supersedes:** the engine and language identity recorded in `cedar-4.12.0.md`

## Qualification boundary

This report supersedes the identity recorded by `cedar-4.12.0.md` without
changing the architecture. Cedar remains the authorization oracle behind the
Policy port and owns no Verchestra workflow, artifact, Approval, or durable
state. The qualification chain and its status are unchanged.

## Why the pins moved

The Cedar expectation is an exact equality: the adapter and the spike oracle
deny when `getCedarVersion()` or `getCedarSDKVersion()` differs from the
expected engine version, or `getCedarLangVersion()` from the expected language
version. Dependabot's #583 moved the package to 4.14.0 alone and turned `main`
red with `VES_POLICY_ENGINE_VERSION_MISMATCH`; #589 reverted it. Here the pins
move with the package.

Unlike the 4.12.0 refresh, **the language version moves too**: 4.14.0 reports
language 4.6. The engine and language pins move together in
`packages/policy/src/cedar-policy.ts:141-142` and
`spikes/cedar/src/cedar-policy-oracle.mjs:18`. The fail-closed scenarios keep
engine 4.11.1 and language 4.4, which still differ from the real engine and so
still exercise the deny path.

## Upstream review (v4.12.0 to v4.14.0)

Sources: the release notes of `cedar-policy/cedar` v4.13.0 (2026-09-15) and
v4.14.0 (2026-10-17). Verchestra calls eight engine functions, the ones
`CedarEnginePort` lists (`packages/policy/src/cedar-policy.ts:30-39`):
the three version reads, `checkParseSchema`, `checkParsePolicySet`,
`policyToJson`, `validate` in strict mode, and `isAuthorized` with request
validation.

| Release | Change | Reaches Verchestra | Outcome |
| --- | --- | --- | --- |
| 4.13.0 | A policy scope that no action applies to is a validation **warning**, no longer an error (#2545) | Yes, through `validate` | The adapter denies on any validation warning (`cedar-policy.ts:256`), so the decision stays `VES_POLICY_VALIDATION_FAILED`. The new corpus entry `policy-validation-action-application` proves it against the real engine |
| 4.13.0 | A chained `has` converts to JSON as one node with an array `attr` (#2560) | `policyToJson` only | Verchestra reads only the `effect` field of that JSON; unchanged |
| 4.13.0 | Fixes to the experimental `tpe` and `protobufs` features and to PST round trips | No | None of these is exposed through the functions Verchestra calls |
| 4.14.0 | The `external` keyword declares an undefined entity type or action; a schema holding one is partial (#2615); language 4.6 | Yes: the schema is part of the policy view | A partial schema parses, and strict validation refuses it as incomplete (`ValidationError::IncompleteSchema`), so the view is denied with `VES_POLICY_VALIDATION_FAILED` before any request is evaluated. The new corpus entry `schema-external-declaration` proves it. The release schema declares no `external` name |
| 4.14.0 | `Request::new` and entity parsing accept a partial schema | No | A view whose schema is partial never validates, so it never reaches `isAuthorized` (`cedar-policy.ts:328-330`) |
| 4.14.0 | New FFI `linkSchemas` and `schemaCompleteness` (#2615); protobuf carries `external` (#2621) | No | Not called |
| 4.14.0 | Faster `EntityUid` parsing; templates removed from the deprecated `entity-manifest` feature | No | Parsing results are unchanged upstream; the feature is not used |

## Proven behavior

- Both official loaders report engine 4.14.0, language 4.6 and SDK 4.14.0
  (`spikes/cedar/test/cedar-forms.test.mjs:11`, `:15`).
- The ESM and Node loader differential corpus agrees on allow, implicit deny,
  forbid-wins, egress allow, and egress deny.
- Release-form selection still chooses the official Node WASM form only when
  every release condition passes, and fails closed when none does.
- The policy corpus (`spikes/cedar/test/policy-corpus.json`) grows from 40 to
  42 recorded outcomes with the two entries above. The frozen spike oracle and
  the product adapter (`tests/security/cedar-policy.test.mjs`) each reproduce
  all 42: approval, staleness, capability, evidence, claim, and action checks,
  forbid at every layer, the rule that a lower layer cannot permit what a
  higher layer forbids, and every fail-closed path.

## Discrimination

Four faults were injected one at a time and each run restored the file:

| Fault | Killed by |
| --- | --- |
| The adapter ignores validation warnings | `policy-validation-action-application` |
| The adapter ignores validation errors | `policy-validation-attribute`, `schema-external-declaration` |
| The spike oracle ignores validation warnings | `policy-validation-action-application` |
| The spike oracle ignores validation errors | `policy-validation-attribute`, `schema-external-declaration` |

Before this change no test killed the first and third faults: under 4.12.0 a
misapplied scope was an error, so the warning check was never the deciding
one.

## Evidence

`corepack pnpm qualify:cedar`: 52 tests, 0 failures, 0 skipped. The policy
suites (`tests/security/cedar-policy.test.mjs` and the policy unit and
integration tests): 106 tests, 0 failures. Gate results are in
`.specs/features/cedar-4-14-0/validation.md`. No policy text and no recorded
decision changed; the engine and language identity moved, and two outcomes
were added.
