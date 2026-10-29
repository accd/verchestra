# Database registration, slice 2a checks

Profile: light
Plan: `.specs/features/database-registration/plan.md`

27 checks in 1 slice · 4 one-way doors · 0 open, of which 0 block

The proofs name tests this slice writes. `D` is
`tests/contract/database-command.test.mjs`: it runs `executeDatabaseCommand` and
`main()` in process against a Workspace the real `vestra init` set up, with the
fake keychain, so SonarCloud's coverage counts it (lesson of #682). `R` is
`tests/unit/database-registration-file.test.mjs`, `P` is
`tests/unit/database-access-policy.test.mjs`, `G` is
`tests/architecture/database-command-composition.test.mjs`, and `E` is
`tests/e2e/database-cli-e2e.test.mjs`. Every proof runs as
`node --test --test-name-pattern "<name>" <file>`. The definition fixture is a
PostgreSQL database `orders` with policy `maxRows` 100; a case names only what
it changes.

## Checks

### S1 - register, list and remove a Workspace database · ~20 files · ~320 KB · ~80k

**C1** - `vestra database add --definition <file>` exits 0 and writes `.verchestra/databases/orders.json`, whose payload `registration` deep-equals `normalizeDatabaseRegistration` of the definition's `database` with `schemaVersion` 1, this Workspace's id and `policyRef` `orders`, whose `policy` deep-equals `normalizeDatabaseAccessPolicy` of the definition's `policy` with `policyRef` `orders`, and whose `registeredAt` is an ISO 8601 instant between the call's start and end; it prints `databaseId` `orders`, that registration's `registrationDigest`, and `created: true` (AC 1, door 1)
Proof: `node --test --test-name-pattern "add writes a signed registration of the definition" tests/contract/database-command.test.mjs`

**C2** - The registration file is a DSSE envelope whose predicate type is `https://accd.github.io/verchestra/attestation/database-registration/v1`, signed by the Workspace evidence key under the purpose `approval`; it verifies against the Workspace's pinned trust anchor, and the stored key's purposes stay exactly `EVIDENCE_PURPOSES` (door 1)
Proof: `node --test --test-name-pattern "a registration the store writes verifies against the pinned anchor" tests/unit/database-registration-file.test.mjs`

**C3** - A registration whose payload `policy.maxRows` is edited after signing, with the signature kept, fails verification, while an unedited copy verifies, so the signature decides (door 1, lesson L-001)
Proof: `node --test --test-name-pattern "an edited registration fails its signature" tests/unit/database-registration-file.test.mjs`

**C4** - `add` refuses a definition whose registration fails validation with exit 5 and the validator's code, and leaves `.verchestra/databases/` without an entry, table-driven over 5 cases: engine `db2` -> `VES_DATABASE_ENGINE_UNSUPPORTED`; classification `top-secret`, `databaseId` `Orders`, `approvedSchemas` `[]`, `production` `"yes"` -> `VES_DATABASE_REGISTRATION_INVALID` (AC 2)
Proof: `node --test --test-name-pattern "add refuses an invalid registration and writes nothing" tests/contract/database-command.test.mjs`

**C5** - `add` refuses a definition whose policy fails validation with exit 5 and `VES_PROBE_POLICY_INVALID`, and writes nothing, table-driven over 4 cases: `maxRows` 0, `allowedObjects` `[]`, `allowCatalogAccess` `"no"`, `allowedObjects` `["orders"]` (no schema) (AC 3)
Proof: `node --test --test-name-pattern "add refuses an invalid policy and writes nothing" tests/contract/database-command.test.mjs`

**C6** - `add` refuses with exit 2, `VES_CLI_ARGUMENT_INVALID` naming `--definition`, and writes nothing, table-driven over 10 cases: no `--definition`, a missing file, a directory, text that is not JSON, a JSON array, an extra top-level key, `database` carrying `workspaceId`, `policy` carrying `policyRef`, `policy` without `maxBytes`, and `schemaVersion` 2 (AC 4, door 3)
Proof: `node --test --test-name-pattern "add refuses a definition file that is not a definition" tests/contract/database-command.test.mjs`

