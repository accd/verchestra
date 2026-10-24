# Out-of-Process Probe Host Threat Model

Scope: a workspace-supplied probe worker executed by `SpawnedProbeWorker` and
driven by `ProbeWorkerSupervisor` through `FramedProbeWorker`. Method: assets,
trust boundaries, then STRIDE per boundary, each threat mapped to a control and
to the test that proves it (see `validation.md` for file and line).

## Assets

| Asset | Why it matters |
| --- | --- |
| Protected query parameters | Caller data delivered to the worker for one execution. |
| Result rows | Confidential database content; must stay behind the protected result reference. |
| Host environment and filesystem | Ambient credentials, tokens, provider sessions, home directory. |
| Host availability | The controller process and its memory, file descriptors, and time budget. |
| Evidence integrity | The result envelope binds plan, grant, principal, and session proofs. |
| Admission authority | Who may make workspace code run under product supervision. |

## Trust boundaries

1. **Lock and approval → admission.** Signed skill lock plus controller grant
   become a workspace trust value.
2. **Controller → child process.** Spawn: executable, arguments, environment,
   cwd, entry bytes.
3. **Child stdout → decoder.** Untrusted bytes become protocol envelopes.
4. **Child stderr → host diagnostics.** Untrusted bytes become retained text.
5. **Child process tree → host OS.** Lifetime of the worker and anything it
   forks.

## Threats and controls

| # | Boundary | STRIDE | Threat | Control | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1 | 1 | Spoofing | Unapproved workspace code gets admitted. | Admission requires a registry-resolved `extensionRef` with a non-empty `approvalRef` from a signature-verified lock, plus a controller grant; absent either, denied. | trust security suite |
| T2 | 1 | Tampering | A grant for one extension, lock, digest, approval, or Workspace is reused for another. | Every grant field must equal the admitted extension and Workspace. | trust security suite |
| T3 | 1 | Elevation | Code crafts a trust object literal to reach the workspace path. | Trust is minted into a module-private `WeakSet`; the supervisor rejects anything else. | forged-trust test |
| T4 | 1 | Elevation | A workspace worker impersonates a product worker by id. | The `probe-worker:` namespace is reserved; the product path still pins its hardcoded digest. | namespace and product-pin tests |
| T5 | 1 | Elevation | High-risk untrusted code runs under a weak grade. | The grant must be `approved-workspace-executable` + `process-contained`; `high-untrusted-executable` is refused with `VES_STRONG_ISOLATION_UNAVAILABLE`. | isolation-grade tests |
| T6 | 2 | Tampering | The worker file changes between digest check and exec (TOCTOU). | The host hashes the bytes once and executes a private `0500` copy written from those bytes in a `0700` directory. | private-copy test |
| T7 | 2 | Tampering | The worker self-reports the approved digest while running other code. | The host-measured launch digest must equal the approved digest, and the self-report must also match. | lie-digest test; supervisor digest check |
| T8 | 2 | Info disclosure | Ambient secrets reach the worker via the environment. | The environment is built from nothing; composition extras refuse reserved and secret-like names. | environment tests |
| T9 | 2 | Tampering | Shell injection through arguments. | `shell: false`, absolute executable, NUL-free arguments. | input refusal tests |
| T10 | 3 | DoS | Oversize frame or endless header exhausts memory. | Header and body limits before allocation; total stdout limit. | oversize and stdout-limit tests |
| T11 | 3 | Tampering | Malformed frames, wrong digest, foreign Workspace, extra envelope or payload keys. | Decoder rejects; exact key sets per payload schema. | malformed, digest, workspace, schema tests |
| T12 | 3 | Repudiation/Tampering | Replayed or reordered frames. | Strict sequence guard: any duplicate or gap terminates. | replay and stale-sequence tests |
| T13 | 3 | Info disclosure | The worker echoes the parameter into results. | Supervisor leak detection fails the probe; rows roll back. | leak test |
| T14 | 3 | Info disclosure | The worker's error text carries secrets or paths. | Worker errors are never relayed; a fixed code crosses. | error sanitization tests |
| T15 | 3 | Elevation | The worker skips read-only proofs or writes. | Identity and session proofs are required before execute (unchanged supervisor). | existing supervisor security suite plus framed contract |
| T16 | 4 | DoS | stderr flood. | Byte limit kills the tree; only a bounded excerpt is kept. | stderr flood test |
| T17 | 4 | Info disclosure | Secrets or parameters retained in stderr. | Excerpt sanitized for control characters and secret shapes; the parameter is scrubbed after the tree is dead. | leak test stderr assertions |
| T18 | 5 | DoS | The worker hangs (in any call). | The time bound aborts every worker call and kills the group. | hang tests |
| T19 | 5 | Elevation | The worker forks descendants that survive it, including via `setsid`. | Group kill plus a pre-kill descendant snapshot and sweep; the worker is torn down on every exit path, including success. | fork test |
| T20 | 5 | Info disclosure | Parameter bytes linger in host memory. | Delivered bytes and the outbound frame buffer are zeroized after the stream. | zeroization assertions |

## Residual risks (accepted, recorded, not claimed)

- **No OS sandbox.** An admitted worker can read the host user's files and open
  network connections directly. Mitigated only by the admission requirements
  (human-approved digest in a signed lock and a bound controller grant).
  Closing it requires the `native-restricted`/`container-isolated` grades.
- **Immutable strings.** The base64 parameter string and the decoded leak-check
  string cannot be zeroized by JavaScript; they become unreachable when the
  call returns. The same limitation exists on the in-process path.
- **Descendant escape (#569, 2026-10-24).** A detached descendant can outlive
  its worker, deterministically, not only in a race: the sweep finds only
  descendants still parented to the worker, so a worker that starts a `setsid`
  child and exits after `probe.result.end` returns `complete` with the child
  alive, and a double fork escapes on the timeout path too. T19's control does
  not hold against it. `ps` unavailability degrades to the group kill only;
  pid reuse between snapshot and sweep is tolerated (`EPERM`/`ESRCH` ignored).
- **Unbound launch (#569).** The grant binds the entry file only. The
  executable, the arguments and the environment extras are not bound, so
  `NODE_OPTIONS=--require`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`,
  `PYTHONPATH`, `NODE_PATH` or extra arguments can run code no approval named.
  T7's control measures the entry file, not what runs it.
- **Admission without authenticity (#569).** T1's control checks consistency,
  not authenticity: `admitWorkspaceProbeWorker` accepts any object as the
  extension, nothing ties it to `resolveExecutableExtension` or a verified
  lock, and `approvalRef` is never looked up. "Registry-resolved" and
  "signature-verified" in T1 describe the intended design, not the code.
- **No composition until fixed.** Nothing composes the host while the three
  limits above stand; `tests/architecture/extension-host-composition.test.mjs`
  fails on any import of it reachable from the CLI or the launcher.
- **Resource limits.** CPU and memory are not bounded beyond wall-clock time.
- **Windows.** Not supported; refused explicitly.
