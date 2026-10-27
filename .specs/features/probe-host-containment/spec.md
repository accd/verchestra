# Probe host containment (#569)

## Problem

The post-merge review of #424 (#553) found three places where the
out-of-process probe host's containment claims exceed the code. #590 stated
them as limits in `adr.md`, `threat-model.md` and AD-037. This change is the
code half #569 still holds open, and the host's T3 (composition) waits for it.

1. **Descendant escape.** The terminator sweeps only descendants still parented
   to the worker. A worker that starts a `setsid` child and exits after
   `probe.result.end` completes with the child alive, and a double fork
   escapes on the timeout path too.
2. **Unbound launch.** The grant binds the entry file only. The executable, the
   arguments and the environment extras are not bound, so
   `NODE_OPTIONS=--require` ran code no approval named.
3. **Admission without authenticity.** `admitWorkspaceProbeWorker` accepts any
   object as the extension. Nothing ties it to `resolveExecutableExtension` or
   a verified lock, and `approvalRef` is never looked up.

## Requirements

- **PHC-01**: The grant and the approval SHALL bind a launch digest: SHA-256
  over the RFC 8785 encoding of the executable's real path and the SHA-256 of
  its bytes, the arguments, the environment extras, and the entry's digest and
  extension. The host SHALL measure it from what it launches and refuse a
  launch whose digest differs from the approved one before anything starts,
  with `VES_PROBE_HOST_LAUNCH_DIGEST`, as it already refuses an entry whose
  bytes differ. The supervisor SHALL refuse a transport whose launch digest is
  not the admitted one, with `VES_PROBE_WORKSPACE_TRUST_LAUNCH`, before
  negotiating.
- **PHC-02**: The host SHALL refuse an environment extra that a loader, runtime
  or shell reads to load code, whatever the grant binds:
  `NODE_*`, `LD_*`, `DYLD_*`, `PYTHON*`, `PERL5*`, `PERLLIB`, `RUBYOPT`,
  `RUBYLIB`, `BASH_ENV`, `ENV`, `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`,
  `GLIBC_TUNABLES` and `GCONV_PATH`, with `VES_PROBE_HOST_ENVIRONMENT_DENIED`.
- **PHC-03**: Admission SHALL resolve the extension itself, from a lock and a
  request, through the registry the composition root gives it. It SHALL NOT
  accept an extension value; `admitWorkspaceProbeWorker` is removed.
- **PHC-04**: Admission SHALL look `approvalRef` up through the approvals port
  the composition root gives it. An absent approval, or one that names another
  extension, entry digest or launch digest, SHALL be refused with
  `VES_PROBE_WORKSPACE_TRUST_APPROVAL`. The grant's launch digest SHALL equal
  the approval's.
- **PHC-05**: At termination the host SHALL stop the worker's process group,
  then every process linked by parentage to the worker or to a member of its
  group, repeating until no new one appears, and only then kill them all. A
  descendant that left the group while the worker ran is ended.
- **PHC-06**: A worker that is no longer running when the host ends its session
  SHALL fail the probe with `VES_PROBE_WORKER_EXITED`, even after its final
  frame, and its rows SHALL be rolled back.
- **PHC-07**: A process that still holds the worker's stdout or stderr after the
  kill SHALL fail the probe with `VES_PROBE_HOST_TERMINATION_INCOMPLETE`. That
  code outranks the probe's own outcome (a timeout, an abort or a failure),
  the rows SHALL be rolled back, and the parameter frame and the stderr excerpt
  SHALL still be zeroized and scrubbed.
- **PHC-08**: Without a process table, the host SHALL kill the group and then
  fail the termination with `VES_PROBE_HOST_TERMINATION_INCOMPLETE`, instead of
  degrading to the group kill alone.
- **PHC-09**: `adr.md`, `threat-model.md`, AD-037 and
  `docs/qualification/out-of-process-probe-host.md` SHALL state what each
  control now covers and the one residual exactly. A worker that exits before
  the host ends its session fails the probe, but a descendant it left outside
  its group with its stdout and stderr given up is not ended. A descendant
  orphaned by a double fork while the worker still runs, with its output given
  up, is neither ended nor detected.
