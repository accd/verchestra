# Linux Secret Service Credential Backend Qualification

**Scope:** issue #379, decision AD-041 (extends AD-034)
**Status:** Candidate. The contract and the command protocol are proven by gate tests, and the real Secret Service round trip passed in CI (see "Real-store evidence"). Independent review is pending.
**Adapter:** `secret-service-credential` (`QualifiedOsCredentialAdapter` over `LinuxSecretServiceBackend`)

## Qualification boundary

This report qualifies one thing: storing a **readable provider credential**
(an API key that a governed task later injects into a child process) as an item
in the invoking user's Secret Service (the freedesktop.org D-Bus API that
gnome-keyring and KeePassXC implement), through two system programs at fixed
paths: libsecret's `/usr/bin/secret-tool` and D-Bus's `/usr/bin/dbus-send`. It
does not qualify key material. Signing and recipient keys stay on the separate
key-material contract, which still requires a locked collection and access
control this backend does not claim, and this backend's evidence cannot satisfy
that contract (asserted in `tests/security/os-secret-backend-security.test.mjs`).

The store needs a Secret Service provider on the user's D-Bus session bus.
Without one, every `vestra secret` command reports
`VES_SECRET_STORE_UNAVAILABLE` and deep doctor's secret-presence check reports
`blocked` (not configured), never `pass`.

## Controls claimed

