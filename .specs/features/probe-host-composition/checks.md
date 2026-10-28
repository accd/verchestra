# Probe host composition, slice 1 checks

Profile: light
Plan: `.specs/features/probe-host-composition/plan.md`

34 checks in 1 slice · 6 one-way doors · 1 open, of which 0 block

The proofs name tests this slice writes. `E` is
`tests/e2e/extension-cli-e2e.test.mjs`, `L` is
`tests/unit/skill-lock-file.test.mjs`, `A` is
`tests/unit/extension-approval-store.test.mjs`, `K` is
`tests/unit/extension-check.test.mjs`, and `G` is
`tests/architecture/extension-host-composition.test.mjs`. Every proof runs as
`node --test --test-name-pattern "<name>" <file>`. `approve` and `check` run only
on POSIX (AC 13), so their end-to-end cases run on Linux and macOS; on Windows
each asserts the refusal instead of skipping (repository rule XP-04).

## Checks

### S1 - register, approve, list, revoke and check a workspace probe worker · ~22 files · ~190 KB · ~50k

**C1** - `vestra extension add` writes the next lock generation with one skill whose `extensionRef` carries the given extension id and approval ref and whose entry digest is the file's sha256, and prints `lockDigest` and `generation` (AC 1)
Proof: `node --test --test-name-pattern "add registers the worker in a signed lock" tests/e2e/extension-cli-e2e.test.mjs`

**C2** - The lock and source signatures `add` writes verify against the Workspace's pinned trust anchor, and the registry accepts the lock (AC 1, door 2)
Proof: `node --test --test-name-pattern "a lock the store writes verifies against the pinned anchor" tests/unit/skill-lock-file.test.mjs`

**C3** - `init`'s placeholder lock `{"schemaVersion":1,"skills":[]}` is replaced by generation 1 on the first `add` (AC 2, door 1)
Proof: `node --test --test-name-pattern "the init placeholder becomes generation 1" tests/unit/skill-lock-file.test.mjs`

**C4** - Activating generation N+1 keeps generation N as `skills.lock.<N>.json` (door 1)
Proof: `node --test --test-name-pattern "the previous generation is kept for rollback" tests/unit/skill-lock-file.test.mjs`

**C5** - An entry path that leaves the Workspace, and one that names a link, are each refused with exit 5 and leave the lock file byte-identical (AC 3)
Proof: `node --test --test-name-pattern "add refuses an entry outside the Workspace or behind a link" tests/e2e/extension-cli-e2e.test.mjs`

**C6** - A lock edited after signing is refused by the production verifier with `VES_SKILL_SIGNATURE_INVALID`, and an unedited copy is accepted, so the signature decides (door 2, lesson L-001)
Proof: `node --test --test-name-pattern "an edited lock fails its signature" tests/unit/skill-lock-file.test.mjs`

**C7** - The lock and source signatures are DSSE envelopes with predicate type `https://accd.github.io/verchestra/attestation/skill-lock/v1`, signed under the purpose `approval`, and the Workspace key's purposes stay exactly `EVIDENCE_PURPOSES` (door 2)
Proof: `node --test --test-name-pattern "lock signatures use the existing approval purpose" tests/unit/skill-lock-file.test.mjs`

**C8** - After `add` and `approve`, a task command still unlocks the same Workspace key: the stored key's purposes did not change (door 2)
Proof: `node --test --test-name-pattern "the Workspace key still unlocks for task commands" tests/e2e/extension-cli-e2e.test.mjs`

**C9** - `vestra extension approve`, after the launch digest is typed back, writes an approval binding the lock's extension id, `lockDigest`, the entry's digest, and the launch digest `probeLaunchDigest` measures for the given executable, arguments and environment, with `expiresAt` from `--expires`, and prints them (AC 4)
Proof: `node --test --test-name-pattern "approve records the confirmed launch" tests/e2e/extension-cli-e2e.test.mjs`

