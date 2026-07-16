# T68 Transactional Activation, Rollback, and Uninstall Validation

## Scope

- Task: T68 — Implement transactional activation, health gates, rollback, and uninstall
- Requirements: VES-CLI-001…004, VES-RLS-001…002, and VES-BST-005
- Commit target: `feat(distribution): add atomic activation rollback`
- Focused evidence: 55 cases — 25 integration, 17 fault-injection, and 13 security
- Required minimum: 35 platform/fault cases
- Spec deviations: none

T68 consumes only the non-authoritative T67 staged receipt. It reopens the persisted receipt, independently verifies its embedded T66 Hermetic Bundle, checks the exact component projection, and hashes every staged byte before copying only the declared closure into a same-volume transaction. Publication requires migration, native, and Driver smoke evidence plus byte-equivalent `vestra`/`verchestra` launcher evidence for semantic version, release digest, normalized behavior, and successful exit.

The transaction publishes an immutable version-addressed release directory before atomically replacing the small active pointer. A durable journal distinguishes PREPARED, PUBLISHED, and COMMITTED states; retries reconcile release publication and pointer acknowledgement loss without duplicating release roots or losing the prior active version. Rollback revalidates installed bytes and reruns health before changing the pointer. Uninstall removes only managed pointer/journal/transaction/release state according to its explicit purge policy and preserves user-owned data.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/integration/transactional-activation.test.mjs tests/security/transactional-activation-security.test.mjs tests/fault-injection/transactional-activation-faults.test.mjs` | PASS — 55 passed, 0 failed/skipped |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm gate:full` | PASS — exact task gate across format, lint, typecheck, unit/property, contract, integration, E2E, architecture, qualification, security, and 205 fault cases |
| `pnpm gate:security` | PASS — all repository stages on the exact T68 state |

## Spec-anchored adequacy matrix

| Requirements / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Complete same-release activation | Complete-stage, published-closure, projection, platform, stage-ID, and persisted-receipt cases | Only one reverified T66/T67 release closure can enter a transaction | PASS |
| Migration/native/Driver health | Three required-check cases plus adapter-failure and recovery cases | Every required smoke gate passes with content-addressed evidence before publication | PASS |
| VES-CLI-001…003 launcher equivalence | Version/digest/behavior/exit/missing/duplicate launcher cases | Both canonical launchers report one release and normalized behavior before activation | PASS |
| VES-CLI-004 last-known-good | Health, stage tamper, wrong platform, crash, and pointer cases | Every pre-pointer failure leaves the former active release selected | PASS |
| Versioned publication and atomic pointer | Published-directory, small-pointer, update, repeat, and pointer-no-op discrimination cases | Release bytes publish once under digest identity; authority changes only through the pointer | PASS |
| Crash reconciliation | Seven fault points from copy through committed journal plus publish-inactive and acknowledgement-loss cases | Retry converges whether the candidate is unprepared, prepared, published, pointer-active, or committed | PASS |
| Exclusive ownership and stale-lock recovery | Busy/current-PID/dead-PID cases | Live activation cannot be stolen; a dead process lock can be reclaimed for journal reconciliation | PASS |
| Verified rollback | Success, missing, component-tamper, health-failure, and pointer-acknowledgement cases | Rollback selects only a present, byte-valid, health-valid release and converges after lost acknowledgement | PASS |
| Safe uninstall / VES-BST-005 | purge/non-purge, invalid-policy, lock, and user-owned-file cases | Managed install state is removed according to policy while user data remains untouched | PASS |
| Filesystem and schema containment | Staging-root/transaction junction, closed receipt/health/pointer, unsupported-target cases | Junctions and unknown authority-bearing fields cannot redirect or broaden activation | PASS |

## Independent discrimination sensor

The standalone TLC Verifier copied the complete uncommitted T68 diff onto commit `8d57cfb` in a detached disposable worktree, installed the locked graph offline, committed an isolated baseline, injected one production behavior fault at a time, restored after every run, reran all 55 focused cases, and safely removed the scratch worktree. The active implementation files were never mutated by the sensor.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Ignore a same-length staged component hash mismatch | KILLED |
| M2 | Accept incomplete migration/native/Driver health evidence | KILLED |
| M3 | Ignore launcher normalized-behavior divergence | KILLED |
| M4 | Return activation success without changing the active pointer | KILLED |
| M5 | Ignore a foreign in-progress activation journal | KILLED |

Sensor depth is P0/full manual behavior mutation: 5/5 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The activation input and persisted stage receipt must be byte-semantically identical and contain the independently verifiable Hermetic Bundle.
- Receipt, pointer, health, nested check, and launcher schemas are closed at runtime; TypeScript types are not treated as a security boundary.
- Stage and installed components are length- and SHA-256-verified through real file reads; same-length tampering is detected.
- The transaction copies only manifest-declared component paths and rejects root, stage, transaction, and component junction/symlink redirection.
- Health evidence contains exactly migration, native, and Driver checks plus exactly two canonical launchers.
- Candidate bytes are health-checked before the release directory rename; the active pointer changes only after publication.
- PREPARED/PUBLISHED/COMMITTED journal identity is bound to target and previous pointers; a foreign target blocks new work.
- Every injected crash boundary can be retried; publication and pointer acknowledgement loss return one observable release and pointer.
- Lock acquisition uses exclusive creation, live-PID refusal, dead-PID quarantine/reclaim, nonce comparison, and owner-exact release.
- Installed release reuse and rollback both rehash bytes; neither trusts directory presence or a prior receipt alone.
- Uninstall validates its purge policy at runtime and deletes only managed names under the install root, preserving unrelated data.

## Verdict

PASS for T68. Verchestra now transforms a verified non-authoritative TUF stage into one health-qualified versioned installation with an atomic active pointer, durable crash reconciliation, last-known-good preservation, verified rollback, exclusive ownership recovery, launcher equivalence, and data-preserving uninstall.
