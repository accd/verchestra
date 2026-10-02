# Validation — ADP-5 verification ports by operation (c5)

Branch `refactor/verification-ports-by-operation`, based on `origin/main` at
`d58a25f`. Scope: requirement ADP-5 only.

## What changed

The verification module (`packages/application/src/verification/verification.ts`)
had one nine-port interface feeding two operations of one coordinator. Each
operation now has its own interface, and the combined class is gone:

| Operation | Coordinator | Port set | Ports |
| --- | --- | --- | --- |
| `verify` | `IndependentVerificationCoordinator` (`verification.ts:482`, method at `:489`) | `VerificationPorts` (`verification.ts:187`) | `expectations`, `evidence`, `sensor`, `lessons`, `reports.save`, `workflow` |
| `review` | `HumanReviewCoordinator` (`verification.ts:654`, method at `:661`) | `HumanReviewPorts` (`verification.ts:213`) | `reports.verify`, `humanAuthority`, `reviews`, `workflow` |

`IndependentVerificationCoordinator` keeps its name for the operation that
name describes, so AD-011 and every existing reference to it stay true; it no
longer has a `review` method and nothing forwards to one. The `digest` port,
which no operation read, is deleted. Both coordinators and both port sets stay
inside `verification.ts`, as AD-011 requires; no adapter package was added.

## Requirement evidence

| Requirement | Evidence |
| --- | --- |
| ADP-5: `verify` declares only the ports it uses | Declaration `verification.ts:187-211`; every read is of a declared port (`:494`, `:506`, `:542`, `:561`, `:581`, `:619`, `:622`, `:640`). `tests/unit/verification-ports.test.mjs:45` asserts the supplied set is exactly six ports and `:53` asserts the operation reads exactly `evidence.inspect`, `expectations.derive`, `lessons.record`, `reports.save`, `sensor.activeStateDigest`, `sensor.run`, `workflow.apply`. |
| ADP-5: `review` declares only the ports it uses | Declaration `verification.ts:213-218`; reads at `:699`, `:732`, `:752`, `:754`. `tests/unit/verification-ports.test.mjs:69` asserts the supplied set is exactly four ports and `:70` asserts the operation reads exactly `humanAuthority.verify`, `reports.verify`, `reviews.save`, `workflow.apply`. |
| The combined class is removed, not kept as forwarding | `tests/unit/verification-ports.test.mjs:74-75`: the verification coordinator has no `review`, the Human Review coordinator has no `verify`. |
| Refusing and inert stubs are removed from every constructor | `apps/vestra-cli/src/task/task-verifier.ts:194-223` (no `digest`, `reports.verify`, `humanAuthority`, `reviews`); `apps/vestra-cli/src/task/task-review.ts:172-198` (`unusedPorts` and the refusing `reports.save` deleted; composed at `:258`); `apps/vestra-cli/src/self-test-full-scenario.ts:731-772` (no `digest`, `reports.verify`, `humanAuthority`, `reviews`); `tests/helpers/verification-fixture.mjs:114-204` builds `verificationPorts` and `humanReviewPorts` separately. `pnpm typecheck` proves each composition root supplies exactly its declared set. |
| The cross-backend journey uses one coordinator per operation | `tests/helpers/cross-backend-journey-fixture.mjs:290-303`; `tests/e2e/cross-backend-delivery-journey.test.mjs:80-81` still asserts one report and one review, the review count now read from the Human Review fixture state. |
| `tests/mutation/verification-sensor.test.mjs` passes unmodified | Not in the diff; `pnpm test:mutation` — 8 passed. |
| Behavior of both operations is unchanged | `tests/unit/independent-verification.test.mjs` (unmodified) and `tests/e2e/verification-human-review.test.mjs` (13 cases, same assertions, review cases now built from `humanReviewPorts`). |

## Discrimination sensor

A temporary mutant made `verify` read `humanAuthority`, a port it does not
declare. `tests/unit/verification-ports.test.mjs:53` failed with the extra
`humanAuthority` entry (1 failed, 2 passed). The mutant was reverted and the
file passes 3 of 3.

## Tests: replaced, not layered

No test case was deleted and no assertion was weakened.

- `tests/e2e/verification-human-review.test.mjs`: the nine review cases build
  `humanReviewPorts` and `humanReviewCoordinator` instead of the combined
  fixture; every `assert` line is unchanged apart from the builder names.
- `tests/e2e/cross-backend-delivery-journey.test.mjs:81`: the same
  `reviews.length === 1` assertion reads `humanReviewState` instead of
  `verificationState`, because the review record now lands in the Human Review
  fixture state.
- `tests/helpers/verification-fixture.mjs`: the verification fake no longer
  carries `digest`, `reports.verify`, `humanAuthority` or `reviews`; the Human
  Review fake carries only its four ports.

## Guardrails

- **Complexity.** Keys unchanged, values unchanged:
  `packages/application/src/verification/verification.ts :: Async method 'verify'`
  stays 19 and `... :: Async method 'review'` stays 15. `complexity-baseline.json`
  is not modified. `pnpm complexity:check` — PASS, 179 baselined hotspot keys.
- **Census.** `apps/vestra-cli/src/self-test-full-scenario.ts` loses one
  `canonical(` call with the removed inert `reviews.save` fake: `canonicalizer`
  11 → 10 in `docs/canonical-json-census.json`, written by `pnpm census:refresh`.
  The generator also rewrites two unrelated `reason` strings from the escaped
  `—` to the literal character; the JSON value is identical and the lines
  are generator output, left as produced. `pnpm test:census` — 13 passed.
- **Line citations.** `verification.ts:267` → `verification.ts:272` in
  `.specs/STATE.md` (AD-014 consequences) and
  `.specs/features/dsse-attestation/migration.md`. No citation of
  `task-verifier.ts`, `task-review.ts` or `self-test-full-scenario.ts` points
  at or below a changed line.
- **Not rewritten.** `docs/qualification/t60-validation.md` cites
  `tests/e2e/verification-human-review.test.mjs` by line; those lines moved by
  two (wider import). It is a qualification report, immutable for its recorded
  revision under `docs/AGENTS.md`, and its unit-test citations were already
  left as recorded by earlier changes, so it is intentionally unchanged.
- Migration count, runtime error catalog count and the digest-bound
  qualification reports are untouched; no dependency was added.

## Gates

| Command | Result |
| --- | --- |
| `node --test tests/unit/verification-ports.test.mjs` | PASS — 3 passed |
| `node --test tests/e2e/verification-human-review.test.mjs` | PASS — 13 passed |
| `pnpm test:mutation` | PASS — 8 passed |
| `pnpm test:architecture` | PASS — 61 passed |
| `pnpm gate:quick` | PASS — unit 2333, agent-readiness 315, census 13 |
| `pnpm gate:full` | PASS — unit 2333, contract 666, integration 770, e2e 229, fault 310, mutation 8 |
| `pnpm gate:security` | PASS — unit 2333, contract 666, e2e 229, architecture 61, qualification 272, security 1333, fault 310 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage.
