# AD-034 — Workspace probe workers run out of process under `process-contained` supervision (#235)

- **Status:** proposed (the owner ratifies by reviewing the pull request that
  carries this feature). Recorded in `.specs/STATE.md`.
- **Context:** AD-017 moved real-engine database qualification to the edge: a
  team implements the published connection port in its own repository and runs
  the conformance kit. That still means the team's code runs inside the product
  process as a TypeScript adapter. The `verchestra-probe/1` protocol was
  designed for an out-of-process worker, and the governed-skill registry and
  the isolation policy already describe how executable code is admitted, but
  none of it was on the execution path.

## Decision

1. **Protocol on the path.** `FramedProbeWorker` (`packages/extension-host`)
   implements the supervisor's worker port by exchanging `verchestra-probe/1`
   frames over a byte transport. The protocol, the decoder, the sequence guard,
   and the supervisor stay in extension-host; the process adapter stays in
   platform-node. The two meet structurally (`ProbeWorkerTransport`), because
   adapters may not import sibling adapters (`docs/repository-map.md`).
2. **Spawned transport.** `SpawnedProbeWorker` (`packages/platform-node`) is
   the only process-spawning piece: a from-nothing environment, a private temp
   cwd, stdio frames, bounded output, and process-group termination through the
   terminator extracted unchanged from the T59 gate adapter, extended with a
   pre-kill descendant snapshot so a `setsid` escapee is also killed.
3. **Two trust roots, exactly one per supervisor.** The product root keeps the
   hardcoded component pin. The workspace root is a value only
   `admitWorkspaceProbeWorker` can mint, from (a) the registry's
   `resolveExecutableExtension` over a signed lock — the first consumer of the
   long-declared `extensionRef`/`approvalRef` — and (b) a controller grant that
   `authorizeSkillExecution` (product port of the qualified spike rule, same
   codes) accepts only when it binds Workspace, lock, extension, approval, and
   digest. Denial is the default.
4. **Isolation grade.** The host is `process-contained` and says so. A grant
   must classify the worker `approved-workspace-executable` and request
   `process-contained`; `high-untrusted-executable` is refused with the
   isolation policy's own `VES_STRONG_ISOLATION_UNAVAILABLE`, and a request for
   a stronger grade is refused rather than silently downgraded.
5. **POSIX only.** win32 is refused with `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`.

## Rationale

- The supervisor's bounds (read-only proofs, row, byte, time, leak detection,
  zeroization, sanitized errors) were written against a port, so moving the
  worker out of process reuses them unchanged instead of re-deriving them.
- Out of process, the protocol is the contract, so the worker can be written in
  any language; the Python reference worker proves it with the standard
  library only.
- Admission reuses two already-reviewed controls rather than inventing a third
  trust mechanism: the signed skill lock (content pinned by digest, human
  approval reference) and the controller-grant rule of the isolation policy.

## Consequences

- Protocol-level containment is qualified: a worker cannot smuggle data past
  the frame, sequence, digest, Workspace, row, byte, leak, and time controls,
  cannot outlive its probe, and cannot flood the host.
- OS-level containment is not: an admitted worker runs with the host user's
  filesystem and network authority. That is acceptable only because admission
  requires a human-approved digest in a signed lock and a bound controller
  grant; running unapproved code has no path. Closing it requires the
  `native-restricted` or `container-isolated` grade, which stays unqualified.
- The time bound now also covers the handshake, identity, and session calls
  (previously only `execute` observed the abort signal).
- No CLI composition yet; a follow-up wires the composition root after
  ratification.
- The signed 1.0.0 hold (`docs/qualification/release-decision-1.0.0.md`) is not
  touched and this is not a release claim.

## Alternatives rejected

- **Worker thread or `vm` isolation:** shares the process, so a native addon or
  a blocking loop defeats the time bound; also not language-neutral.
- **Accepting the worker's self-reported digest:** the worker controls it. The
  host measures the bytes it executes and pins that; the self-report is checked
  in addition, never instead.
- **Environment allowlist copied from `process.env`:** any future variable
  added to the allowlist would leak ambient values; building from nothing makes
  inheritance impossible by construction.