**C7** - A valid definition padded with whitespace to exactly 65,536 bytes is accepted (exit 0), and the same padded to 65,537 bytes is refused with exit 2 naming `--definition` (AC 4, door 3)
Proof: `node --test --test-name-pattern "the definition file is at most 64 KiB" tests/contract/database-command.test.mjs`

**C8** - `logicalCredentialName` `orders_reader`, which the registration validator accepts and `isValidLogicalSecretName` refuses, is refused with exit 5 and `VES_DATABASE_REGISTRATION_INVALID` and nothing is written, while `orders-reader.ro` is accepted (AC 5)
Proof: `node --test --test-name-pattern "add refuses a credential name vestra secret set refuses" tests/contract/database-command.test.mjs`

**C9** - With `orders` registered, `add` of the same id with `approvedSchemas` changed, and `add` of the same registration with `maxRows` 200, each refuse with exit 5 and `VES_DATABASE_REGISTRATION_CONFLICT`, and the existing file stays byte-identical (AC 6)
Proof: `node --test --test-name-pattern "add refuses different content for a registered id" tests/contract/database-command.test.mjs`

**C10** - With `orders` registered, `add` of the same definition, and of the same definition with its arrays reordered and one member repeated, each exit 0 with `created: false` and leave the file byte-identical (AC 7)
Proof: `node --test --test-name-pattern "add of the same definition again changes nothing" tests/contract/database-command.test.mjs`

**C11** - Two concurrent writes of `orders` with different policies, repeated in 25 fresh Workspaces: in each, exactly one returns `created: true`, the other rejects with `VES_DATABASE_REGISTRATION_CONFLICT`, the file verifies and holds the winner's registration and policy, and `.verchestra/databases/` holds exactly one entry (no temporary file is left) (AC 8, door 1)
Proof: `node --test --test-name-pattern "two concurrent adds of one id write one file" tests/unit/database-registration-file.test.mjs`

**C12** - After `add` of `orders_eu`, `billing`, `orders.eu` and `orders-eu` in that order, `list` exits 0 and prints them in the order `billing`, `orders-eu`, `orders.eu`, `orders_eu`, each with `state` `valid` and the `engine`, `logicalEnvironment`, `classification`, `production` and `registrationDigest` of its registration (AC 9)
Proof: `node --test --test-name-pattern "list orders registrations by id in code-unit order" tests/contract/database-command.test.mjs`

**C13** - `list` exits 0 and reports `{databaseId, state: "invalid"}`, `databaseId` being the entry's name without `.json`, beside a `valid` entry, table-driven over 6 entries: a payload edited after signing; a body signed by the Workspace key that fails validation (`maxRows` 0); a body signed by the Workspace key whose `workspaceId` is another Workspace's; a valid registration renamed `other.json`; a link named `linked.json` (a symbolic link to a valid registration on POSIX, a junction to a directory on Windows), which is not followed; and a file `notes.txt` (AC 10)
Proof: `node --test --test-name-pattern "list reports every registration that does not verify as invalid" tests/contract/database-command.test.mjs`

**C14** - `list` with no `.verchestra/databases/` directory, and with an empty one, exits 0 and prints `databases: []` (AC 11)
Proof: `node --test --test-name-pattern "list with no registration prints an empty array" tests/contract/database-command.test.mjs`

**C15** - `remove --database orders` exits 0, deletes `.verchestra/databases/orders.json`, prints `databaseId` `orders` and `removed: true`, and a following `list` omits it; removing a registration `list` reports `invalid` deletes it the same way (AC 12)
Proof: `node --test --test-name-pattern "remove deletes the registration file" tests/contract/database-command.test.mjs`

**C16** - `remove` refuses an unregistered id with exit 5 and `VES_DATABASE_NOT_FOUND`, and refuses `--database ../orders`, `--database Orders`, and no `--database` with exit 2 naming `--database`; in every case no file is deleted (AC 13)
Proof: `node --test --test-name-pattern "remove refuses an unknown or malformed database" tests/contract/database-command.test.mjs`

**C17** - When `.verchestra/databases` is a link (a symbolic link on POSIX, a junction on Windows) to a directory holding a valid registration, `add`, `list` and `remove` each exit 5 and the target directory stays byte-identical (swept: validation)
Proof: `node --test --test-name-pattern "the databases directory is never reached through a link" tests/contract/database-command.test.mjs`