**C10** - Without `--expires` an approval expires 30 days after it is recorded, and `--expires` more than 365 days ahead is refused with exit 2 (assumption, plan)
Proof: `node --test --test-name-pattern "approve defaults to 30 days and refuses more than 365" tests/e2e/extension-cli-e2e.test.mjs`

**C11** - A mistyped launch digest, and a non-interactive run without `--confirm-stdin`, each refuse with `VES_TASK_CONFIRMATION_REQUIRED`, exit 5, and write no approval (AC 5)
Proof: `node --test --test-name-pattern "approve writes nothing unless the launch digest is typed back" tests/e2e/extension-cli-e2e.test.mjs`

**C12** - A second `approve` for an approval ref with an unrevoked approval refuses with exit 5 and leaves the first record byte-identical (AC 6)
Proof: `node --test --test-name-pattern "approve refuses a second approval for the same ref" tests/e2e/extension-cli-e2e.test.mjs`

**C13** - `--env` naming a loader variable (`NODE_OPTIONS`), a secret-like one (`API_TOKEN`), and a reserved one (`VERCHESTRA_PROBE_WORKSPACE_ID`) is each refused with the code `SpawnedProbeWorker` uses for it, before any digest is measured (AC 7)
Proof: `node --test --test-name-pattern "approve refuses environment the worker would refuse" tests/e2e/extension-cli-e2e.test.mjs`

**C14** - `vestra extension list` prints every approval with `state` `active`, `expired`, `revoked` or `invalid` (signature does not verify), ordered by `approvalRef` in code-unit order, and an empty `approvals` array with exit 0 when there are none (AC 8)
Proof: `node --test --test-name-pattern "list reports each approval state in order" tests/e2e/extension-cli-e2e.test.mjs`

**C15** - `vestra extension revoke` on an active approval writes a signed revocation and prints `revokedAt`; `list` then reports `revoked` and `check` fails the approval (AC 9)
Proof: `node --test --test-name-pattern "revoke ends an approval" tests/e2e/extension-cli-e2e.test.mjs`

**C16** - `revoke` of an unknown approval ref, and of one already revoked, each refuse with exit 5 and write nothing (Surface)
Proof: `node --test --test-name-pattern "revoke refuses an unknown or revoked approval" tests/e2e/extension-cli-e2e.test.mjs`

**C17** - An approval record is a DSSE envelope at `<Workspace state>/extension-approvals/<approvalRef>.json` with predicate type `.../extension-approval/v1` and the body `{approvalRef, extensionId, lockDigest, componentDigest, launchDigest, launch, approvedAt, expiresAt}`; a revocation is `<approvalRef>.revoked.json` with predicate type `.../extension-approval-revocation/v1` (door 3)
Proof: `node --test --test-name-pattern "approval and revocation records have their declared shape" tests/unit/extension-approval-store.test.mjs`

**C18** - The approval lookup returns a record only when its signature verifies, it is unexpired, and no revocation verifies for it: an edited, an expired, and a revoked approval each return nothing, while the untouched one returns the record (door 3, AC 15, lesson L-001)
Proof: `node --test --test-name-pattern "lookup returns only a verified, unexpired, unrevoked approval" tests/unit/extension-approval-store.test.mjs`

**C19** - Two concurrent writes of an approval for the same ref leave exactly one record; the other refuses (door 3)
Proof: `node --test --test-name-pattern "two concurrent approvals for one ref leave one record" tests/unit/extension-approval-store.test.mjs`

**C20** - `vestra extension check` with the lock verified, the extension resolved, the approval active and matching, and the launch digest measured now equal to the approved one reports every check `pass` and exits 0 (AC 10)
Proof: `node --test --test-name-pattern "check passes an admissible worker" tests/e2e/extension-cli-e2e.test.mjs`

**C21** - `check` reports the failing prerequisite with its specific code and a recovery line, and exits 4, for each of: an invalid lock, an unresolved extension, an absent approval, an entry edited after `add`, and a launch whose executable changed after `approve` (AC 11)
Proof: `node --test --test-name-pattern "check names each failing prerequisite" tests/e2e/extension-cli-e2e.test.mjs`

