# T67 TUF Update Resolution and Download Staging Validation

## Scope

- Task: T67 — Implement TUF update resolution and download staging
- Requirements: VES-RLS-001…002, VES-SKL-006, and VES-CLI-004
- Commit target: `feat(distribution): add tuf update client`
- Focused evidence: 82 cases — 30 E2E, 40 security, and 12 fault-injection
- Required minimum: 40 security/E2E cases
- Qualified dependency: `tuf-js` 5.0.1 on Node 24.14.0
- Spec deviations: none

T67 resolves the T66 Hermetic Distribution Bundle through one persisted TUF trust view and stages its complete component closure without acquiring activation authority. The client bootstraps a locally pinned root, accepts sequential root/key rotation only through TUF threshold verification, resolves top-level and delegated targets, honors consistent snapshots, binds TUF length/hash/custom provenance to the exact bundle release view, and downloads every component into a content-addressed stage.

Online, mirror, offline, and air-gapped sources implement the same closed source port. Chunked downloads resume from the exact durable partial offset. Final files are accepted only after exact length and SHA-256 verification, and every retry revalidates existing files before reuse. The staging receipt embeds the independently verified immutable Hermetic Bundle, contains no machine path, and explicitly carries `activationAllowed: false`; T68 can therefore recompute closure without trusting a TUF cache, while T68 alone owns health gates, active-pointer mutation, rollback, and uninstall.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/e2e/tuf-update-client.test.mjs tests/e2e/tuf-source-adapters.test.mjs tests/security/tuf-update-security.test.mjs tests/fault-injection/tuf-update-faults.test.mjs` | PASS — 82 passed, 0 failed/skipped |
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm gate:security` | PASS — all repository stages, including 188 fault cases |

## Spec-anchored adequacy matrix

| Requirements / done-when criterion | Exact assertion evidence | Spec-defined outcome | Result |
| --- | --- | --- | --- |
| Trusted-root bootstrap and key rotation | E2E root-rotation case; security root replacement, threshold, signature, and expiry cases | Bootstrap trust is locally pinned; a new root must satisfy both old and new key thresholds before persistence | PASS |
| Online/mirror/offline/air-gap equivalence | Four source-mode fixture cases plus five production HTTPS/filesystem adapter journeys | Every mode resolves the same release semantics through the same trust contract | PASS |
| Delegated target resolution | Delegated-components E2E case; delegated signature/expiry/missing/mix security cases | Component targets are reachable only through verified delegation metadata and path scope | PASS |
| Rollback and freeze rejection | Older-metadata case; root/timestamp/snapshot/targets/delegated expiry cases | Previously trusted versions cannot decrease and expired metadata cannot hold a client on a frozen view | PASS |
| Threshold and metadata integrity | Threshold, corrupt-role, timestamp/snapshot/targets/delegated mix cases | Insufficient signatures and cross-version metadata combinations fail closed | PASS |
| One exact compatible release view | Release custom, component provenance, bundle length/hash, and requested-target cases | TUF metadata, manifest, platform, architecture, release ID, release digest, component ID, length, hash, and provenance agree exactly | PASS |
| Consistent snapshots and partial publication | Hash-prefixed E2E case; missing metadata/target and corrupt-byte cases | Metadata/target names are content/version consistent and incomplete repositories cannot produce a stage | PASS |
| Resumable bounded download | Interruption, zero/oversized chunk, length drift, corrupt/oversized partial, and exact-offset cases | Retry resumes exact durable bytes, rejects malformed source responses, and never accepts a mixed partial | PASS |
| Idempotent verified staging | Repeat, finalized-tamper, receipt-conflict, and receipt-byte-stability cases | Verified files are reused; changed files are re-downloaded; conflicting local state is not overwritten | PASS |
| Filesystem containment | T66 safe logical paths plus the T67 junction redirection case | No component or receipt can escape the content-addressed stage through lexical paths or symlink/junction chains | PASS |
| Production source containment | Filesystem traversal/reserved-name/root-junction/target-junction/bound cases; HTTPS scheme/credential/redirect/range/length cases | Source adapters are read-only, bounded, credential-free at the portable boundary, and cannot follow ambiguous paths or redirects | PASS |
| VES-CLI-004 staging boundary | Receipt authority and no-active-pointer E2E/fault cases | Successful resolution stops at a non-authoritative candidate; no active pointer is created or changed | PASS — activation deferred to T68 |

## Independent discrimination sensor

The standalone TLC Verifier used two detached disposable worktrees. The first copied the T67 core diff onto commit `cbba101`, installed the locked graph offline, committed an isolated baseline, injected five core behavior faults, restored after each run, and reran the then-current 66 cases. The second copied the final production source-adapter diff onto commit `a7e599d`, killed two adapter-specific faults, and reran all 16 adapter cases. Both scratch worktrees were removed safely; the active implementation files were never mutated by either sensor.

| Mutation | Behavior fault | Result |
| --- | --- | --- |
| M1 | Permit caller replacement of the pinned bootstrap root | KILLED |
| M2 | Ignore a TUF release ID that contradicts the signed bundle | KILLED |
| M3 | Restart a retained partial from offset zero instead of resuming | KILLED |
| M4 | Disable symlink/junction checks across the staging directory chain | KILLED |
| M5 | Mark a staged receipt as authorized for activation | KILLED |
| M6 | Follow filesystem root/target junctions outside the configured repository | KILLED |
| M7 | Accept a non-200 HTTPS metadata response/redirect | KILLED |

Sensor depth is P0/full manual behavior mutation: 7/7 killed, 0 survived. Standalone independent validation was used because agent delegation is prohibited in this environment.

## Non-shallow checks

- The test repository uses real Ed25519-signed root, timestamp, snapshot, targets, and delegated-target metadata consumed by production `tuf-js`, not a mocked trust decision.
- Root version 2 changes the root-role keys and is signed by both the prior and successor threshold sets.
- Consistent-snapshot repositories publish versioned metadata and hash-prefixed target names; the compatible non-consistent mode is also covered.
- Source identity and mode are local configuration; URL/credential-shaped source identities are rejected and repository content cannot rewrite the receipt identity.
- The production filesystem adapter supports mirror, offline, and air-gapped roots with bounded positional reads, lexical containment, reserved-name rejection, and root/segment junction checks.
- The production HTTPS adapter supports online and mirror repositories with credential-free HTTPS base URLs, disabled redirects, bounded metadata bodies, mandatory byte ranges, and exact `Content-Range` validation.
- The release manifest is itself a verified TUF target and then independently revalidated by the T66 semantic bundle verifier.
- The staged receipt embeds that verified immutable bundle so the activation boundary can recompute semantic closure and exact component projection without an implicit cache dependency.
- Every component is independently resolved through TUF, and TUF custom provenance must repeat its bundle release ID, component ID, and content digest.
- A partial file is append-only under expected-offset CAS, flushed before progress advances, and fully rehashed before rename.
- Existing final files are length/hash checked on every run; tampering forces re-download rather than optimistic reuse.
- Directory creation walks and inspects every segment, rejecting symlink/junction redirection before component bytes are written.
- The content-addressed stage contains a byte-stable receipt but no active pointer and no activation method.

## Verdict

PASS for T67. Verchestra now uses its qualified `tuf-js` runtime to resolve and stage one complete compatible Hermetic Distribution Bundle across online, mirrored, offline, and air-gapped sources, with pinned/rotatable trust, delegated targets, rollback/freeze/mix/threshold/expiry/partial defenses, resumable verified downloads, filesystem containment, and zero activation authority.
