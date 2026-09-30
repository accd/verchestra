# macOS Keychain Credential Backend Qualification

**Scope:** issue #379, decision AD-034
**Status:** Qualified on darwin (one owner machine). The contract and the command protocol are proven by gate tests. Real-keychain evidence is **recorded** (see "Real-keychain evidence"). Independent review is pending.
**Adapter:** `apple-keychain-credential` (`QualifiedOsCredentialAdapter` over `DarwinKeychainBackend`)

## Qualification boundary

This report qualifies one thing: storing a **readable provider credential**
(an API key that a governed task later injects into a child process) as a
generic-password item in a macOS keychain, through the system tool
`/usr/bin/security`. It does not qualify key material. Signing and recipient
keys stay on the separate key-material contract, which still requires
`non-exportable` storage, and this backend's evidence cannot satisfy that
contract (asserted in `tests/security/os-secret-backend-security.test.mjs`).

Linux and Windows have their own credential backends and reports (AD-041):
`os-secret-backend-linux.md` (Secret Service) and
`os-secret-backend-windows.md` (Credential Manager). On any other platform
every `vestra secret` command reports `VES_SECRET_STORE_UNQUALIFIED` and deep
doctor's secret-presence check stays `blocked`.

## Controls claimed

| Control | Meaning | Proof |
| --- | --- | --- |
| `keychain` | The value is a generic-password item in a macOS keychain file, encrypted at rest and unlocked with the user's session. | Gate: the command protocol against a fake runner. Real round trip: `pnpm qualify:keychain` (recorded) |
| `user-scope` | Items live in the invoking user's keychain. By default that is the login keychain. `--keychain <path>` selects a keychain file, which must be owned by the invoking user. | `tests/unit/os-secret-backend-darwin.test.mjs` keychain-file checks |
| `workspace-namespace` | The item's service is `verchestra/<workspaceId>` and its account is the logical name. One Workspace's name never resolves another Workspace's credential. | Workspace-binding cases in the security test and in `tests/integration/doctor-secret-backend.test.mjs` |
| `not-in-argv` | The value never appears in any process argv or environment. A write sends the hex-encoded value over stdin to `security -i`. A read takes it from the child's captured stderr. The child environment is an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`). | Security test: argv, environment, error, and output assertions |
| `presence-without-value` | Presence is `find-generic-password` without `-g` or `-w`: it returns item attributes, never the value. Deep doctor receives only this operation. | Unit and doctor tests assert that no presence or doctor call carries `-g` or `-w` |

## Controls not claimed

- **`non-exportable`.** A credential that must be handed to a child process is
  readable by construction. Claiming it would be false.
- **`access-control` beyond the keychain's own.** Items are created with
  `-T /usr/bin/security`, the same trust the tool grants its own items by
  default. Any process running as the same user can call that tool and read
  the item without a prompt. That is the macOS model for a CLI-owned item, and
  it is recorded here as a limit, not presented as isolation.

## Measured behavior of `security` that shaped the design

Each of these was observed on macOS while building this backend. Each one is
now a guarded invariant with a test.

1. **Silent fallback to the login keychain.** `add-generic-password` given a
   missing file, a non-keychain file, or a directory as its keychain argument
   exits 0 and writes to the default keychain. The backend checks the named
   file before every operation: it must be a regular file (not a symlink),
   owned by the user, and start with the keychain magic `kych`. The backend
   never calls `security` to make this check, because asking `security` about a
   locked keychain raises an unlock dialog.
2. **A 4095-byte interactive line.** `security -i` reads each command into a
   4096-byte buffer. A longer line is split: the tail runs as a separate
   command and is echoed to stderr, and the truncated head loses its keychain
   argument and lands in the default keychain. The backend derives
   `MAX_CREDENTIAL_VALUE_BYTES` from the worst-case line (longest namespace,
   logical name, and keychain path). It refuses a larger value before
   spawning anything, and asserts the line length again before writing.
3. **Ambiguous `-w` output.** `-w` prints a printable value raw but prints a
   value with any non-printable byte as bare hex, with no marker. The backend
   reads with `-g`, whose `password: 0x…` form marks hex unambiguously.
4. **Updating an item in place with `-U` together with `-T` rewrites its
   access list and raises an approval dialog.** A rotation therefore deletes
   the old item and adds a fresh one, and never uses `-U`. This makes rotation
   non-atomic. A failure after the delete is reported as
   `VES_SECRET_ROTATION_INCOMPLETE` (the credential is now absent; run
   `vestra secret set` again).