**C22** - The check evaluator treats admission's `VES_EXECUTION_GRANT_REQUIRED` as the one passing outcome, and every other admission code (`VES_PROBE_WORKSPACE_TRUST_APPROVAL`, `VES_PROBE_WORKSPACE_TRUST_INVALID`, `VES_SKILL_SIGNATURE_INVALID`, an unexpected admission that succeeds without a grant) as a failure naming that code (AC 12)
Proof: `node --test --test-name-pattern "only a grant-required admission passes" tests/unit/extension-check.test.mjs`

**C23** - On `win32`, `approve` and `check` refuse with `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` and exit 5 before reading the Workspace (AC 13)
Proof: `node --test --test-name-pattern "approve and check refuse on win32" tests/unit/extension-check.test.mjs`
Proof: `node --test --test-name-pattern "approve and check refuse on Windows" tests/e2e/extension-cli-e2e.test.mjs`

**C24** - No workspace probe worker starts during a full `add`, `approve`, `list`, `check` and `revoke` journey: the reference worker's start marker is absent afterwards (AC 14)
Proof: `node --test --test-name-pattern "no worker starts during the extension commands" tests/e2e/extension-cli-e2e.test.mjs`

**C25** - The composition walk allows edges into `@verchestra/extension-host` only from the extension command module and only to `WorkspaceProbeAdmission` and its types; a probe module importing `FramedProbeWorker`, `ProbeWorkerSupervisor`, or `SpawnedProbeWorker` from there is flagged, as is an admission import from any other CLI module (AC 16, door 4)
Proof: `node --test --test-name-pattern "only the extension commands reach admission" tests/architecture/extension-host-composition.test.mjs`
Proof: `node --test --test-name-pattern "the walk flags spawning imports and other modules" tests/architecture/extension-host-composition.test.mjs`

**C26** - The release command manifest declares `extension add`, `approve`, `list`, `revoke` and `check`, and `vestra extension --help` names all five (door 5)
Proof: `node --test --test-name-pattern "the extension commands are declared and documented" tests/e2e/extension-cli-e2e.test.mjs`

**C27** - Each of `add`, `approve`, `revoke` and `check` with a missing required flag exits 2 with `VES_CLI_ARGUMENT_INVALID` (Surface)
Proof: `node --test --test-name-pattern "missing flags exit 2" tests/e2e/extension-cli-e2e.test.mjs`

**C28** - `list` and `check` outside a Workspace refuse with exit 5 (Surface)
Proof: `node --test --test-name-pattern "outside a Workspace the commands refuse" tests/e2e/extension-cli-e2e.test.mjs`

**C29** - `add` and `approve` without the evidence signing passphrase refuse with exit 5 and write nothing (Surface, dependency failure)
Proof: `node --test --test-name-pattern "signing commands refuse without the passphrase" tests/e2e/extension-cli-e2e.test.mjs`

**C30** - Every command's `--output json` envelope carries the fields its Surface row names (Surface)
Proof: `node --test --test-name-pattern "envelopes carry their declared fields" tests/e2e/extension-cli-e2e.test.mjs`

**C31** - `@verchestra/extension-host` declares an `exports` map, and the CLI declares it as a dependency (Impact)
Proof: `node --test --test-name-pattern "extension-host is an exported CLI dependency" tests/architecture/extension-host-composition.test.mjs`

**C32** - An approval that expired is reported `fail` by `check` with `VES_PROBE_WORKSPACE_TRUST_APPROVAL` and exit 4 (state transition active -> expired)
Proof: `node --test --test-name-pattern "check fails an expired approval" tests/e2e/extension-cli-e2e.test.mjs`

**C33** - `GovernedSkillRegistry.resolve` refuses a lock that holds no `tlc-spec-driven` entry with `VES_SKILL_TLC_REQUIRED`, for a profile that enables only TLC, so the code names the TLC rule and not an unknown Skill (door 6, lesson L-001)
Proof: `node --test --test-name-pattern "resolve refuses a lock without TLC" tests/unit/governed-skill-registry.test.mjs`