| Control | Meaning | Proof |
| --- | --- | --- |
| `secret-service` | The value is an item in the Secret Service's default collection, stored by `secret-tool store` and encrypted at rest by the provider (gnome-keyring encrypts the login keyring with the user's login password). | Gate: the command protocol against a fake runner. Real round trip: `pnpm qualify:keychain` on Linux (below) |
| `user-scope` | Items live in the invoking user's session keyring, reached only through that user's session bus. The child environment carries `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` and never `DISPLAY`, so a missing bus is reported, not autolaunched. | `tests/unit/os-secret-backend-linux.test.mjs` environment allowlist |
| `workspace-namespace` | The item's attributes are `service=verchestra/<workspaceId>` and `account=<logical name>`. One Workspace's name never resolves another Workspace's credential. | Workspace-binding cases in `tests/security/os-credential-cross-platform-security.test.mjs` and `tests/integration/doctor-secret-backend.test.mjs` |
| `not-in-argv` | The value never appears in any process argv or environment. A write sends the raw value over `secret-tool store`'s stdin. A read takes it from `secret-tool lookup`'s captured stdout. The child environment is an allowlist (`PATH=/usr/bin:/bin`, `LC_ALL=C`, `HOME`, `USER`, `LOGNAME`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`). | Cross-platform security test: argv, environment, error, and output assertions |
| `presence-without-value` | Presence is the Secret Service's own `SearchItems` method, called through `dbus-send`. It returns the paths of the matching unlocked and locked items and never a secret. Deep doctor receives only this operation. | Unit and doctor tests assert presence is `dbus-send` SearchItems only; the real run asserts the reply carries no value |

## Controls not claimed

- **`non-exportable`.** A credential that must be handed to a child process is
  readable by construction.
- **`access-control` beyond the session's own.** Any process running as the same
  user on the same session bus can ask the Secret Service for the item. While
  the collection is unlocked it is returned without a prompt. That is the
  Secret Service model for a user-owned item, recorded here as a limit.
- **`locked-collection`.** The backend does not lock the collection or require
  it to be locked. It reports a locked item as needing the user (below).
- **Rotation atomicity beyond the provider's.** `secret-tool store` replaces the
  item with the same attributes in one call, so a rotation never leaves the
  credential absent. The provider's own write is trusted to be atomic.

## Measured behavior that shaped the design

Each of these was observed against the real tools in a disposable gnome-keyring
session (Ubuntu, libsecret-tools and gnome-keyring from the distribution).
Each one is a guarded invariant with a test.

1. **`secret-tool search` prints the secret.** It loads the value with the
   attributes (`secret = …`). Presence therefore does not use it, and uses the
   attribute-only `SearchItems` D-Bus method instead.
2. **A lookup of a locked item misses silently.** With no prompter in the
   session, `secret-tool lookup` on an item in a locked collection exits 1 with
   no output, exactly like a missing item. A read miss is therefore confirmed
   by `SearchItems`: an item found only among the locked paths is
   `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED` ("unlock the keyring"), never
   "absent". Presence and delete use `SearchItems` directly and report the same.
3. **A store into a locked collection fails with its reason.** `secret-tool
   store` exits 1 with "Cannot create an item in a locked collection", mapped to
   `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`.
4. **A miss exits 1 silently, for lookup and for clear.** `secret-tool clear`
   of nothing exits 1 with no output. Delete therefore decides from presence
   before and after, never from `clear`'s exit status.
5. **A piped lookup prints exactly the value.** `secret-tool` appends a newline
   only when stdout is a terminal.
6. **No session bus is a named error.** Without a reachable bus the tools exit
   1 and name the connection failure on stderr. That wording (kept stable with
   `LC_ALL=C`) selects `VES_SECRET_STORE_UNAVAILABLE`; no stderr text ever
   reaches an error. A missing program is the same code.
7. **Presence is fast.** `SearchItems` answered in about 10 ms, far inside deep
   doctor's 5 s probe budget. Every spawn is still bounded (presence 4 s, read
   30 s, write 15 s), and a timeout is `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`
   (an unlock prompt nobody answered).

## Value policy

The same policy as every platform: 1 to `MAX_CREDENTIAL_VALUE_BYTES` (1416)
bytes of printable ASCII without whitespace. The limit is macOS's line budget,
kept uniform so a credential that binds on one platform binds on all. An
invalid value is refused before any process is spawned.

## Evidence

### Gate evidence (every platform, never spawns a store program)

No gate suite spawns `secret-tool`, `dbus-send`'s Secret Service call, or any
other store program. `tests/architecture/no-keychain-spawn-in-tests.test.mjs`
proves it, and `tests/helpers/deny-keychain-spawn.mjs` makes any such spawn
throw.

- `tests/unit/os-secret-backend-linux.test.mjs`: argv, stdin, timeouts,
  SearchItems parsing, locked and missing items, error classification, missing
  tools, rotation, delete, the environment allowlist, and the platform mapping.
- `tests/security/os-credential-cross-platform-security.test.mjs`: argv,
  environment, error, and output non-disclosure; presence never receives the
  value; Workspace binding; `--keychain` refused; not-configured stores.
- `tests/integration/doctor-secret-backend.test.mjs`: deep doctor's `pass`,
  `blocked`, and `fail` on Linux.

### Real-store evidence

The standalone suite `spikes/os-secret-store/test/` (`pnpm qualify:keychain`)
runs on Linux inside a disposable session it creates: a private `dbus-daemon`
from a generated configuration with no service directories (nothing is ever
D-Bus activated), and a foreground gnome-keyring daemon with a temporary HOME
that creates and unlocks a new login keyring from a random password. Every
call goes through a runner that refuses to spawn unless the child environment
names that bus, so the suite never reaches the invoking user's session bus or
keyring. The keyring's own search proves which items each case left. The suite
covers the round trip, rotation, the maximum value, the tool conventions above,
presence timing and non-disclosure, a missing bus, a locked collection, the
value policy, and the full `vestra secret` and `doctor --deep` journey with
doctor reporting `pass` for a bound credential.

It runs in `.github/workflows/os-credential-store.yml`, which installs
`libsecret-tools`, `gnome-keyring`, and `dbus-x11` on `ubuntu-latest`.

### Recorded result

| Field | Value |
| --- | --- |
| Result | **PASS** — 20 tests, 20 passed, 0 failed, 0 skipped, 0 todo, 0 cancelled |
| Run | [36681219761](https://github.com/accd/verchestra/actions/runs/36681219761) (`workflow_dispatch`), job `credential-store (Linux)` 109776889838 |
| Revision | `95fbf7704bfe57e1a59d18053efdaed0ae809b2f` on `feat/379-linux-windows-credential-stores` |
| Runner | `ubuntu-24.04` image 20260920.314.1, linux x64, Node v24.14.0 |
| Packages | `libsecret-tools` 0.21.4-1build3, `gnome-keyring` 46.1-2ubuntu0.2, `dbus-x11` 1.14.10-4ubuntu4.1; `dbus-send` from the image |
| Measured | presence (`SearchItems`) 4 ms; on a locked collection presence, read, delete, and store each reported interaction required in 4 to 29 ms |

The same run passed the Windows and macOS legs (below and in their own
reports), and on this leg the Windows and macOS cases asserted that their
backends are refused on Linux. This report changes only by recording results;
the revision after it differs from the tested one in documentation and in the
evidence digests alone.