**C18** - `WorkspaceDatabaseRegistrationStore.load` returns the registration deep-equal to the one written for a valid file, and `undefined` for each of C13's 6 entries and for an absent id; `list` of this Workspace's id returns exactly the valid registrations in code-unit order of `databaseId`, and `list` of another Workspace's id returns `[]` (AC 14, door 2)
Proof: `node --test --test-name-pattern "the store returns only registrations list reports valid" tests/unit/database-registration-file.test.mjs`

**C19** - `WorkspaceDatabaseRegistrationStore.save` rejects with `VES_DATABASE_REGISTRATION_INVALID` and writes nothing, because a Workspace registration is written only with its policy, by `vestra database add` (door 2)
Proof: `node --test --test-name-pattern "the store's save writes nothing" tests/unit/database-registration-file.test.mjs`

**C20** - With no signing passphrase bound, `add` of a valid definition exits 5 with `VES_TASK_NOT_CONFIGURED` and `requirement` `evidence-signing-passphrase` and writes nothing; `add` of a definition with engine `db2` reports `VES_DATABASE_ENGINE_UNSUPPORTED` instead, so no credential is read for a refused definition; `list` and `remove` succeed with none bound (swept: dependency failure)
Proof: `node --test --test-name-pattern "add reads the passphrase only for a valid definition" tests/contract/database-command.test.mjs`

**C21** - No module under `apps/vestra-cli/src/database/` imports `node:child_process`, `node:net`, `node:tls`, `node:dgram`, `node:http`, `node:https`, `node:http2` or `@verchestra/extension-host`, imports from `@verchestra/data-probe` anything but `normalizeDatabaseRegistration`, `normalizeDatabaseAccessPolicy`, `DatabaseProbeError` and types, or reads `process.platform` (AC 15, platforms assumption)
Proof: `node --test --test-name-pattern "the database family reaches no database client, worker or platform branch" tests/architecture/database-command-composition.test.mjs`

**C22** - While `add`, `list` and `remove` run in process, every `node:child_process` call names `git` (or `git.exe`) or one of the OS credential store's tools the keychain guard names, and no other executable (AC 15)
Proof: `node --test --test-name-pattern "database commands start only Git and the credential tool" tests/contract/database-command.test.mjs`

**C23** - Among the modules under `apps/vestra-cli/src`, only those under `database/` import `@verchestra/data-probe`, and `main.ts` reaches the database family only through a dynamic import (door 4)
Proof: `node --test --test-name-pattern "only the database family loads data-probe" tests/architecture/database-command-composition.test.mjs`

**C24** - `@verchestra/data-probe` exports `normalizeDatabaseAccessPolicy`, and `ProbePlanner.plan` refuses with `VES_PROBE_POLICY_INVALID` exactly the policies it refuses, table-driven over 4 policies (one valid, `maxRows` 0, an extra key, `allowedObjects` `[]`) (Flow, no second implementation)
Proof: `node --test --test-name-pattern "the planner normalizes its policy with the exported function" tests/unit/database-access-policy.test.mjs`

**C25** - The release command manifest declares `database add` with options exactly `definition` and `keychain` and `mutating` true, `database list` with no option and `mutating` false, and `database remove` with exactly `database` and `mutating` true, all three with `supportsJson` true (door 4, Surface)
Proof: `node --test --test-name-pattern "the database slice takes the options its Surface names" tests/contract/cli-surface.test.mjs`

**C26** - The pinned `--help` snapshot lists `database add`, `database list` and `database remove` with their summaries, and `SEALED_COMMANDS` and the sealed launcher's health report list the same three (lesson L-019)
Proof: `node --test --test-name-pattern "emits the exact canonical release output for --help" tests/e2e/cli-launchers-e2e.test.mjs`
Proof: `node --test --test-name-pattern "honest observations of the staged closure" tests/build/sealed-launcher-closure.test.mjs`

