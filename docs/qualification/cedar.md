# Cedar Engine and Policy Oracle Qualification

**Task:** T06  
**Status:** Qualified  
**Selected release form:** `@cedar-policy/cedar-wasm/nodejs` 4.11.2  
**Cedar engine / SDK:** 4.11.2  
**Cedar language:** 4.5  
**License:** Apache-2.0

## Selection

Verchestra selects the official Node-oriented WASM subpackage for the release Policy adapter. It loads the same official Cedar Rust implementation compiled to WASM through Node filesystem APIs and avoids depending on Node's experimental direct WebAssembly-module import path at runtime.

| Candidate | Official | Exact pin | Hermetic bundle | Current platform evidence | Differential evidence | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `@cedar-policy/cedar-wasm/nodejs` 4.11.2 | Yes | Yes | Yes | Windows x64 pass; remaining release matrix stays mandatory | Identical to official ESM loader on allow/default-deny/forbid/egress corpus | **Selected** |
| `@cedar-policy/cedar-wasm` ESM loader | Yes | Yes | Yes | Works, but Node 24 emits an experimental WASM-module warning | Differential reference | Qualification-only reference |
| Native Rust adapter | Official source exists | Not packaged for this Node release | Would require per-platform compilation and toolchain qualification | No Rust toolchain or qualified binary present | Not available | Rejected for 1.0 until independently qualified |

Selection fails with `VES_CEDAR_FORM_UNQUALIFIED` unless a candidate is official, exact-versioned, hermetic, platform-qualified, and differentially qualified. There is no silent fallback to an unverified native binary or another Cedar implementation.

Primary sources:

- [Cedar authorization algorithm](https://docs.cedarpolicy.com/auth/authorization.html)
- [Cedar schema and policy validation](https://docs.cedarpolicy.com/policies/validation.html)
- [Cedar security guidance](https://docs.cedarpolicy.com/other/security.html)
- [Official Cedar source and WASM package](https://github.com/cedar-policy/cedar)

## Qualified oracle semantics

The frozen oracle implements the Verchestra fail-closed wrapper around Cedar:

1. Verify exact engine, SDK, and language versions.
2. Parse the release schema.
3. Parse each policy layer in fixed order: Built-in, Organization, Workspace, Project, User Preference, Run Override.
4. Reject every non-Built-in `permit` as `VES_POLICY_NON_MONOTONIC`; lower layers may only add restrictions.
5. Combine policies with namespaced stable IDs and perform strict schema validation.
6. Evaluate with request validation enabled.
7. Convert any engine failure, warning, or diagnostic error to a typed `deny`.
8. Return `allow` only for a validated matching permit with no error; a matching forbid wins; no matching permit is implicit deny.

Stable decisions expose only a code, safe explanation, and sorted determining policy IDs. Raw policies, engine exceptions, entity data, and external content are absent from the decision.

## Requirement evidence

- **VES-SEC-001:** Built-in safety permits establish the maximum authority. Organization, Workspace, Project, User Preference, and Run Override can add forbids but cannot add permits. Forbid wins at every layer.
- **VES-SEC-002:** schema parse, policy parse, strict validation, request validation, engine failure, exception, warning, diagnostic, SDK mismatch, and language mismatch all deny with stable codes.
- **VES-CTX-006:** egress classification, purpose, destination, retention, Workspace, and policy authorization are each required by the egress permit.
- **VES-EXE-001…003:** writer invocation requires Approval, matching policy digest, a capability, current evidence, and a valid claim. Any changed binding causes implicit deny immediately before the effect.
- **VES-SEC-006:** an `untrustedContent` value resembling a Cedar permit is never promoted into the policy set and cannot alter authorization.

## Scope boundary

This is the qualification oracle, not the production Policy package. T24 must turn this evidence into the strict-TypeScript adapter, last-known-good policy activation, signed policy-view digests, request translation, and durable explanation evidence. T25 owns Capability Grants and full Approval verification.

The remaining macOS/Linux architecture matrix is still a release gate. The selected form is qualified on the current Windows x64 development host, not declared universally proven ahead of T76.

## Evidence

Command: `corepack pnpm@10.34.5 gate:security`

- 40 frozen policy/error cases plus 10 explanation, loader-differential, version, and form-selection cases passed.
- Both official loaders reported engine 4.11.2, language 4.5, and SDK 4.11.2.
- Security gate result: 50 T06 tests plus 72 previous tests = **122 passed, 0 failed, 0 skipped, 0 todo**.