**C34** - A lock that holds only a probe worker passes `planUpdate` and `activate` (generation 1 -> 2, staged and committed) and `resolveExecutableExtension` (door 6)
Proof: `node --test --test-name-pattern "an extension-only lock passes updates and extension resolution" tests/unit/governed-skill-registry.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `vestra extension add` statuses (3) | exit 0 C1 · exit 2 C27 · exit 5 C5, C29 | - |
| `vestra extension approve` statuses (3) | exit 0 C9 · exit 2 C10, C27 · exit 5 C11, C12, C13, C23, C29 | - |
| `vestra extension list` statuses (2) | exit 0 C14 · exit 5 C28 | - |
| `vestra extension revoke` statuses (3) | exit 0 C15 · exit 2 C27 · exit 5 C16 | - |
| `vestra extension check` statuses (4) | exit 0 C20 · exit 2 C27 · exit 4 C21, C32 · exit 5 C23, C28 | - |
| approval states in `list` (4) | `active` C14 · `expired` C14 · `revoked` C14 · `invalid` C14, table-driven over all 4 | - |
| lookup outcomes (4) | verified C18 · edited C18 · expired C18 · revoked C18 | - |
| `check` prerequisites (5) | invalid lock C21 · unresolved extension C21 · absent approval C21 · edited entry C21 · changed executable C21, table-driven over all 5 | - |
| admission outcomes in `check` (5) | `VES_EXECUTION_GRANT_REQUIRED` C22 · `VES_PROBE_WORKSPACE_TRUST_APPROVAL` C22 · `VES_PROBE_WORKSPACE_TRUST_INVALID` C22 · `VES_SKILL_SIGNATURE_INVALID` C22 · admitted without a grant C22 | - |
| refused `--env` kinds (3) | loader C13 · secret-like C13 · reserved C13 | - |
| one-way doors (6) | door 1 C3, C4 · door 2 C2, C6, C7, C8 · door 3 C17, C18, C19 · door 4 C25 · door 5 C26 · door 6 C33, C34 | - |
| entities (4) | `SkillLock` C1, C3 · `LockedSkill`/`ExtensionRef` C1 · `ExtensionApproval` C9, C17 · `ApprovalRevocation` C15, C17 | - |
| platforms for `approve` and `check` (2) | POSIX C9, C20 · win32 C23 | - |
| startup config: the CLI command dispatch (2 assemblies) | `main.ts` routing C1 · release command manifest C26 | - |

- Claims naming an exit code or envelope field: C5, C9-C16, C20, C21, C23, C27-C30, C32 - each proof runs the CLI as a child process and reads its exit code and envelope
- C2, C3, C4, C6, C7, C17-C19, C22, C33 and C34 are proven at their own layer; the end-to-end journeys exercise them again but are not their proof

## Swept

- validation: C5, C10, C13, C27
- failure modes: C11, C12, C16, C29 (each writes nothing on refusal)
- idempotency: C12, C16
- authorization: C11 (AD-040's typed-back confirmation); the passphrase comes from the existing secret store (C29)
- concurrency: C19
- data lifecycle: C10 (expiry bound), C4 (previous generation kept), C32; deletion: n/a - an approval is never deleted, a revocation ends it
- dependency failure: C29 (secret store without the passphrase); C23 (platform)
- state transitions: lock generation N -> N+1 C1, C3, C34; approval active -> revoked C15, active -> expired C32
- observability: n/a - the command envelope is the record; this slice adds no logging requirement

## Handoff

- S1 = ~50k: ~117 KB of existing sources it reads or changes (the CLI dispatch, release manifest, task signing, confirmation, workspace and errors; the skill registry; admission; the spawned worker and launch digest; DSSE; the composition guard; the task CLI fixture) is ~29k, plus ~70 KB of new code and tests at ~18k, plus run output; under the 150k budget - one builder
