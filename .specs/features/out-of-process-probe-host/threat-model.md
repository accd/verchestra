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
| T1 | 1 | Spoofing | Unapproved workspace code gets admitted. | Admission resolves the extension itself through the registry port (lock digest and signatures verified), looks `approvalRef` up through the approval port, and requires the approval to name that extension, its entry digest and a launch, plus a controller grant; absent any, denied. No extension value is accepted (#569). | trust security suite |
| T2 | 1 | Tampering | A grant for one extension, lock, digest, approval, launch, or Workspace is reused for another. | Every grant field must equal the admitted extension, its approval, and the Workspace. | trust security suite |
| T3 | 1 | Elevation | Code crafts a trust object literal to reach the workspace path. | Trust is minted into a module-private `WeakSet`; the supervisor rejects anything else. | forged-trust test |
| T4 | 1 | Elevation | A workspace worker impersonates a product worker by id. | The `probe-worker:` namespace is reserved; the product path still pins its hardcoded digest. | namespace and product-pin tests |
| T5 | 1 | Elevation | High-risk untrusted code runs under a weak grade. | The grant must be `approved-workspace-executable` + `process-contained`; `high-untrusted-executable` is refused with `VES_STRONG_ISOLATION_UNAVAILABLE`. | isolation-grade tests |
| T6 | 2 | Tampering | The worker file changes between digest check and exec (TOCTOU). | The host hashes the bytes once and executes a private `0500` copy written from those bytes in a `0700` directory. | private-copy test |
| T7 | 2 | Tampering | The worker self-reports the approved digest while running other code, or the launch runs code the approval never named. | The host-measured entry digest must equal the approved digest, and the self-report must also match. The host measures a launch digest over the executable's real path and bytes, the arguments, the environment extras and the entry, refuses a launch that differs from the approved one before it starts, and the supervisor refuses a transport whose launch is not the admitted one (#569). | lie-digest test; supervisor digest and launch checks; launch tests |
| T8 | 2 | Info disclosure, Elevation | Ambient secrets reach the worker via the environment, or a variable loads code. | The environment is built from nothing; composition extras refuse reserved and secret-like names, and loader variables (`NODE_*`, `LD_*`, `DYLD_*`, `PYTHON*` and the rest) even when the approval names them (#569). | environment and loader tests |
| T9 | 2 | Tampering | Shell injection through arguments. | `shell: false`, absolute executable, NUL-free arguments, and the arguments are part of the approved launch. | input refusal and launch tests |
| T10 | 3 | DoS | Oversize frame or endless header exhausts memory. | Header and body limits before allocation; total stdout limit. | oversize and stdout-limit tests |
| T11 | 3 | Tampering | Malformed frames, wrong digest, foreign Workspace, extra envelope or payload keys. | Decoder rejects; exact key sets per payload schema. | malformed, digest, workspace, schema tests |
| T12 | 3 | Repudiation/Tampering | Replayed or reordered frames. | Strict sequence guard: any duplicate or gap terminates. | replay and stale-sequence tests |
| T13 | 3 | Info disclosure | The worker echoes the parameter into results. | Supervisor leak detection fails the probe; rows roll back. | leak test |
| T14 | 3 | Info disclosure | The worker's error text carries secrets or paths. | Worker errors are never relayed; a fixed code crosses. | error sanitization tests |
| T15 | 3 | Elevation | The worker skips read-only proofs or writes. | Identity and session proofs are required before execute (unchanged supervisor). | existing supervisor security suite plus framed contract |
| T16 | 4 | DoS | stderr flood. | Byte limit kills the tree; only a bounded excerpt is kept. | stderr flood test |
| T17 | 4 | Info disclosure | Secrets or parameters retained in stderr. | Excerpt sanitized for control characters and secret shapes; the parameter is scrubbed after the tree is dead. | leak test stderr assertions |
| T18 | 5 | DoS | The worker hangs (in any call). | The time bound aborts every worker call and kills the group. | hang tests |
| T19 | 5 | Elevation | The worker forks descendants that survive it, including via `setsid`. | The host stops the group and every process linked to it by parentage, until a table shows nothing new, before it kills them; a worker that exited before the host ended it fails the probe; output still held after the kill, or a missing table, fails termination. The worker is torn down on every exit path, including success (#569). | fork, setsid, exit-first and output-holder tests; terminator integration tests |
| T20 | 5 | Info disclosure | Parameter bytes linger in host memory. | Delivered bytes and the outbound frame buffer are zeroized after the stream, also when termination fails. | zeroization assertions |

## Residual risks (accepted, recorded, not claimed)

- **No OS sandbox.** An admitted worker can read the host user's files and open
  network connections directly. Mitigated only by the admission requirements
  (human-approved digest in a signed lock and a bound controller grant).
  Closing it requires the `native-restricted`/`container-isolated` grades.
- **Immutable strings.** The base64 parameter string and the decoded leak-check
  string cannot be zeroized by JavaScript; they become unreachable when the
  call returns. The same limitation exists on the in-process path.
- **Descendant residual (#569).** A worker that exits before the host ends
  its session fails the probe (`VES_PROBE_WORKER_EXITED`), but a descendant it
  left outside its group, with its stdout and stderr given up, is not ended. A
  descendant orphaned by a double fork while the worker still runs, with its
  output given up, is neither ended nor detected: no process table links it,
  and no inherited descriptor reveals it. A descendant that keeps the worker's
  output fails the termination instead. Linux would need a PID namespace or a
  subreaper to reach the rest, and macOS has neither. Against hostile approved
  code this is part of the "No OS sandbox" risk above.
- **Executable between hash and exec (#569).** The host hashes the executable
  and runs that file by its real path, but unlike the entry it does not copy
  it, so a change between the two is not caught. The executable is a
  toolchain binary outside the Workspace.
- **Approval adapters (#569).** Admission trusts its approval port to answer
  only with an approval it verified, that is not revoked and has not expired.
  The adapter, and where approvals and grants are issued, are T3's.
- **No composition until ratified.** Nothing composes the host before the
  owner ratifies AD-037 as amended by #569;
  `tests/architecture/extension-host-composition.test.mjs` fails on any import
  of it reachable from the CLI or the launcher.
- **Resource limits.** CPU and memory are not bounded beyond wall-clock time.
- **Windows.** Not supported; refused explicitly.
