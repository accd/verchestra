---
schema: verchestra-qualification-report/v1
task: T68a
revision: 73b2060edb8a7e66a93a88bc795a64d5aa8fa725
gates: pnpm gate:quick, pnpm gate:full
gateResults: pass, pass
gateRevision: 73b2060edb8a7e66a93a88bc795a64d5aa8fa725
criteriaEvidence: 7 of 7 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 1 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/118
---

# T68a Key Lifecycle and Portability Validation

## Scope

T68a completes the persistent evidence-signing-key lifecycle and its
two-environment portability proof. The implementation retains one encrypted
Ed25519 key per logical identity in a machine-local state root, rotates and
revokes keys fail closed, composes the CLI through `KeyProviderPort`, and now
proves that a package created on one environment can be verified and resumed
on another without moving private state.

The portability proof uses two separate disposable local state roots. The
source environment has qualified Claude and Codex profiles; the receiver has a
qualified OpenCode/Qwen profile. Those local profiles are deliberately not
serialized into the portable package or the Run Capsule.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/key-lifecycle-portability.test.mjs` | PASS — one two-environment journey, zero failures/skips |
| `pnpm gate:quick` | PASS — included in the full profile on the same implementation revision |
| `pnpm gate:full` | PASS — [manual validation run 30494937450](https://github.com/accd/verchestra/actions/runs/30494937450) resolved and checked out `73b2060edb8a7e66a93a88bc795a64d5aa8fa725`, then uploaded the candidate-identity artifact |

The full profile covers format, lint, typecheck, unit, contract, integration,
E2E, architecture, qualification, security, and fault stages. It was rerun on
the reachable implementation revision after the initial report was found to
name a PR-side revision that was not an ancestor of `main`. This correction
changes the evidence binding only; it does not assert that the required
independent human acceptance has occurred.

## Replayable two-minute demonstration

From a clean clone at reachable `main` ancestor
`73b2060edb8a7e66a93a88bc795a64d5aa8fa725`:

```text
$ corepack pnpm install --frozen-lockfile
$ node --test tests/e2e/key-lifecycle-portability.test.mjs
✔ an Execution Package crosses two machine-local key roots and resumes under a different qualified driver
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

The journey creates a persistent source signing key, seals an Execution
Package, transfers only the package and the public trust root, and makes the
receiver verify it. The receiver then seals and verifies a completed Run
Capsule with its distinct local signing key. Replacing the transferred trust
root with the receiver's local root is required to fail with
`VES_TRUST_KEY_UNKNOWN`.

## Spec-anchored adequacy matrix

| Requirement | Exact evidence | Result |
| --- | --- | --- |
| KEY-01 persistent load/create | `tests/unit/encrypted-file-key-provider.test.mjs`; T2 handoff evidence | PASS |
| KEY-02 encrypted machine-local private material | provider unit/security cases; portability test checks the transfer excludes passphrases and state roots | PASS |
| KEY-03 overlap rotation | `tests/unit/encrypted-file-key-rotation.test.mjs`; T3 handoff evidence | PASS |
| KEY-04 revocation, expiry, and purpose fail closed | key-rotation unit/security cases and public error contract | PASS |
| KEY-05 composition only through `KeyProviderPort` | `tests/integration/cli-key-provider-composition.test.mjs`; T4 handoff evidence | PASS |
| KEY-06 package portability and continuation | `tests/e2e/key-lifecycle-portability.test.mjs`: source package, transferred public trust root, receiver verification, distinct qualified profiles, and receiver Run Capsule | PASS |
| KEY-07 corrupted keystore fails closed | provider unit/security cases for malformed, truncated, tampered, and wrong-passphrase envelopes | PASS |

## Independent discrimination sensor

The E2E journey contains one explicit adversarial trust mutation:

| Mutation | Expected behavior | Result |
| --- | --- | --- |
| Replace the transferred source trust root with the receiver's local trust root | Package verification returns `VES_TRUST_KEY_UNKNOWN`; no continuation capsule may be justified from that verification | KILLED |

The successful path only executes after the source public key is restored in
the transferred trust root. The test also rejects passphrase and state-root
text in both keystores and every portable artifact it transfers.

## Non-shallow checks

- The source and receiver use distinct encrypted-file providers and distinct
  key identities; no ephemeral test signer is used for the package journey.
- The receiver first attempts verification with its own local trust root and
  is rejected before the source public trust root is imported.
- The package is verified through `ExecutionPackageBuilder`, including current
  state and derived pending-task checks, rather than through a raw signature
  helper.
- The receiver creates a `RunCapsule` linked to the transferred package and
  verifies that capsule with its own public trust root.
- Qualified driver profiles differ across environments while remaining local;
  neither profile, session, credential, passphrase, nor local state path is
  permitted in the transferred values.

## Verdict

PASS for T68a. Verchestra has qualified persistent local signing-key
management and a reproducible two-environment evidence portability proof. It
remains `0.0.0-qualification`; this evidence does not constitute a public
installer, production release, or 1.0 decision.