5. **Prompts block instead of failing.** A locked keychain, or an item another
   application created, can raise a GUI dialog. The tool offers no switch to
   refuse user interaction. Every spawn is bounded (presence 4 s, inside deep
   doctor's 5 s probe budget; read 30 s; write 15 s). A timeout is reported as
   `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`, never as a hang.

## Value policy

A credential value is 1 to `MAX_CREDENTIAL_VALUE_BYTES` bytes of printable ASCII
without whitespace (0x21-0x7e). Every provider API-key format fits, and stray
whitespace from a paste is refused instead of stored. `vestra secret set` reads
the value from stdin and strips exactly one trailing newline. From a terminal it
reads without echo. The composition root and the backend zero their value
buffers after use. Node strings cannot be zeroed, and the value is never held
in one.

## Evidence

### Gate evidence (every platform, never spawns `security`)

No gate suite spawns `/usr/bin/security`.
`tests/architecture/no-keychain-spawn-in-tests.test.mjs` proves it: no gate
test names the real runner or spawns the tool, and every test that can reach a
credential store preloads `tests/helpers/deny-keychain-spawn.mjs`, which makes
any such spawn throw.

- `tests/unit/os-secret-backend-darwin.test.mjs`: command protocol, exit-code
  mapping, the line budget, rotation, the access-list invariant, timeout
  mapping, and keychain-file checks (a missing or non-keychain path spawns
  nothing), against a fake runner.
- `tests/security/os-secret-backend-security.test.mjs`: argv, environment,
  error and output non-disclosure, Workspace binding, name validation,
  `--keychain` reaching every invocation, the key-material contract, and the
  digest binding this report to the evidence constant.
- `tests/integration/doctor-secret-backend.test.mjs`: deep doctor's `pass`,
  `blocked`, and `fail` mappings for the credential check.
- `tests/e2e/secret-cli-e2e.test.mjs`: the `vestra` binary as a child process,
  for every refusal that happens before a keychain is consulted.

### Real-keychain evidence — RECORDED

The real round trip is the standalone suite `spikes/os-secret-store/test/`.
It runs set, has, read, rotate, and delete through `/usr/bin/security`, the
fallback guard, the oversize refusal, and the full `vestra secret` and
`doctor --deep` journey, with doctor reporting `pass` for a bound credential.
It is not part of any gate. Each case creates a disposable keychain file with
a random password, unlocks it, disables its auto-lock, and deletes it
afterwards. Every call goes through a runner that refuses to spawn unless the
call names that file. The file's own attribute dump then proves exactly which
items the case left. The suite never reads or writes the login keychain, the
search list, or the default keychain. On a platform other than darwin it
asserts that the store is refused. It does not skip.

Recorded run (2026-09-30):

- Revision: `4dde7e9` (`origin/main`), macOS 26.6.2 on arm64, Node 24.14.0,
  from an unlocked desktop session.
- Command: `corepack pnpm qualify:keychain`.
- Result: 8 tests, 8 passed, 0 failed, 0 skipped, 0 todo:
  - set, has, read, update, and delete round trip in a disposable keychain;
  - an unusable keychain path is refused before `security` is ever spawned;
  - an oversize value never reaches `security`;
  - the real runner kills a child at its timeout and reports it;
  - the `set`, `status`, `doctor`, and `delete` journey against a disposable
    keychain;
  - an oversize or empty value is refused and never echoed;
  - an unusable `--keychain` path is refused before any keychain command;
  - the secret commands refuse an uninitialized directory and an invalid name.
- No keychain dialog appeared. The output of `security list-keychains -d user`
  was byte-identical before and after the run.

This proves the darwin credential contract on one owner machine. Independent
review of this report is still pending.

A second run, in CI: the `credential-store (macOS)` job of run
[36681219761](https://github.com/accd/verchestra/actions/runs/36681219761)
(`.github/workflows/os-credential-store.yml`, revision
`95fbf7704bfe57e1a59d18053efdaed0ae809b2f`, image `macos-26-arm64`
20260907.0351.1, Node v24.14.0) passed the same suite, extended by AD-041 with
the Linux and Windows cases that assert refusal on macOS: 20 tests, 20 passed,
0 failed, 0 skipped, 0 todo. The macOS cases are the ones above.