**C27** - Through the real launcher with `--output json`, in a disposable Workspace: `add` exits 0 with `created: true`; `add` again exits 0 with `created: false`; `add` with a changed policy exits 5 with `VES_DATABASE_REGISTRATION_CONFLICT`; `list` prints one `valid` entry; after `maxRows` is edited in the file `list` prints it `invalid`; `remove` exits 0 with `removed: true`; `list` prints `[]` (the plan's independent test)
Proof: `node --test --test-name-pattern "the plan's independent test" tests/e2e/database-cli-e2e.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `vestra database add` statuses (3) | exit 0 C1, C10 · exit 2 C6, C7 · exit 5 C4, C5, C8, C9, C17, C20 | - |
| `vestra database list` statuses (2) | exit 0 C12, C13, C14 · exit 5 C17 | - |
| `vestra database remove` statuses (3) | exit 0 C15 · exit 2 C16 · exit 5 C16, C17 | - |
| `list` states (2) | `valid` C12 · `invalid` C13 | - |
| entries `list` reports invalid (6) | edited payload C13 · signed invalid body C13 · foreign `workspaceId` C13 · renamed file C13 · link C13 · non-`.json` file C13, table-driven over all 6 | - |
| registration validator codes (2) | `VES_DATABASE_ENGINE_UNSUPPORTED` C4 · `VES_DATABASE_REGISTRATION_INVALID` C4, C8 | - |
| definition-file refusals (11) | no flag C6 · missing file C6 · directory C6 · not JSON C6 · array C6 · extra top-level key C6 · `database.workspaceId` C6 · `policy.policyRef` C6 · missing policy key C6 · `schemaVersion` 2 C6 · over 64 KiB C7 | - |
| `add` over an existing id (3) | same content C10 · different registration C9 · different policy C9 | - |
| store port methods (3) | `save` C19 · `load` C18 · `list` C18 | - |
| child processes AC 15 allows (2) | Git C22 · credential store tool C22 | - |
| one-way doors (4) | door 1 C1, C2, C3, C11 · door 2 C18, C19 · door 3 C6, C7 · door 4 C23, C25, C26 | - |
| entities (2) | `DatabaseRegistration` C1, C12 · `DatabaseAccessPolicy` C1, C5, C24 | - |
| pinned command lists (L-019) (4) | release manifest C25 · `cli-surface` C25 · `--help` snapshot C26 · `SEALED_COMMANDS` C26 | - |
| platforms run (2) | linux C27 (CI, WSL) · win32 C27 (local) | - |
| startup config: the CLI command dispatch (2 assemblies) | `main.ts` routing C23, C27 · release command manifest C25 | - |

- Claims naming an exit code or envelope field: C1, C4-C10, C12-C17, C20, C27 - each proof runs the command (in process through `executeDatabaseCommand` or `main()`, or the launcher for C27) and reads its exit code and envelope
- C2, C3, C11, C18, C19 are proven at the store's own layer; the command cases pass through it again but are not their proof
- macOS: C21 shows the family has no platform branch, and the nightly platform matrix runs `test:contract` on macOS after merge; no darwin run is claimed before merge

## Swept

- validation: C4, C5, C6, C7, C8, C16, C17
- failure modes: C4-C9, C16, C17, C20 (each refusal writes or deletes nothing)
- idempotency: C10
- authorization: C20 (the signing passphrase comes from the OS credential store); C2, C3 (the pinned Workspace trust anchor decides validity); `remove` needs no credential - whoever can write the repository can delete the file, and version control keeps its history (plan assumption)
- concurrency: C11
- data lifecycle: C15 (`remove` deletes, no tombstone - plan assumption); a registration is never rewritten (C9, C10)
- dependency failure: C20 (credential store without the passphrase); a Workspace outside Git - existing `openTaskWorkspace` refusal, `VES_TASK_NOT_CONFIGURED` with `requirement` `git-repository`
- state transitions: absent -> registered C1; registered -> absent C15; `valid` -> `invalid` by an edit C13, C27
- observability: n/a - the command envelope is the record; this slice adds no logging requirement

## Handoff

- S1 = ~80k: about 245 KB of files it modifies or mirrors (data-probe `index.ts`, `dsse.ts`, `release-manifest.ts`, `main.ts`, the three pinned-list tests, slice 1's extension modules and contract test, the task fixture) plus about 78 KB of new sources and tests, divided by four; under the 150k budget - one builder
- Settled in derivation: AC 15 was narrowed by the owner on 2026-10-29 (plan.md). Door 2's port has no policy in `save`, so the Workspace store's `save` writes nothing and refuses (C19); `add` writes door 1's document itself. A `list` entry that is `invalid` carries only `databaseId` (its name without `.json`) and `state` (C13)
