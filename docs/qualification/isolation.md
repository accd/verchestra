# Worker Isolation and Framed Protocol Qualification

## Decision

Verchestra 1.0 qualifies JSON-RPC 2.0 semantics inside a `verchestra/1` envelope over `Content-Length` framed stdio. Local network sockets are not a default worker transport. Frames, handshakes, grants, filesystem paths, network destinations, Probe bounds, queues, and cancellation are controller-owned and fail closed.

The current Windows fixture qualifies only `process-contained`. It proves minimal environment construction, dedicated cwd, brokered path/network access, bounded queues/messages, and real parent-plus-descendant termination. It does **not** claim OS sandbox strength. High-risk untrusted executable work is blocked unless a separately attested `native-restricted` or `container-isolated` profile is available.

## Qualified runtime fixture

| Item | Qualified value |
| --- | --- |
| Node | 24.14.0 |
| Executed platform | Windows NT 10.0.26200.0, AMD64 |
| Tree termination fixture | `%SystemRoot%\\System32\\taskkill.exe /pid <pid> /t /f` |
| Portable transport | stdio, UTF-8 JSON, ASCII `Content-Length` header |
| Protocol major | `verchestra/1` exact |
| Default isolation grade | `process-contained` |

## Protocol contract

- `Content-Length` is the UTF-8 byte length, canonical non-negative decimal, unique, and bounded.
- Header and message limits apply before allocation or JSON interpretation.
- The envelope binds protocol, message/correlation IDs, Workspace, sequence, timestamp, schema reference, payload digest, and payload.
- Workspace mismatch, digest mismatch, invalid JSON/schema, sequence gaps, and incompatible duplicate IDs terminate the protocol grant.
- A byte-identical duplicate is idempotently ignored.
- Handshake requires exact protocol major, every required schema, exact component identity/digest, capability subset, and the smaller maximum message size.
- Event queues pause reads at high water, resume at low water, and require cancellation on capacity overflow; events are never silently dropped.

## Isolation contract

- A Skill receives no executable authority. Executable behavior must be reclassified as a Tool or Plugin and receive an explicit controller grant.
- Untrusted payloads cannot add capabilities or grant execution.
- Worker environment is constructed from an allowlist; ambient home, credential, token, and global-configuration values are not inherited.
- Secrets are represented only by opaque child-specific handle identifiers in this spike.
- Workers receive a dedicated cwd and explicit CPU, memory, process, output, wall-clock, concurrency, and message bounds. `process-contained` records these bounds but is not strong OS enforcement.
- Path authorization resolves both granted roots and candidates and rejects traversal, junction/symlink escape, and cross-Workspace requests.
- Network is default-deny and limited to an exact call-specific origin.
- Probe execution requires both a read-only database principal and engine-aware read-only session. Schema, table, denied-function, concurrency, timeout, row, and byte violations produce no promoted evidence.
- Cancellation records protocol cancel, grace expiry, process signal, signal grace expiry, and process-tree kill as applicable.

## Cross-platform strong-isolation evidence

No platform may advertise `native-restricted` from its OS name alone. A release must bind a helper digest and prove every required control:

| Platform fixture | Required native evidence |
| --- | --- |
| Windows | Job Object, restricted token, filesystem ACL boundary, network deny |
| Linux | namespaces, seccomp, cgroup v2, network namespace |
| macOS | signed App Sandbox/container profile, filesystem profile, network deny, process group |

Incomplete evidence leaves only `process-contained`; requested profiles are never silently downgraded. Windows production implementation should use Job Objects with kill-on-close and separately enforce token/filesystem/network restrictions. `taskkill /T` proves this fixture's tree-termination outcome but is not the production sandbox primitive.

## Production boundary

This dependency qualification spike is not the production Extension Host. Later tasks must implement and qualify native/container helpers, OS resource enforcement, secret-handle delivery, broker TOCTOU defenses using handles where available, destination resolution controls, evidence persistence, and the full Windows/macOS/Linux release matrix.

## Primary sources

- Node child processes: <https://nodejs.org/docs/latest-v24.x/api/child_process.html>
- Windows Job Objects: <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- Windows `taskkill`: <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill>
- Linux namespaces: <https://man7.org/linux/man-pages/man7/namespaces.7.html>
- Linux network namespaces: <https://man7.org/linux/man-pages/man7/network_namespaces.7.html>
- Apple App Sandbox: <https://developer.apple.com/documentation/security/app-sandbox>
