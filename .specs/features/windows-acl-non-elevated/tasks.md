# Owner-only ACL proof for a non-elevated Windows user: tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Reproduce on a non-elevated Windows 11 user: the real-host case fails at `replace`, `/restore` exit 1300 | `tests/security/windows-pipe-bridge-security.test.mjs` | Complete |
| T2 | Unit tests first: the grant's arguments, the standard-user path (grant, read-back, no restore), the refusal when the grant leaves other entries and the restore is refused, the runner path (grant, then restore) | `tests/unit/windows-acl.test.mjs` red before T3 | Complete |
| T3 | `ownerOnlyGrant` and the grant-then-restore order in `proveOwnerOnlyDirectory`; `isOwnerOnlyDacl` untouched | unit, security and `task-windows` tests green; mutation of the grant's verification killed | Complete |
| T4 | `docs/quick-start.md`: no elevation needed | `site:check` | Complete |
| T5 | Windows leg of the platform matrix on the branch head, and one recorded run on a non-elevated Windows user (#555's acceptance; a second person's machine qualifies but is not required) | CI run id and the non-elevated run recorded in `validation.md` | Complete: matrix run 39816518151 and the non-elevated run of T1 to T4; a second machine remains welcome |

## Delivery rule

Merge only after independent review, every required check green on the exact
head, and T5 recorded.