- **PHC-10**: `tests/architecture/extension-host-composition.test.mjs` SHALL keep
  failing on any CLI or launcher import of the host. Its message SHALL name
  what still stands: the owner's ratification of the amended AD-037, after
  which the host's T3 lifts it.

## Shape

| Path                                                 | Role                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/platform-node/src/probe-launch-digest.ts`  | the launch digest, shared by the host's measurement and whoever issues grants and approvals |
| `packages/platform-node/src/spawned-probe-worker.ts` | refuses loader names and an unapproved launch, stops the tree, checks stdio reached EOF      |
| `packages/platform-node/src/process-tree-terminator.ts` | the one group-signal owner gains the stop-then-kill routine                              |
| `packages/extension-host/src/workspace-trust.ts`     | `WorkspaceProbeAdmission`: registry and approvals ports, launch digest in grant and trust    |
| `packages/extension-host/src/framed-probe-worker.ts` | a stream completes only if the worker was still running when the host ended it               |
| `packages/extension-host/src/index.ts`               | the launch digest check, and termination failure outranking the probe's outcome              |

## Decisions

The owner chose these on 2026-10-27, from options with their trade-offs.

- **Detect and fail, not kernel containment.** No unprivileged POSIX mechanism
  ends a double-forked descendant that gave up its inherited descriptors.
  Linux needs a PID namespace or a subreaper, and macOS has neither. A PID
  namespace through `unshare` depends on unprivileged user namespaces, which
  some distributions restrict, and `sandbox-exec` is deprecated. An admitted
  worker already has the host user's filesystem authority, so it could persist
  through a crontab or a launch agent anyway: against hostile approved code,
  descendant escape is part of the "no OS sandbox" residual. The control is
  for descendants approved code leaves behind, and those are ended or fail the
  probe.
- **Stop, then look, then kill.** A stopped process cannot exit or fork, so a
  descendant still linked when its parent is stopped keeps that link until the
  kill. The stopped worker cannot reap a child that exits, so a pid in the
  snapshot is not reused before the kill.
- **Running at the end, not only at the last frame.** A worker that wrote its
  final frame and exited used to complete. Its children were reparented the
  moment it exited, so the host can no longer find them. Requiring the worker
  to be running when the host ends the session is what makes the sweep
  complete. Both reference workers already wait for their stdin to close.
- **The executable's bytes, not only its path.** A swapped binary at the same
  path would otherwise pass. Hashing the Node binary costs a fraction of a
  second per launch, and a toolchain upgrade needs a new approval. The host
  executes the file it hashed by its real path, but unlike the entry it does
  not copy it, so a change between the hash and the exec is not caught. The
  executable is a toolchain binary outside the Workspace, which the entry is
  not.
- **Refused before it starts.** The supervisor's launch check runs at the
  handshake, after the worker has started, so on its own it would let an
  unapproved argument run first. The host therefore takes the approved launch
  digest as a launch input, as it takes the entry's digest, and refuses a
  mismatch before it spawns; the supervisor's check binds the transport to the
  admitted trust.
- **Loader names refused even when bound.** Binding `NODE_OPTIONS=--require x`
  would make the human accountable for `x` without pinning its bytes, so those
  names are not grantable at all.
- **Ports from the composition root.** `@verchestra/extension-host` depends only on
  `@verchestra/domain`, so it cannot check that a value came from
  `GovernedSkillRegistry`. Admission instead calls the registry and the approval
  store itself, through ports the composition root wires. A caller can still
  ask, but no longer hands admission the answer. How grants and approvals are
  issued and stored stays the host's T3 decision; the approvals port states the
  contract an adapter must keep: verified, unrevoked and unexpired, or absent.
- **The guard stays.** The fixes remove the three limits, but AD-037 is still
  `proposed`, and composing the host is T3's change.
