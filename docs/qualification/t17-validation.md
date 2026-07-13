# T17 Validation — Isolated State Roots, Protected Paths, and Secret Broker

**Gate:** `corepack pnpm gate:security` plus `corepack pnpm test:integration`  
**Result:** 1,123 unit, 56 security, 42 integration, 10 architecture, 248 qualification, and 22 fault-injection cases passed with zero failures. Format, lint, strict TypeScript, build, and frozen offline installation passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Windows state root | `state-root.test.mjs` | `%LOCALAPPDATA%\Verchestra\state`, with home-local fallback | Yes |
| macOS state root | `state-root.test.mjs` | `~/Library/Application Support/Verchestra/state` | Yes |
| Linux state root | `state-root.test.mjs` | `$XDG_STATE_HOME/verchestra` or `~/.local/state/verchestra` | Yes |
| CI/explicit state | Explicit-root case | Absolute OS-native override; relative roots fail closed | Yes |
| Workspace layout | Unit and integration layout cases | Runtime, memory, backups, locks, caches, sessions, worktrees, and logs are isolated under stable Workspace identity | Yes |
| Idempotent materialization | Repeated integration case | Repeated creation produces the same verified root and no error | Yes |
| Junction-safe materialization | Junction escape integration case | Workspace redirection is rejected before any child state is created outside the owner | Yes |
| Logical path guards | Traversal corpus | Absolute, parent, mixed-separator, and multi-segment escapes fail before access | Yes |
| Resolved boundary | Symlink/junction escape case | Canonical target must remain under the granted real root | Yes |
| TOCTOU reduction | Replace/delete-before-open and replace-after-open cases | Real path plus device/inode identity is checked around opened file handles | Yes |
| Opaque path handles | Serialization, forgery, close cases | No absolute path serialization; only same-broker active handles can read | Yes |
| Opaque secret handles | Serialization and forgery cases | Handles carry safe logical metadata, never credential bytes | Yes |
| Ephemeral secret use | Success and throwing callback cases | Disposable bytes exist only inside callback scope and are zeroized in `finally` | Yes |
| Workspace secret isolation | Cross-broker and shared-adapter cases | Same logical name resolves independently per Workspace; foreign handles fail | Yes |
| Missing binding guidance | Missing-secret case | Stable error exposes logical name, expected store, purpose, and blocked capability only | Yes |
| Mock secret adapter | Snapshot/delete/non-serialization cases | Deterministic local conformance adapter does not expose stored values | Yes |
| Qualified OS adapters | Windows/macOS/Linux fixture matrix | CNG, Keychain, or Secret Service bridges activate only with complete attested controls | Yes |
| Native failure sanitization | Backend failure case | Private native wording remains in the cause and never becomes the public message | Yes |
| Public error contract | Exact catalog case | All 18 platform-security codes are frozen and validate against `public-error@1` | Yes |

## Check B — Non-shallow

The focused T17 suite contains 15 unit, 5 integration, and 37 platform security cases: 57 total against the required minimum of 35. Filesystem cases use real temporary directories, real opened file handles, real Windows junctions (or POSIX directory symlinks), file identity metadata, deletion/replacement races, and cleanup assertions. Secret cases use byte arrays rather than immutable strings and prove zeroization through retained references after both success and failure.

## Check C — Security model

- Canonical Git configuration contains only logical secret names. Secret values remain in a Workspace-scoped local adapter.
- `SecretHandle` and `ProtectedPathHandle` authenticity is held in private `WeakMap` state and is bound to one broker instance.
- The OS adapter is a qualified bridge boundary, not a claim that arbitrary platform commands are safe. It cannot be constructed without the complete platform-specific evidence contract established by T09.
- File access is performed through an opened handle. The path is resolved before open, then path and file identity are compared after open and around reads.
- Node lacks a portable `openat`/`O_NOFOLLOW` directory-capability API on every supported platform. The implementation therefore reduces TOCTOU through opened handles and before/after verification; stronger native helpers remain subject to platform qualification rather than being falsely advertised.

## Check D — Requirement mapping

| Requirement | Evidence |
| --- | --- |
| VES-BST-001 | Machine/runtime roots and handles contain no committed credential value or absolute tracked binding |
| VES-BST-002 | Deterministic root resolution and idempotent state materialization support clean bootstrap |
| VES-BST-003 | Missing-secret error reports logical name, expected local store, purpose, and blocked capability |
| VES-WSP-007 | Traversal, symlink, junction, Workspace mismatch, forgery, and replacement races fail closed |
| VES-SEC-003 | State paths, secret namespaces, adapters, brokers, and handles are Workspace-separated |
| VES-SEC-006 | Untrusted names/objects cannot forge handles, cross roots, or activate an unqualified secret backend |

## Adequacy verdict

PASS — cross-platform state locations, Workspace-isolated operational roots, opaque secret and path handles, qualified OS secret bridges, stable public failures, and hostile filesystem behavior are covered by 57 focused cases and the repository security gate.
